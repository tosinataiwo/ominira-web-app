// TOC tree (EPUB3 nav document, NCX fallback) and section-kind
// classification (EPUB3 landmarks merged over the EPUB2 guide) — ported 1:1
// from ingestion-pipeline/src/ingestion/epubparser/toc.py.
//
// - TocEntry keeps the **fragment**, so a TOC that addresses sub-locations
//   inside one XHTML file stays addressable — the section assembler splits
//   the file instead of re-parsing it once per entry.
// - List items are parsed with direct-child scoping: a grouping
//   `<li><span>Part One</span><ol>...</ol></li>` yields its own label with
//   path=null and real children.

import * as paths from "./paths";
import { attr, attrLocal, children, cleanText, localName, parseXml, parseDocument } from "./dom";
import type { Element } from "./dom";
import type { PackageDoc } from "./package";
import type { ZipReader } from "./zip";

const LIST_TAGS = new Set(["ol", "ul"]);

const BODY_TOKENS = new Set(["bodymatter", "text", "chapter", "part", "division", "volume"]);
const FRONT_TOKENS = new Set([
  "cover", "cover-page", "titlepage", "title-page", "halftitlepage", "half-title-page",
  "halftitle", "frontmatter", "toc", "preface", "foreword", "introduction",
  "prologue", "dedication", "epigraph", "acknowledgments", "acknowledgements",
  "copyright-page", "copyright", "imprint", "contributors", "other-credits", "landmarks",
]);
const BACK_TOKENS = new Set([
  "backmatter", "afterword", "epilogue", "conclusion", "appendix", "bibliography",
  "glossary", "index", "endnotes", "footnotes", "rearnotes", "notes", "colophon",
]);

export interface TocEntry {
  title: string | null;
  path: string | null;
  fragment: string | null;
  children: TocEntry[];
}

export function classifyKind(raw: string | null | undefined): "front" | "body" | "back" | "unknown" {
  if (!raw) return "unknown";
  const tokens = new Set(raw.toLowerCase().split(/\s+/).filter(Boolean));
  if ([...tokens].some((t) => BODY_TOKENS.has(t))) return "body";
  if ([...tokens].some((t) => FRONT_TOKENS.has(t))) return "front";
  if ([...tokens].some((t) => BACK_TOKENS.has(t))) return "back";
  return "unknown";
}

function tokens(el: Element, name: string): Set<string> {
  return new Set((attr(el, name) ?? "").toLowerCase().split(/\s+/).filter(Boolean));
}

function navElements(root: Element): Element[] {
  const out: Element[] = [];
  const visit = (node: Element) => {
    if (localName(node) === "nav") out.push(node);
    for (const child of children(node)) visit(child);
  };
  visit(root);
  return out;
}

function findNav(root: Element, epubType: string, role: string): Element | null {
  for (const nav of navElements(root)) {
    if (tokens(nav, "epub:type").has(epubType) || tokens(nav, "role").has(role)) return nav;
  }
  return null;
}

function findFirstList(el: Element): Element | null {
  for (const tag of LIST_TAGS) {
    const found = findDescendant(el, tag);
    if (found) return found;
  }
  return null;
}

function findDescendant(el: Element, tag: string): Element | null {
  for (const child of children(el)) {
    if (localName(child) === tag) return child;
    const found = findDescendant(child, tag);
    if (found) return found;
  }
  return null;
}

function hasHrefLink(el: Element): boolean {
  if (localName(el) === "a" && attr(el, "href")) return true;
  return children(el).some(hasHrefLink);
}

function findTocNav(root: Element): Element | null {
  const nav = findNav(root, "toc", "doc-toc");
  if (nav) return nav;
  for (const candidate of navElements(root)) {
    const types = new Set([...tokens(candidate, "epub:type"), ...tokens(candidate, "role")]);
    if (["landmarks", "page-list", "doc-pagelist", "doc-landmarks"].some((t) => types.has(t))) continue;
    const list = findFirstList(candidate);
    if (list && hasHrefLink(candidate)) return candidate;
  }
  return null;
}

/** The entry's own <a href>: searched among the li's direct children and
 * their descendants, but never inside a nested list. */
function directLabel(li: Element): Element | null {
  const search = (el: Element): Element | null => {
    for (const child of children(el)) {
      if (LIST_TAGS.has(localName(child))) continue;
      if (localName(child) === "a" && attr(child, "href")) return child;
      const found = search(child);
      if (found) return found;
    }
    return null;
  };
  return search(li);
}

/** li text excluding nested list subtrees. */
function ownText(li: Element): string {
  const parts: string[] = [];
  const visit = (el: Element) => {
    for (const child of el.children) {
      if (child.type === "text") parts.push(child.data);
      else if (child.type === "tag" && !LIST_TAGS.has(localName(child))) visit(child);
    }
  };
  visit(li);
  return parts.join("").split(/\s+/).filter(Boolean).join(" ");
}

function parseNavList(listEl: Element, baseDir: string, selfPath: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const li of children(listEl).filter((c) => localName(c) === "li")) {
    const label = directLabel(li);
    let path: string | null = null;
    let fragment: string | null = null;
    if (label) {
      const href = attr(label, "href") ?? "";
      [path, fragment] = paths.resolveHref(baseDir, href);
      if (path === "") path = selfPath;
    }
    const title = label ? cleanText(label) : ownText(li);
    const childEntries: TocEntry[] = [];
    for (const nested of children(li).filter((c) => LIST_TAGS.has(localName(c)))) {
      childEntries.push(...parseNavList(nested, baseDir, selfPath));
    }
    if (!title && path === null && !childEntries.length) continue;
    entries.push({ title: title || null, path, fragment, children: childEntries });
  }
  return entries;
}

function ncxPoints(parent: Element): Element[] {
  return children(parent).filter((c) => localName(c) === "navpoint");
}

function orderSiblings(pointsEls: Element[]): Element[] {
  const orders = pointsEls.map((p) => attr(p, "playOrder") ?? attrLocal(p, "playOrder"));
  const keys = orders.map((o) => (o !== undefined ? parseInt(o, 10) : NaN));
  if (keys.some((k) => Number.isNaN(k))) return pointsEls;
  if (new Set(keys).size !== keys.length) return pointsEls;
  return pointsEls
    .map((p, i) => [keys[i], p] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, p]) => p);
}

function parseNavPoint(np: Element, baseDir: string): TocEntry {
  let title: string | null = null;
  let path: string | null = null;
  let fragment: string | null = null;
  for (const child of children(np)) {
    const local = localName(child);
    if (local === "navlabel" && title === null) {
      title = cleanText(child) || null;
    } else if (local === "content" && path === null) {
      const src = attr(child, "src");
      if (src) [path, fragment] = paths.resolveHref(baseDir, src);
    }
  }
  const childEntries = orderSiblings(ncxPoints(np)).map((c) => parseNavPoint(c, baseDir));
  return { title, path: path || null, fragment, children: childEntries };
}

function parseNcx(data: string, baseDir: string): TocEntry[] {
  const root = parseXml(data);
  const navMap = findDescendant(root, "navmap") ?? (localName(root) === "navmap" ? root : null);
  if (!navMap) return [];
  return orderSiblings(ncxPoints(navMap)).map((np) => parseNavPoint(np, baseDir));
}

export async function parseToc(zip: ZipReader, pkg: PackageDoc): Promise<TocEntry[]> {
  if (pkg.navPath) {
    const data = await zip.readText(pkg.navPath);
    if (data !== null) {
      const root = parseDocument(data);
      const nav = findTocNav(root);
      if (nav) {
        const listEl = findFirstList(nav);
        if (listEl) {
          const entries = parseNavList(listEl, paths.dirOf(pkg.navPath), pkg.navPath);
          if (entries.length) return entries;
        }
      } else {
        // Some EPUBs mark an NCX as the nav document.
        const entries = parseNcx(data, paths.dirOf(pkg.navPath));
        if (entries.length) return entries;
      }
    }
  }
  if (pkg.ncxPath) {
    const data = await zip.readText(pkg.ncxPath);
    if (data === null) return [];
    return parseNcx(data, paths.dirOf(pkg.ncxPath));
  }
  return [];
}

/** path -> raw structural type. EPUB2 guide first, EPUB3 landmarks merged
 * over it (landmarks win where both cover a file). */
export async function parseKinds(zip: ZipReader, pkg: PackageDoc): Promise<Map<string, string>> {
  const kinds = new Map(pkg.guide);
  if (!pkg.navPath) return kinds;
  const data = await zip.readText(pkg.navPath);
  if (data === null) return kinds;
  const root = parseDocument(data);
  const landmarks = findNav(root, "landmarks", "doc-landmarks");
  if (landmarks) {
    const baseDir = paths.dirOf(pkg.navPath);
    for (const a of findDescendantAll(landmarks, "a")) {
      const href = attr(a, "href");
      const epubType = attr(a, "epub:type");
      if (!href || !epubType) continue;
      let [path] = paths.resolveHref(baseDir, href);
      if (path === "") path = pkg.navPath;
      if (path) kinds.set(path, epubType.trim());
    }
  }
  return kinds;
}

function findDescendantAll(el: Element, tag: string): Element[] {
  const out: Element[] = [];
  const visit = (node: Element) => {
    if (localName(node) === tag) out.push(node);
    for (const child of children(node)) visit(child);
  };
  for (const child of children(el)) visit(child);
  return out;
}

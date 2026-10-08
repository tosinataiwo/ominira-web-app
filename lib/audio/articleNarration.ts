import type { Passage } from "@/lib/book/schema";
import { articleBlocks } from "@/lib/reader/useArticleProgress";
import type { NarrationDocument } from "@/lib/audio/narrationDocument";
import { wordIndexAt } from "@/lib/audio/narrationText";

// Narration for the reflowable documents (DOCX, extracted web articles): each
// top-level block of the rendered article (articleBlocks — the same blocks
// progress and highlights count) is one passage, so passage i is block i
// and the `block` locator maps straight across.

const SECTION_ID = "article";

/** Elements whose edges are a break in the spoken text. Without one, mammoth's
 * `<li>One</li><li>Two</li>` reads (and counts) as the single word "OneTwo". */
const BREAK_TAGS = new Set([
  "P", "DIV", "LI", "DT", "DD", "BR", "TR", "TD", "TH", "BLOCKQUOTE", "PRE",
  "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "DL", "TABLE", "FIGCAPTION", "SECTION",
]);
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

type BlockText = { text: string; nodes: { node: Text; start: number }[] };

/** A block's spoken text, and where each DOM text node sits in it — one walk
 * shared by the text sent to TTS and the word highlight, so word N is the
 * same word to both. Line breaks inside a text node are the source HTML's
 * own wrapping, not the author's: Edge TTS pauses at each one as if a
 * sentence ended, so they become spaces (one for one, keeping offsets).
 * Breaks between elements stay, as the pauses they should be. */
function readBlock(el: Element): BlockText {
  let text = "";
  const nodes: BlockText["nodes"] = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      nodes.push({ node: n as Text, start: text.length });
      text += (n as Text).data.replace(/[\r\n\t]/g, " ");
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (n as Element).tagName;
    if (SKIP_TAGS.has(tag)) return;
    if (BREAK_TAGS.has(tag) && text) text += "\n";
    n.childNodes.forEach(walk);
  };
  walk(el);
  return { text, nodes };
}

function passageType(el: Element): Pick<Passage, "type" | "level"> {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) return { type: "heading", level: Number(tag[1]) };
  if (tag === "UL" || tag === "OL" || tag === "LI") return { type: "listItem" };
  if (tag === "BLOCKQUOTE") return { type: "blockquote" };
  if (tag === "DL") return { type: "definitionList" };
  // No spoken form, same as a book's: skipped by hasNarratableText.
  if (tag === "PRE") return { type: "code" };
  if (tag === "TABLE") return { type: "table" };
  if (tag === "HR") return { type: "horizontalRule" };
  if (tag === "FIGURE" || tag === "IMG" || tag === "PICTURE") return { type: "image" };
  return { type: "paragraph" };
}

export function articleNarrationDocument(opts: {
  materialId: string;
  title: string;
  author?: string;
  contentEl: HTMLElement;
}): NarrationDocument {
  const blocks = articleBlocks(opts.contentEl);
  const passages: Passage[] = blocks.map((el, index) => ({
    id: `block-${index}`,
    index,
    text: readBlock(el).text,
    ...passageType(el),
  }));
  return {
    // The material id is also the slug: /reader/<id> opens it, and it keys
    // the clip cache.
    id: opts.materialId,
    slug: opts.materialId,
    metadata: { title: opts.title, author: opts.author },
    spine: [SECTION_ID],
    sections: [{ id: SECTION_ID, kind: "body", passages, children: [] }],
    scale: { kind: "block", blockCount: blocks.length },
  };
}

/** The DOM range of a block's word `wordIndex`, counted as \S+ runs of its
 * spoken text — the same count KaraokeWord.index uses. */
export function articleWordRange(block: Element, wordIndex: number): Range | undefined {
  const { text, nodes } = readBlock(block);
  const re = /\S+/g;
  let match: RegExpExecArray | null = null;
  for (let i = 0; i <= wordIndex; i++) {
    match = re.exec(text);
    if (!match) return undefined;
  }
  const start = match!.index;
  const end = start + match![0].length;
  const at = (offset: number, isEnd: boolean) => {
    const hit = nodes.find(({ node, start: s }) =>
      isEnd ? offset > s && offset <= s + node.data.length : offset >= s && offset < s + node.data.length
    );
    return hit && { node: hit.node, offset: offset - hit.start };
  };
  const from = at(start, false);
  const to = at(end, true);
  if (!from || !to) return undefined;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/** The word (KaraokeWord.index) at a selection offset into a block — the
 * offset counted over the block's raw text nodes, as the DOM selection
 * surface counts it. */
export function articleWordIndexAt(block: Element, offset: number): number {
  const { text, nodes } = readBlock(block);
  let raw = 0;
  for (const { node, start } of nodes) {
    if (offset <= raw + node.data.length) return wordIndexAt(text, start + offset - raw);
    raw += node.data.length;
  }
  return wordIndexAt(text, text.length);
}

export const articleBlockIndex = (passageId: string) =>
  passageId.startsWith("block-") ? Number(passageId.slice(6)) : -1;

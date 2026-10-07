import { describe, expect, test } from "bun:test";
import type { LocatorScale } from "@/lib/reader/locator";
import { placeAtFraction, placeFraction } from "./view";

const epub: LocatorScale = { kind: "epub", spine: ["a", "b", "c", "d"], sectionPassageCounts: { a: 4, b: 10, c: 0, d: 2 } };
const pdf: LocatorScale = { kind: "page", pageCount: 20 };
const article: LocatorScale = { kind: "block", blockCount: 50 };

describe("placeFraction", () => {
  test("EPUB: section, passage and offset", () => {
    expect(placeFraction(epub, { locator: { kind: "epub", sectionId: "a", passageIndex: 0 }, offset: 0 })).toBe(0);
    expect(placeFraction(epub, { locator: { kind: "epub", sectionId: "b", passageIndex: 5 }, offset: 0 })).toBe(0.375);
    expect(placeFraction(epub, { locator: { kind: "epub", sectionId: "c", passageIndex: 0 }, offset: 0.5 })).toBe(0.625);
  });

  test("pages and blocks, with the offset", () => {
    expect(placeFraction(pdf, { locator: { kind: "page", page: 1 }, offset: 0 })).toBe(0);
    expect(placeFraction(pdf, { locator: { kind: "page", page: 11 }, offset: 0.5 })).toBe(0.525);
    expect(placeFraction(article, { locator: { kind: "block", blockIndex: 25 }, offset: 0 })).toBe(0.5);
  });

  test("null for a place the scale can't address", () => {
    expect(placeFraction(pdf, { locator: { kind: "block", blockIndex: 1 }, offset: 0 })).toBeNull();
    expect(placeFraction(epub, { locator: { kind: "epub", sectionId: "zz", passageIndex: 0 }, offset: 0 })).toBeNull();
    expect(placeFraction(undefined, { locator: { kind: "page", page: 1 }, offset: 0 })).toBeNull();
    expect(placeFraction({ kind: "page", pageCount: 0 }, { locator: { kind: "page", page: 1 }, offset: 0 })).toBeNull();
  });
});

describe("placeAtFraction", () => {
  test("the inverse of placeFraction, on every scale", () => {
    for (const scale of [epub, pdf, article]) {
      for (const f of [0, 0.1, 0.375, 0.5, 0.77, 0.999]) {
        const place = placeAtFraction(scale, f)!;
        expect(placeFraction(scale, place)!).toBeCloseTo(f, 6);
      }
    }
  });

  test("the very end lands on the last unit, not past it", () => {
    expect(placeAtFraction(pdf, 1)).toEqual({ locator: { kind: "page", page: 20 }, offset: 1 });
    expect(placeAtFraction(epub, 1)).toEqual({ locator: { kind: "epub", sectionId: "d", passageIndex: 1 }, offset: 1 });
  });

  test("a section with no passages is its start", () => {
    expect(placeAtFraction(epub, 0.6)).toEqual({ locator: { kind: "epub", sectionId: "c", passageIndex: 0 }, offset: 0 });
  });
});

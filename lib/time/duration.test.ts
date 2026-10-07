import { expect, test } from "bun:test";
import { formatDuration } from "./duration";

test("formatDuration", () => {
  const min = 60_000;
  expect(formatDuration(0)).toBe("<1 min");
  expect(formatDuration(59_999)).toBe("<1 min");
  expect(formatDuration(48 * min)).toBe("48 min");
  expect(formatDuration(60 * min)).toBe("1 h");
  expect(formatDuration(72 * min + 30_000)).toBe("1 h 12 min");
  expect(formatDuration(-5)).toBe("<1 min");
});

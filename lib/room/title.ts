// A room's title is optional; every surface shows it through this one rule.
export function roomTitle(title: string | null, bookTitle: string): string {
  return title ?? `${bookTitle} reading room`;
}

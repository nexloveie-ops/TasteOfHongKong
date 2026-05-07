/**
 * Normalize user input to canonical Eircode "AAA BCCC" (space before last 4 chars).
 * Returns null if not exactly 7 usable characters after stripping spaces/hyphens.
 */
export function normalizeIrishEircode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== 7) return null;
  if (!/^[A-Z][0-9][0-9W][0-9A-Z]{4}$/.test(s)) return null;
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

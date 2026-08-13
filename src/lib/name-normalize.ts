// Arabic name normalization for duplicate detection.
export function normalizeArabicName(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input).trim();
  // Strip Arabic diacritics (harakat) and tatweel.
  s = s.replace(/[\u064B-\u0652\u0670\u0640]/g, "");
  // Unify alef, yaa, taa marbuta variants.
  s = s
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
  // Collapse whitespace.
  s = s.replace(/\s+/g, " ");
  return s;
}

// Loose search: every token in the query must appear somewhere in the name,
// regardless of order or extra middle names.
export function nameMatchesQuery(name: string | null | undefined, query: string): boolean {
  const n = normalizeArabicName(name);
  const tokens = normalizeArabicName(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) => n.includes(t));
}
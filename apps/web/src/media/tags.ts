// Tag normalisation shared by the store actions, the search index and the
// UI. Tags keep their display case; equality is case-insensitive.

export const MAX_TAG_LENGTH = 40;

// Trims, collapses inner whitespace, drops a leading "#" and caps the
// length. Returns null when nothing usable remains.
export const normalizeTag = (raw: string): string | null => {
  const tag = raw
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LENGTH)
    .trim();
  return tag.length > 0 ? tag : null;
};

// Same folding as the search haystack (search.ts), so "#Tag" and "tag" agree.
export const tagKey = (tag: string): string => tag.toLowerCase();

export const hasTag = (tags: readonly string[] | undefined, tag: string): boolean => {
  const key = tagKey(tag);
  return (tags ?? []).some((existing) => tagKey(existing) === key);
};

// Appends when absent; returns the same array when the tag is already there.
export const withTag = (tags: readonly string[] | undefined, tag: string): readonly string[] => {
  const current = tags ?? [];
  return hasTag(current, tag) ? current : [...current, tag];
};

export const withoutTag = (tags: readonly string[] | undefined, tag: string): readonly string[] => {
  const key = tagKey(tag);
  return (tags ?? []).filter((existing) => tagKey(existing) !== key);
};

// Splits user input on commas, normalises and dedupes (first spelling wins).
export const parseTagInput = (input: string): readonly string[] => {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of input.split(",")) {
    const tag = normalizeTag(part);
    if (!tag || seen.has(tagKey(tag))) continue;
    seen.add(tagKey(tag));
    tags.push(tag);
  }
  return tags;
};

const stopWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "de",
  "do",
  "el",
  "en",
  "for",
  "in",
  "la",
  "o",
  "of",
  "on",
  "para",
  "the",
  "to",
  "un",
  "uma",
  "with",
]);

function terms(text: string): readonly string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** Rank only the caller's authorized catalog. This never searches stored user data. */
export function rankCatalog<T extends { path: string; description: string }>(
  catalog: readonly T[],
  query: string
) {
  const queryTerms = [
    ...new Set(terms(query).filter((term) => !stopWords.has(term))),
  ];
  if (queryTerms.length === 0)
    return catalog.toSorted((a, b) => a.path.localeCompare(b.path));
  return catalog
    .map((item) => {
      const path = terms(item.path);
      const description = terms(item.description);
      const score = queryTerms.reduce(
        (total, term) => {
          const inPath = path.includes(term);
          const inDescription = description.some((word) =>
            word.startsWith(term)
          );
          return total + (inPath || inDescription ? 8 : 0) + (inPath ? 2 : 0);
        },
        item.path.toLowerCase().includes(query.trim().toLowerCase()) ? 30 : 0
      );
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .toSorted(
      (a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path)
    )
    .map(({ item }) => item);
}

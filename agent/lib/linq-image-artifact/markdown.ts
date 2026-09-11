import { isBrowserImageArtifactUrl } from "@shared/browser/artifact";

const imageArtifactMarkdownPattern =
  /!\[((?:\\.|[^\]])*)\]\((\/artifacts\/([^\s)]+))\)/giu;

function pushImageArtifactReference(
  references: {
    readonly id: string;
    readonly label: string;
    readonly markdown: string;
    readonly url: string;
  }[],
  seen: Set<string>,
  match: RegExpMatchArray
) {
  const [markdown, label, url, id] = match;

  if (!markdown || !url || !id || seen.has(id)) {
    return;
  }

  if (!isBrowserImageArtifactUrl(url)) {
    return;
  }

  seen.add(id);
  references.push({ id, label: label ?? "", markdown, url });
}

export function extractImageArtifactMarkdownReferences(message: string) {
  const references: {
    readonly id: string;
    readonly label: string;
    readonly markdown: string;
    readonly url: string;
  }[] = [];

  const seen = new Set<string>();

  for (const match of message.matchAll(imageArtifactMarkdownPattern)) {
    pushImageArtifactReference(references, seen, match);
  }

  return references;
}

export function stripImageArtifactMarkdownReferences(message: string) {
  return message
    .replace(imageArtifactMarkdownPattern, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

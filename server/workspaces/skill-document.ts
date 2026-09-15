import { Schema } from "effect";
import { WorkspacePathSchema } from "./git";

const toolId = /^[a-z][a-zA-Z0-9._-]{0,79}$/;
const frontmatter = /^---\r?\nrequires:\s*\[(?<list>[^\]]*)\]\s*\r?\n---\r?\n/;

export const SkillProposalPath = WorkspacePathSchema.check(
  Schema.isPattern(/^proposals\/skills\/.+\.md$/u)
);
export const PublishedSkillPath = WorkspacePathSchema.check(
  Schema.isPattern(/^skills\/.+\.md$/u)
);

export function isSkillContentPath(path: string) {
  return path.startsWith("skills/") || path.startsWith("proposals/skills/");
}

export function skillPathFromProposal(proposal: string) {
  return proposal.replace(/^proposals\//u, "");
}

export function parseSkillDocument(content: string) {
  if (!content.isWellFormed() || content.includes("\0")) return null;
  let body = content;
  let requires: string[] = [];
  if (content.startsWith("---")) {
    const match = frontmatter.exec(content);
    if (!match) return null;
    const list = match.groups?.list?.trim() ?? "";
    requires = list === "" ? [] : list.split(",").map((item) => item.trim());
    if (
      requires.length > 32 ||
      requires.some((id) => !toolId.test(id)) ||
      new Set(requires).size !== requires.length
    )
      return null;
    body = content.slice(match[0].length);
  }
  const title = body
    .split("\n")
    .map((line) => line.replace(/\r$/u, ""))
    .find((line) => line.trim());
  if (!title) return null;
  return {
    requires,
    body,
    title: title.replace(/^#+\s*/u, "").slice(0, 200),
  };
}

export const SkillDocumentSchema = Schema.String.check(
  Schema.makeFilter((content) => parseSkillDocument(content) !== null)
);

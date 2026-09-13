import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { expect, test } from "vitest";
import { convertWorkspaceDocument } from "./import";

test("imports exact UTF-8 text and retains the original content hash", async () => {
  const source = Buffer.from("# Decisão\n\nEntregar com cuidado. 🌱");
  const converted = await Effect.runPromise(
    convertWorkspaceDocument("decisao.md", source)
  );
  expect(converted.content).toBe(source.toString());
  expect(converted.sha256).toBe(
    createHash("sha256").update(source).digest("hex")
  );
});

test("AnyDoc converts a real RTF document locally", async () => {
  const source = Buffer.from(
    "{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}}\\f0\\fs24 Synthetic document.\\par Launch on Monday.}"
  );
  const result = await Effect.runPromise(
    convertWorkspaceDocument("notes.rtf", source)
  );
  expect(result.content).toContain("Synthetic document.");
  expect(result.content).toContain("Launch on Monday.");
});

test.each([
  ["empty.md", Buffer.alloc(0), "too_large"],
  ["bad.md", Buffer.from([0xff, 0xfe]), "invalid_document"],
  ["binary.txt", Buffer.from("data\0hidden"), "invalid_document"],
  ["large.txt", Buffer.alloc(262145, "a"), "too_large"],
  ["script.js", Buffer.from("process.exit()"), "unsupported"],
  ["broken.pdf", Buffer.from("invalid pdf"), "invalid_document"],
])("rejects an invalid import: %s", async (filename, bytes, reason) => {
  const result = await Effect.runPromise(
    convertWorkspaceDocument(filename, bytes).pipe(Effect.result)
  );
  expect(Result.isFailure(result) && result.failure).toMatchObject({ reason });
});

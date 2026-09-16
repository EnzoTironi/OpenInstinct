import { describe, expect, it } from "vitest";
import { artifactDigest } from "./content";
import {
  acceptDestinationArtifact,
  ArtifactPublication,
  bindPublishedSend,
  isDomainSuccess,
} from "./publication";

const workspaceId = "ws-alice";
const pdf = new TextEncoder().encode("%PDF-1.4 destination-ready");
const constraints = {
  maxBytes: 4096,
  maxPages: 2,
  mediaTypes: ["application/pdf", "text/plain"],
};

const destination = {
  constraints,
  filename: "acordo.pdf",
  mediaType: "application/pdf",
  pageCount: 1,
  workspaceId,
};

describe("published artifacts", () => {
  it("does keep published bytes stable after working-tree edits and revoke retrieval", () => {
    const store = new ArtifactPublication();
    const written = store.writeWorking(pdf, destination);
    expect(written.kind).toBe("working_write");
    if (written.kind !== "working_write") return;
    const published = store.publish(written.workingId, workspaceId);
    expect(published.kind).toBe("published");
    if (published.kind !== "published") return;
    expect(
      store.replaceWorking(
        written.workingId,
        new TextEncoder().encode("working copy changed")
      )
    ).toMatchObject({ kind: "working_write" });
    const retrieved = store.retrieve(published.revisionId, workspaceId);
    expect(retrieved).toMatchObject({
      kind: "published",
      sha256: published.sha256,
    });
    if (retrieved.kind !== "published") return;
    expect(Buffer.from(retrieved.bytes).toString("utf8")).toBe(
      Buffer.from(pdf).toString("utf8")
    );
    expect(store.retrieve(published.revisionId, "ws-bob")).toEqual({
      kind: "deny",
      reason: "not_found",
    });
    expect(store.revoke(published.revisionId, workspaceId)).toEqual({
      kind: "revoked",
      revisionId: published.revisionId,
    });
    expect(store.retrieve(published.revisionId, workspaceId)).toEqual({
      kind: "deny",
      reason: "revoked",
    });
  });

  it("does reject swapped send bytes and treat local proofs as not domain success", () => {
    const accepted = acceptDestinationArtifact(pdf, destination);
    expect(accepted.kind).toBe("accepted");
    if (accepted.kind !== "accepted") return;
    const swapped = artifactDigest(new TextEncoder().encode("other bytes"));
    expect(
      bindPublishedSend({
        payloadSha256: swapped,
        publishedSha256: accepted.sha256,
      })
    ).toEqual({ kind: "deny", reason: "hash_mismatch" });
    expect(
      bindPublishedSend({
        payloadSha256: accepted.sha256,
        publishedSha256: accepted.sha256,
      })
    ).toEqual({ kind: "send", sha256: accepted.sha256 });
    expect(isDomainSuccess({ kind: "working_write", workingId: "w1" })).toBe(
      false
    );
    expect(isDomainSuccess({ kind: "upload", sha256: accepted.sha256 })).toBe(
      false
    );
    expect(isDomainSuccess({ kind: "send", sha256: accepted.sha256 })).toBe(
      false
    );
    expect(
      isDomainSuccess({
        kind: "published",
        revisionId: "r1",
        sha256: accepted.sha256,
      })
    ).toBe(false);
    expect(isDomainSuccess({ kind: "ui_update" })).toBe(false);
    expect(
      isDomainSuccess({
        kind: "destination_accepted",
        sha256: accepted.sha256,
      })
    ).toBe(true);
    expect(
      acceptDestinationArtifact(pdf, { ...destination, pageCount: 8 })
    ).toEqual({ kind: "deny", reason: "page_limit" });
    expect(
      acceptDestinationArtifact(pdf, {
        ...destination,
        mediaType: "application/zip",
      })
    ).toEqual({ kind: "deny", reason: "media_type" });
    expect(() =>
      acceptDestinationArtifact(pdf, { ...destination, extra: true })
    ).toThrow(/excess|Unexpected|extra/i);
  });
});

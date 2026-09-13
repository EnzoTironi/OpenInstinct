import { createHash } from "node:crypto";

/** Stable across replay of one native Eve tool call. */
export function workspaceOperationId(sessionId: string, callId: string) {
  const hash = createHash("sha256")
    .update(`${sessionId}:${callId}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

import { Schema } from "effect";
import { WorkspaceRepositoryError } from "../workspaces/repository";

const messages = {
  unavailable:
    "This tool is unavailable in the current scope. Search the current catalog; do not invent paths.",
  invalid_input:
    "Invalid tool arguments. Describe this tool's schema and correct the arguments before retrying.",
  execution_failed:
    "The tool could not complete. No successful result is confirmed. Do not repeat an uncertain write.",
  conflict:
    "The workspace revision changed. Read workspace.files.list and reconcile with the current revision before retrying. expectedRevision is the WORKSPACE head, not the target file revision; null is valid only for an entirely empty workspace.",
  not_found:
    "This file does not exist. Read workspace.files.list for the current workspace revision and available paths.",
};

export class ExecutorCatalogError extends Schema.TaggedError<ExecutorCatalogError>()(
  "ExecutorCatalogError",
  {
    reason: Schema.Literals([
      "unavailable",
      "invalid_input",
      "execution_failed",
      "conflict",
      "not_found",
    ]),
  }
) {
  override get message() {
    return messages[this.reason];
  }
}

// SDK and durable callback failures enter here; expose only known domain reasons.
export function executorFailure(cause: unknown) {
  if (cause instanceof ExecutorCatalogError) return cause;
  if (cause instanceof WorkspaceRepositoryError)
    return new ExecutorCatalogError({
      reason:
        cause.reason === "unavailable" ? "execution_failed" : cause.reason,
    });
  return new ExecutorCatalogError({
    reason: Schema.isSchemaError(cause) ? "invalid_input" : "execution_failed",
  });
}

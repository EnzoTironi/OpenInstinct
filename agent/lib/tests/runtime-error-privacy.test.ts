import { expect, test } from "vitest";
// This internal seam is deliberately covered because the pinned patch owns it.
import { inspectError } from "../../../node_modules/eve/dist/src/internal/logging.js";

test("provider errors keep diagnostic stacks without logging request bodies or credentials", () => {
  const error = Object.assign(new Error("Synthetic model failure"), {
    requestBodyValues: { instructions: "PRIVATE-WORKSPACE-CONTEXT" },
    requestHeaders: { authorization: "PRIVATE-SERVICE-CREDENTIAL" },
    responseBody: "PRIVATE-PROVIDER-PAYLOAD",
  });
  const output = inspectError(error);
  expect(output).toContain("Synthetic model failure");
  expect(output).not.toContain("PRIVATE-");
  expect(output).not.toContain("requestBodyValues");
});

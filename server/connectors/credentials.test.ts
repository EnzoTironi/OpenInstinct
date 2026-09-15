import { expect, test } from "vitest";
import { redactConnectorCredential } from "./credentials";

test.each([
  "synthetic-key-123",
  'synthetic-"quoted"-key',
  "synthetic\\path-key",
])(
  "redacts raw and common encoded echoes of a connector credential",
  (credential) => {
    const serialized = JSON.stringify({
      description: `The service returned ${credential}`,
      content: Buffer.from(credential).toString("base64"),
      url: encodeURIComponent(credential),
    });
    expect(
      JSON.parse(redactConnectorCredential(serialized, credential))
    ).toEqual({
      description: "The service returned [redacted]",
      content: "[redacted]",
      url: "[redacted]",
    });
  }
);

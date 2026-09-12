import { Option } from "effect";
import { expect, it } from "vitest";

import { deriveEmailIdentityKeys } from "./public-mail";

it("does derive Organização from Unimed and suppress Gmail", () => {
  const ana = Option.getOrThrow(
    deriveEmailIdentityKeys(" Ana.Silva@Unimed.com.br ")
  );
  expect(ana).toEqual({
    organization: {
      confidence: 0.95,
      key: { kind: "domain", value: "unimed.com.br" },
      status: "derived",
    },
    person: {
      confidence: 1,
      key: { kind: "email", value: "ana.silva@unimed.com.br" },
    },
  });

  const bruno = Option.getOrThrow(deriveEmailIdentityKeys("bruno@gmail.com"));
  expect(bruno.organization).toEqual({
    domain: "gmail.com",
    status: "suppressed",
  });
  expect(JSON.stringify(bruno)).not.toContain("Organização");
});

it("does suppress public Brazilian and global mail domains", () => {
  const samples = [
    "ana@hotmail.com",
    "ana@outlook.com.br",
    "ana@yahoo.com.br",
    "ana@uol.com.br",
    "ana@proton.me",
  ];
  for (const email of samples) {
    const keys = Option.getOrThrow(deriveEmailIdentityKeys(email));
    expect(keys.organization.status).toBe("suppressed");
    expect(JSON.stringify(keys.organization)).not.toContain("Organização");
  }
});

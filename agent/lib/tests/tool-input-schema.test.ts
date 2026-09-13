import { Schema } from "effect";
import { expect, test } from "vitest";
import { toolInputSchema } from "../tool-input-schema";

test("Eve can persist the Effect input schema and still reject invalid or extra arguments", async () => {
  const input = toolInputSchema(
    Schema.Struct({
      text: Schema.NonEmptyString.check(Schema.isMaxLength(20)),
    })
  );
  expect(input).toBeTypeOf("object");
  const json = input["~standard"].jsonSchema.input({ target: "draft-07" });
  expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  expect(json).toMatchObject({
    type: "object",
    properties: { text: { type: "string", maxLength: 20 } },
    required: ["text"],
  });
  expect(await input["~standard"].validate({ text: "A stable fact" })).toEqual({
    value: { text: "A stable fact" },
  });
  expect(
    (await input["~standard"].validate({ text: "" })).issues
  ).toBeDefined();
  expect(
    (
      await input["~standard"].validate({
        text: "Fact",
        credentials: "forbidden",
      })
    ).issues
  ).toBeDefined();
});

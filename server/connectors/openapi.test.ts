import { Effect } from "effect";
import { expect, test } from "vitest";
import { importOpenApi } from "./openapi";
import { decodeCustomerTool } from "../workspaces/tool-document";
import { remoteToolDefinition } from "./connections";

const object = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
};
const base = {
  openapi: "3.1.0",
  paths: {
    "/notes/{id}": {
      get: {
        operationId: "get-note",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1 },
          },
        ],
        responses: {
          "200": { content: { "application/json": { schema: object } } },
        },
      },
    },
  },
};
test("imports typed path and query arguments while keeping the configured origin authoritative", async () => {
  const operations = await Effect.runPromise(
    importOpenApi(JSON.stringify(base))
  );
  expect(operations[0]?.request).toEqual({
    kind: "openapi",
    method: "GET",
    path: "/notes/{id}",
    pathParameters: ["id"],
    queryParameters: ["page"],
    body: false,
  });
  expect(operations[0]?.inputSchema.required).toEqual(["id"]);
});
test.each([
  { ...base, paths: { "//another.example/notes": base.paths["/notes/{id}"] } },
  { ...base, paths: { "/../private": base.paths["/notes/{id}"] } },
  {
    ...base,
    paths: {
      "/notes/{id}": {
        get: {
          ...base.paths["/notes/{id}"].get,
          parameters: [
            { name: "Authorization", in: "header", schema: { type: "string" } },
          ],
        },
      },
    },
  },
  {
    ...base,
    paths: {
      "/notes/{id}": {
        get: { ...base.paths["/notes/{id}"].get, parameters: [] },
      },
    },
  },
  {
    ...base,
    paths: {
      "/notes/{id}": {
        get: {
          ...base.paths["/notes/{id}"].get,
          responses: { "200": { $ref: "https://private.example/schema" } },
        },
      },
    },
  },
])(
  "rejects redirects, traversal, ambient headers, missing placeholders and external refs",
  async (document) => {
    await expect(
      Effect.runPromise(importOpenApi(JSON.stringify(document)))
    ).rejects.toMatchObject({ reason: "invalid" });
  }
);
test("schema validation rejects executable extensions after import, before publication", async () => {
  const operations = await Effect.runPromise(
    importOpenApi(JSON.stringify(base))
  );
  const operation = operations[0];
  expect(operation).toBeDefined();
  if (!operation) return;
  const connection = {
    id: "6374bc81-f6c3-4716-8ea7-918a85281bda",
    revision: "d66c9319-bef0-4ee9-a3ed-4c849dbef0a3",
    kind: "openapi" as const,
    name: "Notes",
    endpoint: "https://example.com",
    connected_by: "owner",
    operations,
    share: "owner" as const,
  };
  const definition = remoteToolDefinition(connection, operation);
  await expect(
    Effect.runPromise(
      decodeCustomerTool(
        JSON.stringify({
          ...definition,
          outputSchema: {
            ...object,
            properties: { text: { type: "string", pattern: "(a+)+$" } },
          },
        })
      )
    )
  ).rejects.toMatchObject({ reason: "invalid_definition" });
});

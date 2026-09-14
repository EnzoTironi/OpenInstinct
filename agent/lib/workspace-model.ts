import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, wrapLanguageModel } from "ai";
import { Effect, Schema } from "effect";
import type { AgentModelOptionsDefinition } from "eve";
import { modelCredentials } from "../../server/models/connections";
import { serverRuntime } from "../../server/runtime";
import type { WorkspaceActorSchema } from "../../server/workspaces/access";
import {
  ModelConnectionError,
  modelCatalog,
} from "../../shared/models/catalog";
import { withModelDeadline } from "./model-deadline";

const CodexBody = Schema.Struct({
  input: Schema.optional(
    Schema.Array(Schema.Record(Schema.String, Schema.Unknown))
  ),
});

export const workspaceModel = Effect.fn("model.workspace.select")(function* (
  actor: typeof WorkspaceActorSchema.Type,
  browser = false
) {
  const connection = yield* modelCredentials(actor);
  if (!connection) return null;
  const selected =
    browser && !modelCatalog[connection.model].vision
      ? "gpt-5.6-luna"
      : connection.model;
  const provider = createOpenAI({
    // Credentials are resolved and re-authorized for every request, never put in a global provider.
    apiKey: "workspace-scoped",
    baseURL:
      connection.provider === "grok"
        ? "https://api.x.ai/v1"
        : "https://api.openai.com/v1",
    fetch: async (_url, init) => {
      const current = await serverRuntime.runPromise(
        modelCredentials(actor, connection.revision),
        { signal: init?.signal ?? undefined }
      );
      if (!current) throw new ModelConnectionError({ reason: "changed" });
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${current.tokens.accessToken}`);
      let body = init?.body;
      if (connection.provider === "chatgpt") {
        headers.set("originator", "zoen");
        if (current.tokens.accountId)
          headers.set("ChatGPT-Account-Id", current.tokens.accountId);
        if (Schema.is(Schema.String)(body)) {
          const parsed = Schema.decodeUnknownSync(
            Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
          )(body);
          const input = Schema.decodeUnknownSync(CodexBody)(parsed).input;
          const requestBody = { ...parsed };
          // Codex subscription transport does not accept the public API's safety_identifier field.
          delete requestBody.safety_identifier;
          if (input)
            requestBody.input = input.map(({ id: _id, ...item }) => item);
          body = JSON.stringify(requestBody);
        }
      }
      const url =
        connection.provider === "chatgpt"
          ? "https://chatgpt.com/backend-api/codex/responses"
          : "https://api.x.ai/v1/responses";
      const response = await fetch(url, {
        ...init,
        headers,
        body,
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        const failure = new ModelConnectionError({
          status: response.status,
          reason: [401, 403].includes(response.status)
            ? "reconnect"
            : response.status === 429
              ? "rate_limited"
              : "unavailable",
        });
        // Keep SDK retry semantics for transient failures, without copying prompts or credentials into errors.
        throw new APICallError({
          message: failure.message,
          url,
          statusCode: response.status,
          requestBodyValues: { model: selected },
        });
      }
      return response;
    },
  });
  const model = wrapLanguageModel({
    model: provider.responses(selected),
    middleware: {
      transformParams: async ({ params }) => {
        if (connection.provider !== "chatgpt") return params;
        const instructions = params.prompt
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n\n");
        return {
          ...params,
          maxOutputTokens: undefined,
          prompt: params.prompt.filter((message) => message.role !== "system"),
          providerOptions: {
            ...params.providerOptions,
            openai: {
              ...params.providerOptions?.openai,
              instructions,
              store: false,
              reasoningSummary: null,
            },
          },
        };
      },
    },
  });
  const modelOptions: AgentModelOptionsDefinition = {
    providerOptions: { openai: { store: false, reasoningSummary: null } },
  };
  return {
    model: withModelDeadline(model),
    modelContextWindowTokens: modelCatalog[selected].context,
    modelOptions,
  };
});

import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { ChannelAccounts, IdentitySchema } from "../accounts";
import { MessagePayloadSchema } from "../messaging/model";
import { ArtifactError, type ArtifactSourceSchema } from "./model";

const sourceRow = Schema.Struct({
  eventId: Schema.String,
  sourceMessageId: Schema.String,
  payload: MessagePayloadSchema,
});

export const artifactAccess = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const accounts = yield* ChannelAccounts;
  const requireArtifactActor = Effect.fn("requireArtifactActor")(function* (
    identityId: string
  ) {
    const rows = yield* sql`SELECT id, user_id AS "userId", channel,
    installation_id AS "installationId", sender_id AS "senderId"
    FROM channel_identity WHERE id = ${identityId} AND revoked_at IS NULL FOR SHARE`;
    if (!rows[0]) return yield* new ArtifactError({ reason: "not_found" });
    const candidate = yield* Schema.decodeUnknownEffect(IdentitySchema)(
      rows[0]
    );
    const identity = yield* accounts
      .getActiveIdentity(candidate)
      .pipe(
        Effect.catchTag(
          "ChannelAccountError",
          () => new ArtifactError({ reason: "not_found" })
        )
      );
    const scope = accessScopeForUser(`better-auth:${identity.userId}`);
    const membership = yield* sql`SELECT 1 FROM workspace_memberships
    WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId} FOR SHARE`;
    if (identity.id !== identityId || membership.length !== 1)
      return yield* new ArtifactError({ reason: "not_found" });
    return scope;
  });

  const readArtifactSource = Effect.fn("readArtifactSource")(function* (
    input: typeof ArtifactSourceSchema.Type
  ) {
    const rows =
      yield* sql`SELECT event_id AS "eventId", source_message_id AS "sourceMessageId", payload
    FROM channel_inbox WHERE id = ${input.sourceInboxId} AND identity_id = ${input.identityId} FOR SHARE`;
    if (!rows[0]) return yield* new ArtifactError({ reason: "source_invalid" });
    const source = yield* Schema.decodeUnknownEffect(sourceRow)(rows[0]);
    const matches =
      source.payload.attachments?.filter(
        (entry) => entry.id === input.mediaId
      ) ?? [];
    const [attachment] = matches;
    if (matches.length !== 1 || !attachment)
      return yield* new ArtifactError({ reason: "source_invalid" });
    return {
      sourceEventId: source.eventId,
      sourceMessageId: source.sourceMessageId,
      sourceMediaId: attachment.id,
      filename: attachment.name ?? "attachment",
      mediaType: attachment.mediaType,
    };
  });

  return { requireArtifactActor, readArtifactSource };
});

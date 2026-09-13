import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
import {
  type WorkspaceActorSchema,
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
} from "../workspaces/access";

/** An event is authorized by its sender, current room epoch and live workspace membership. */
export const matrixDeliveryActor = Effect.fn("matrix.deliveryActor")(function* (
  eventId: string
) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql<{
    userId: string;
    workspaceId: string;
    matrixIdentityId: string;
    groupBindingId: string;
    groupEpoch: string;
  }>`SELECT d.user_id AS "userId", b.workspace_id AS "workspaceId", i.matrix_id AS "matrixIdentityId",
    b.id AS "groupBindingId", d.epoch AS "groupEpoch"
    FROM matrix_deliveries d JOIN workspace_group_bindings b ON b.id = d.binding_id
    JOIN matrix_identities i ON i.user_id = d.user_id
    WHERE d.event_id = ${eventId} AND d.state IN ('pending', 'dispatched', 'answer_ready')`;
  if (!rows[0]) return yield* new WorkspaceAccessDenied();
  return yield* requireWorkspaceAccess(rows[0]);
});

export function matrixPrincipal(actor: typeof WorkspaceActorSchema.Type) {
  return {
    authenticator: "matrix",
    principalType: "user" as const,
    principalId: actor.userId,
    attributes: {
      workspaceId: actor.workspaceId,
      workspaceKind: "company",
      matrixIdentityId: actor.matrixIdentityId ?? "",
      groupBindingId: actor.groupBindingId ?? "",
      groupEpoch: actor.groupEpoch ?? "",
      conversationChannel: "matrix",
    },
  };
}

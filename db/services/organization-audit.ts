import { desc, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { db, organizationAuditReceipts } from "@db";

export const organizationAuditActions = [
  "invite_created",
  "invite_accepted",
  "invite_revoked",
  "member_role_changed",
  "member_removed",
  "org_erasure_requested",
  "org_erasure_denied",
] as const;

export type OrganizationAuditAction = (typeof organizationAuditActions)[number];

export class OrganizationAuditAppendFailed extends Schema.TaggedError<OrganizationAuditAppendFailed>()(
  "OrganizationAuditAppendFailed",
  { message: Schema.String }
) {}

/**
 * Append-only org admin receipts. Callers must never update or delete rows.
 */
export function appendOrganizationAuditReceipt(input: {
  id: string;
  organizationId: string;
  actorUserId: string;
  action: OrganizationAuditAction;
  targetUserId?: string | null;
  targetEmail?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}): Effect.Effect<void, OrganizationAuditAppendFailed> {
  return Effect.tryPromise({
    try: async () => {
      await db.insert(organizationAuditReceipts).values({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: input.action,
        targetUserId: input.targetUserId ?? null,
        targetEmail: input.targetEmail ?? null,
        metadata: input.metadata ?? {},
        createdAt: input.createdAt ?? new Date(),
      });
    },
    catch: () =>
      new OrganizationAuditAppendFailed({
        message: "Failed to append organization audit receipt.",
      }),
  });
}

/** Newest-first receipt list for an organization (admin review / export). */
export async function listOrganizationAuditReceipts(
  organizationId: string,
  limit = 100
) {
  return db
    .select()
    .from(organizationAuditReceipts)
    .where(eq(organizationAuditReceipts.organizationId, organizationId))
    .orderBy(desc(organizationAuditReceipts.createdAt))
    .limit(Math.max(1, Math.min(limit, 500)));
}

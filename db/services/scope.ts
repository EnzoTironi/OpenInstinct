import { and, eq } from "drizzle-orm";
import { Schema } from "effect";
import {
  accessScopeForUser,
  type AccessScope,
} from "@shared/identity/access-scope";
import { db, workspaceMemberships, workspaces } from "@db";

class ScopeAccessDenied extends Schema.TaggedError<ScopeAccessDenied>()(
  "ScopeAccessDenied",
  {}
) {}

/** Personal install path: creates workspace + owner membership when missing. */
export async function ensureScope(scope: AccessScope) {
  const createdAt = new Date();
  await db.transaction(async (transaction) => {
    const created =
      scope.workspaceId === accessScopeForUser(scope.userId).workspaceId
        ? await transaction
            .insert(workspaces)
            .values({ createdAt, id: scope.workspaceId })
            .onConflictDoNothing({ target: workspaces.id })
            .returning({ id: workspaces.id })
        : [];
    if (created.length === 1) {
      await transaction.insert(workspaceMemberships).values({
        createdAt,
        role: "owner",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      });
      return;
    }
    const membership = await transaction
      .select({ userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, scope.workspaceId),
          eq(workspaceMemberships.userId, scope.userId)
        )
      )
      .limit(1);
    if (!membership[0]) throw new ScopeAccessDenied();
  });
}

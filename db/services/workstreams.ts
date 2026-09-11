import type { WorkstreamContent } from "@shared/workstreams/schema";
import { db, workspaces, workstreams } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  findWorkstreamsSchema,
  forgetWorkstreamSchema,
  saveWorkstreamSchema,
} from "@shared/workstreams/schema";
import { and, count, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import type { z } from "zod";

import { ensureScope } from "./scope";

export async function findWorkstreams(
  scope: AccessScope,
  scopeKey: string,
  input: z.input<typeof findWorkstreamsSchema>
) {
  const { query, status, offset } = findWorkstreamsSchema.parse(input);
  const pattern = `%${query.replace(/[\\%_]/gu, "\\$&")}%`;

  const rows = await db
    .select()
    .from(workstreams)
    .where(
      and(
        eq(workstreams.workspaceId, scope.workspaceId),
        eq(workstreams.scopeKey, scopeKey),
        isNotNull(workstreams.content),
        status ? sql`${workstreams.content}->>'status' = ${status}` : undefined,
        query
          ? or(
              ilike(workstreams.id, pattern),
              sql`${workstreams.content}::text ILIKE ${pattern}`
            )
          : undefined
      )
    )
    .orderBy(desc(workstreams.updatedAt), workstreams.id)
    .limit(21)
    .offset(offset);

  return {
    items: rows.slice(0, 20).map(workstreamSummary),
    nextOffset: rows.length > 20 ? offset + 20 : null,
  };
}

export async function recallWorkstreams(scope: AccessScope, scopeKey: string) {
  const rows = await db
    .select()
    .from(workstreams)
    .where(
      and(
        eq(workstreams.workspaceId, scope.workspaceId),
        eq(workstreams.scopeKey, scopeKey),
        sql`${workstreams.content}->>'status' IN ('active', 'waiting')`
      )
    )
    .orderBy(desc(workstreams.updatedAt), workstreams.id)
    .limit(9);

  return {
    items: rows.slice(0, 8).map(workstreamSummary),
    hasMore: rows.length > 8,
  };
}

export async function readWorkstream(
  scope: AccessScope,
  scopeKey: string,
  id: string
) {
  const [row] = await db
    .select()
    .from(workstreams)
    .where(
      and(
        eq(workstreams.workspaceId, scope.workspaceId),
        eq(workstreams.scopeKey, scopeKey),
        eq(workstreams.id, id),
        isNotNull(workstreams.content)
      )
    )
    .limit(1);

  return row ? workstreamResult(row) : null;
}

function revisionMismatch(
  current: typeof workstreams.$inferSelect | undefined,
  expectedRevision: number
) {
  const revision = current?.revision ?? 0;

  if (revision !== expectedRevision) return true;

  return current?.content === null;
}

async function assertWorkstreamCapacity(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  scope: AccessScope,
  scopeKey: string
) {
  const [total] = await transaction
    .select({ value: count() })
    .from(workstreams)
    .where(
      and(
        eq(workstreams.workspaceId, scope.workspaceId),
        eq(workstreams.scopeKey, scopeKey),
        isNotNull(workstreams.content)
      )
    );

  if ((total?.value ?? 0) < 100) return;

  throw new Error(
    "Workstream memory is full (100 records). Ask which obsolete workstream to forget before adding another."
  );
}

async function writeWorkstreamRow(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    current: typeof workstreams.$inferSelect | undefined;
    identity: ReturnType<typeof and>;
    values: {
      content: WorkstreamContent;
      lastOperationId: string;
      revision: number;
      sessionId: string;
      updatedAt: Date;
    };
    id: string;
    scopeKey: string;
    workspaceId: string;
    expectedRevision: number;
  }
) {
  if (input.current) {
    const [saved] = await transaction
      .update(workstreams)
      .set(input.values)
      .where(
        and(
          input.identity,
          eq(workstreams.revision, input.expectedRevision),
          isNotNull(workstreams.content)
        )
      )
      .returning();

    return saved;
  }

  const [saved] = await transaction
    .insert(workstreams)
    .values({
      ...input.values,
      id: input.id,
      scopeKey: input.scopeKey,
      workspaceId: input.workspaceId,
    })
    .returning();

  return saved;
}

async function saveWorkstreamInTransaction(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  scope: AccessScope,
  scopeKey: string,
  parsed: z.infer<typeof saveWorkstreamSchema>,
  operationId: string,
  sessionId: string
) {
  await transaction
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, scope.workspaceId))
    .for("update");

  const identity = and(
    eq(workstreams.workspaceId, scope.workspaceId),
    eq(workstreams.scopeKey, scopeKey),
    eq(workstreams.id, parsed.id)
  );

  const [current] = await transaction
    .select()
    .from(workstreams)
    .where(identity)
    .limit(1);

  if (current?.lastOperationId === operationId) {
    return workstreamResult(current);
  }

  if (revisionMismatch(current, parsed.expectedRevision)) {
    throw new Error(
      "Workstream changed or was forgotten. Read it again and reconcile your update; use a new ID for a forgotten workstream."
    );
  }

  if (!current) {
    await assertWorkstreamCapacity(transaction, scope, scopeKey);
  }

  const values = {
    content: parsed.content,
    lastOperationId: operationId,
    revision: parsed.expectedRevision + 1,
    sessionId,
    updatedAt: new Date(),
  };

  const saved = await writeWorkstreamRow(transaction, {
    current,
    identity,
    values,
    id: parsed.id,
    scopeKey,
    workspaceId: scope.workspaceId,
    expectedRevision: parsed.expectedRevision,
  });

  if (!saved) throw new Error("The workstream could not be saved.");

  return workstreamResult(saved);
}

export async function saveWorkstream(
  scope: AccessScope,
  scopeKey: string,
  input: z.infer<typeof saveWorkstreamSchema>,
  operationId: string,
  sessionId: string
) {
  const parsed = saveWorkstreamSchema.parse(input);
  await ensureScope(scope);

  return db.transaction((transaction) =>
    saveWorkstreamInTransaction(
      transaction,
      scope,
      scopeKey,
      parsed,
      operationId,
      sessionId
    )
  );
}

export async function forgetWorkstream(
  scope: AccessScope,
  scopeKey: string,
  input: z.infer<typeof forgetWorkstreamSchema>,
  operationId: string
) {
  const { id, expectedRevision } = forgetWorkstreamSchema.parse(input);
  await ensureScope(scope);

  return db.transaction(async (transaction) => {
    // Use the same lock as saves so forgetting also fences a delayed initial create.
    await transaction
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, scope.workspaceId))
      .for("update");

    const identity = and(
      eq(workstreams.workspaceId, scope.workspaceId),
      eq(workstreams.scopeKey, scopeKey),
      eq(workstreams.id, id)
    );

    const [current] = await transaction
      .select()
      .from(workstreams)
      .where(identity)
      .limit(1);

    if (current?.content === null) return { forgotten: true };

    if (current && current.revision !== expectedRevision) {
      throw new Error(
        "Workstream changed. Read the current revision before forgetting it."
      );
    }

    // Retain only a tombstone, including when a save for this ID has not arrived yet.
    const values = {
      content: null,
      sessionId: null,
      revision: (current?.revision ?? 0) + 1,
      lastOperationId: operationId,
      updatedAt: new Date(),
    };

    if (current) {
      await transaction.update(workstreams).set(values).where(identity);
    } else {
      await transaction
        .insert(workstreams)
        .values({ ...values, id, scopeKey, workspaceId: scope.workspaceId });
    }

    return { forgotten: true };
  });
}

function workstreamResult(row: typeof workstreams.$inferSelect) {
  return {
    id: row.id,
    revision: row.revision,
    content: row.content,
    sessionId: row.sessionId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function workstreamSummary(row: typeof workstreams.$inferSelect) {
  return {
    id: row.id,
    revision: row.revision,
    title: row.content?.title,
    objective: row.content?.objective,
    status: row.content?.status,
    nextStep: row.content?.nextStep,
  };
}

import { PgClient } from "@effect/sql-pg";
import type { Context } from "effect";
import { Effect, Schema } from "effect";
import { inputRequestSchema } from "eve/client";

import { scheduledRunOutcomeSchema } from "../../shared/schedules/outcome";
import { ChannelTransport } from "../channels/transport";
import { requireScheduledChannelOwner } from "./channel-owner";
import {
  nativeReportReceiptStatus,
  nativeReportOutputSetComplete,
  renderNativeReport,
} from "./native-report-render";

const reportSchema = Schema.Struct({
  id: Schema.String,
  reportSequence: Schema.Int,
  conversationChannel: Schema.Literals(["telegram", "kapso"]),
  conversationId: Schema.String,
  createdByUserId: Schema.String,
  workspaceId: Schema.String,
  prompt: Schema.String,
  outcome: Schema.Unknown,
  pendingInputRequests: Schema.Unknown,
  reportStatus: Schema.String,
});

const decodeEffect_reportSchema = Schema.decodeUnknownEffect(reportSchema);

class NativeReportInvalid extends Schema.TaggedError<NativeReportInvalid>()(
  "NativeReportInvalid",
  {}
) {}

// Existing outcome/input schemas belong to the scheduler/Eve boundary; no second validator.
const renderStoredReport = Effect.fn("renderStoredReport")(function* (
  report: typeof reportSchema.Type
) {
  if (report.outcome === null && report.pendingInputRequests === null)
    return yield* new NativeReportInvalid();

  return yield* Effect.try({
    try: () =>
      renderNativeReport({
        prompt: report.prompt,
        outcome:
          report.outcome === null
            ? null
            : scheduledRunOutcomeSchema.parse(report.outcome),
        pendingInputRequests:
          report.pendingInputRequests === null
            ? null
            : inputRequestSchema
                .array()
                .min(1)
                .parse(report.pendingInputRequests),
      }),
    catch: () => new NativeReportInvalid(),
  });
});

type ServiceOf<S> =
  S extends Context.Service<infer _I, infer Api> ? Api : never;

type Sql = PgClient.PgClient;

type TransportService = ServiceOf<typeof ChannelTransport>;

type Report = typeof reportSchema.Type;

const isOpenReportStatus = (status: string) =>
  ["pending", "queued"].includes(status);

const hasRecoverableReportState = (
  report: Report,
  outputs: readonly unknown[],
  chunks: readonly unknown[]
) =>
  report.reportStatus === "queued" || outputs.length > 0 || chunks.length > 0;

const chunkStatuses = (chunks: readonly { readonly status: string }[]) =>
  chunks.map((chunk) => chunk.status);

interface ReportOutput {
  readonly chunkIndex: number;
  readonly outboxId: string;
}

interface ReportChunk {
  readonly id: string;
  readonly key: string;
  readonly status: string;
}

const recoverQueuedReportStatus = (
  report: Report,
  outputs: readonly ReportOutput[],
  chunks: readonly ReportChunk[],
  prefix: string
) => {
  const complete =
    report.reportStatus === "queued" &&
    nativeReportOutputSetComplete(outputs, chunks, prefix);

  if (complete) return nativeReportReceiptStatus(chunkStatuses(chunks));

  return "uncertain" as const;
};

const isInactiveTransportOwner = (error: { readonly reason: string }) =>
  error.reason === "identity_inactive" || error.reason === "channel_mismatch";

const requireActiveReportOwner = (report: Report) =>
  requireScheduledChannelOwner(report).pipe(
    Effect.as(true),
    Effect.catchTag("ScheduleOwnerInactive", () => Effect.succeed(false)),
    Effect.catchTag("ChannelTransportError", (error) =>
      isInactiveTransportOwner(error)
        ? Effect.succeed(false)
        : Effect.fail(error)
    )
  );

const insertReportOutput = (input: {
  readonly sql: Sql;
  readonly runId: string;
  readonly reportSequence: number;
  readonly receipt: { readonly id: string };
  readonly index: number;
}) => {
  const { sql, runId, reportSequence, receipt, index } = input;

  return sql`INSERT INTO scheduled_agent_report_outputs (run_id, report_sequence, chunk_index, outbox_id)
        VALUES (${runId}, ${reportSequence}, ${index}, ${receipt.id})`;
};

const makeDispatchNativeScheduledReport = Effect.fn(
  "makeDispatchNativeScheduledReport"
)(function* (sql: Sql, transport: TransportService, runId: string) {
  const rows =
    yield* sql`SELECT r.id, r.report_sequence AS "reportSequence", r.report_status AS "reportStatus",
      r.outcome, r.pending_input_requests AS "pendingInputRequests", j.prompt,
      j.conversation_channel AS "conversationChannel", j.conversation_id AS "conversationId",
      j.created_by_user_id AS "createdByUserId", j.workspace_id AS "workspaceId"
      FROM scheduled_agent_runs r JOIN scheduled_agent_jobs j ON j.id = r.job_id
      WHERE r.id = ${runId} AND j.conversation_channel IN ('telegram', 'kapso')
      AND r.status IN ('completed', 'dead_letter', 'waiting_for_input') FOR UPDATE OF r`;

  if (!rows[0]) return false;
  const report = yield* decodeEffect_reportSchema(rows[0]);

  if (!isOpenReportStatus(report.reportStatus)) return true;
  const deliveryKey = `schedulereport:${runId}:${String(report.reportSequence)}`;
  const prefix = `${deliveryKey}:`;

  const outputs = yield* sql<{
    chunkIndex: number;
    outboxId: string;
  }>`SELECT chunk_index AS "chunkIndex", outbox_id AS "outboxId"
        FROM scheduled_agent_report_outputs
        WHERE run_id = ${runId} AND report_sequence = ${report.reportSequence} ORDER BY chunk_index`;

  const chunks = yield* sql<{
    id: string;
    key: string;
    status: string;
  }>`SELECT id, delivery_key AS key, status
        FROM channel_outbox WHERE identity_id = ${report.conversationId}
        AND left(delivery_key, char_length(${prefix})) = ${prefix}`;

  // Queued is the commit seal: enqueue, the complete bindings and this transition
  // share one transaction. Recovery compares every durable chunk, never a subset.
  if (hasRecoverableReportState(report, outputs, chunks)) {
    const status = recoverQueuedReportStatus(report, outputs, chunks, prefix);
    yield* sql`UPDATE scheduled_agent_runs SET report_status = ${status}, updated_at = clock_timestamp()
          WHERE id = ${runId} AND report_sequence = ${report.reportSequence}`;

    return true;
  }

  const active = yield* requireActiveReportOwner(report);

  if (!active) {
    yield* sql`UPDATE scheduled_agent_runs SET report_status = 'cancelled',
        report_lease_token = NULL, report_lease_expires_at = NULL, updated_at = clock_timestamp()
        WHERE id = ${runId} AND report_sequence = ${report.reportSequence}`;

    return true;
  }

  const text = yield* renderStoredReport(report);

  if (!text) {
    yield* sql`UPDATE scheduled_agent_runs SET report_status = 'not_needed', updated_at = clock_timestamp()
        WHERE id = ${runId} AND report_sequence = ${report.reportSequence}`;

    return true;
  }

  const receipts = yield* transport.enqueueText({
    identityId: report.conversationId,
    deliveryKey,
    text,
  });

  yield* Effect.forEach(
    receipts,
    (receipt, index) =>
      insertReportOutput({
        sql,
        runId,
        reportSequence: report.reportSequence,
        receipt,
        index,
      }),
    { concurrency: 1, discard: true }
  );

  yield* sql`UPDATE scheduled_agent_runs SET report_status = 'queued',
      report_lease_token = NULL, report_lease_expires_at = NULL, updated_at = clock_timestamp()
      WHERE id = ${runId} AND report_sequence = ${report.reportSequence}`;

  return true;
});

export const dispatchNativeScheduledReport = Effect.fn(
  "dispatchNativeScheduledReport"
)(function* (runId: string) {
  const sql = yield* PgClient.PgClient;
  const transport = yield* ChannelTransport;

  return yield* sql.withTransaction(
    makeDispatchNativeScheduledReport(sql, transport, runId)
  );
});

/** Enqueue durably, attempt delivery after commit, then reconcile actual receipts. */
export const deliverNativeScheduledReport = Effect.fn(
  "deliverNativeScheduledReport"
)(function* (runId: string) {
  yield* dispatchNativeScheduledReport(runId);
  const sql = yield* PgClient.PgClient;

  const rows = yield* sql<{ identityId: string }>`
      SELECT j.conversation_id AS "identityId"
      FROM scheduled_agent_runs r JOIN scheduled_agent_jobs j ON j.id = r.job_id
      WHERE r.id = ${runId} AND r.report_status = 'queued'
        AND j.conversation_channel IN ('telegram', 'kapso')`;

  if (!rows[0]) return;
  const transport = yield* ChannelTransport;

  const delivery = yield* transport
    .drainOutbox(rows[0].identityId)
    .pipe(Effect.result);

  yield* dispatchNativeScheduledReport(runId);
  yield* Effect.fromResult(delivery);
});

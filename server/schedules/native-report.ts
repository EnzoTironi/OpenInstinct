import { PgClient } from "@effect/sql-pg";
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

export const dispatchNativeScheduledReport = Effect.fn(
  "dispatchNativeScheduledReport"
)(function* (runId: string) {
  const sql = yield* PgClient.PgClient;
  const transport = yield* ChannelTransport;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const rows =
        yield* sql`SELECT r.id, r.report_sequence AS "reportSequence", r.report_status AS "reportStatus",
      r.outcome, r.pending_input_requests AS "pendingInputRequests", j.prompt,
      j.conversation_channel AS "conversationChannel", j.conversation_id AS "conversationId",
      j.created_by_user_id AS "createdByUserId", j.workspace_id AS "workspaceId"
      FROM scheduled_agent_runs r JOIN scheduled_agent_jobs j ON j.id = r.job_id
      WHERE r.id = ${runId} AND j.conversation_channel IN ('telegram', 'kapso')
      AND r.status IN ('completed', 'dead_letter', 'waiting_for_input') FOR UPDATE OF r`;
      if (!rows[0]) return false;
      const report = yield* Schema.decodeUnknownEffect(reportSchema)(rows[0]);
      if (!["pending", "queued"].includes(report.reportStatus)) return true;
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
      if (
        report.reportStatus === "queued" ||
        outputs.length > 0 ||
        chunks.length > 0
      ) {
        const complete =
          report.reportStatus === "queued" &&
          nativeReportOutputSetComplete(outputs, chunks, prefix);
        const status = complete
          ? nativeReportReceiptStatus(chunks.map((chunk) => chunk.status))
          : "uncertain";
        yield* sql`UPDATE scheduled_agent_runs SET report_status = ${status}, updated_at = clock_timestamp()
          WHERE id = ${runId} AND report_sequence = ${report.reportSequence}`;
        return true;
      }
      const active = yield* requireScheduledChannelOwner(report).pipe(
        Effect.as(true),
        Effect.catchTag("ScheduleOwnerInactive", () => Effect.succeed(false)),
        Effect.catchTag("ChannelTransportError", (error) =>
          error.reason === "identity_inactive" ||
          error.reason === "channel_mismatch"
            ? Effect.succeed(false)
            : Effect.fail(error)
        )
      );
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
      for (const [index, receipt] of receipts.entries()) {
        yield* sql`INSERT INTO scheduled_agent_report_outputs (run_id, report_sequence, chunk_index, outbox_id)
        VALUES (${runId}, ${report.reportSequence}, ${index}, ${receipt.id})`;
      }
      yield* sql`UPDATE scheduled_agent_runs SET report_status = 'queued',
      report_lease_token = NULL, report_lease_expires_at = NULL, updated_at = clock_timestamp()
      WHERE id = ${runId} AND report_sequence = ${report.reportSequence}`;
      return true;
    })
  );
});

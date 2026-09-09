import { Schema } from "effect";

export const scheduledReportStatusSchema = Schema.Literals([
  "not_ready",
  "not_needed",
  "pending",
  "queued",
  "delivered",
  "suppressed",
  "failed",
  "cancelled",
  "uncertain",
]);

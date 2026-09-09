CREATE TABLE "scheduled_agent_report_outputs" (
	"run_id" uuid NOT NULL,
	"report_sequence" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"outbox_id" uuid NOT NULL,
	CONSTRAINT "scheduled_agent_report_outputs_pkey" PRIMARY KEY("run_id","report_sequence","chunk_index"),
	CONSTRAINT "scheduled_agent_report_outputs_sequence_check" CHECK ("scheduled_agent_report_outputs"."report_sequence" >= 0),
	CONSTRAINT "scheduled_agent_report_outputs_chunk_check" CHECK ("scheduled_agent_report_outputs"."chunk_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "scheduled_agent_jobs" DROP CONSTRAINT "scheduled_agent_jobs_conversation_channel_check";--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" DROP CONSTRAINT "scheduled_agent_runs_report_status_check";--> statement-breakpoint
ALTER TABLE "scheduled_agent_report_outputs" ADD CONSTRAINT "scheduled_agent_report_outputs_run_id_scheduled_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scheduled_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_agent_report_outputs" ADD CONSTRAINT "scheduled_agent_report_outputs_outbox_id_channel_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."channel_outbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_agent_report_outputs_outbox_uidx" ON "scheduled_agent_report_outputs" USING btree ("outbox_id");--> statement-breakpoint
ALTER TABLE "scheduled_agent_jobs" ADD CONSTRAINT "scheduled_agent_jobs_conversation_channel_check" CHECK ("scheduled_agent_jobs"."conversation_channel" IN ('eve', 'linq', 'telegram', 'kapso'));--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" ADD CONSTRAINT "scheduled_agent_runs_report_status_check" CHECK ("scheduled_agent_runs"."report_status" IN ('not_ready', 'not_needed', 'pending', 'queued', 'delivered', 'suppressed', 'failed', 'cancelled', 'uncertain'));
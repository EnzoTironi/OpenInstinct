CREATE TABLE "agent_protocol_cancellations" (
	"session_id" text PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matrix_room_retirements" (
	"room_id" text PRIMARY KEY NOT NULL,
	"server_name" text NOT NULL,
	"sender_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Cancellation must survive ON DELETE CASCADE, including a member removed while
-- a native session is running. Outbox delivery is idempotent and acknowledged by Eve.
CREATE FUNCTION enqueue_agent_protocol_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE native_session text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_CANCELED') THEN
      native_session := OLD.session_id;
    END IF;
  ELSIF NEW.state = 'TASK_STATE_CANCELED' THEN
    native_session := NEW.session_id;
  END IF;
  IF native_session IS NOT NULL THEN
    INSERT INTO agent_protocol_cancellations(session_id) VALUES (native_session) ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER agent_protocol_cancellation_outbox BEFORE UPDATE OR DELETE ON agent_protocol_tasks
FOR EACH ROW EXECUTE FUNCTION enqueue_agent_protocol_cancellation();
--> statement-breakpoint
CREATE FUNCTION enqueue_matrix_room_retirement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL) THEN
    INSERT INTO matrix_room_retirements(room_id, server_name, sender_id, bot_id)
      VALUES (OLD.room_id, OLD.server_name, OLD.sender_id, OLD.bot_id) ON CONFLICT DO NOTHING;
    UPDATE agent_protocol_tasks SET state = 'TASK_STATE_CANCELED', output = NULL, updated_at = now()
      WHERE grant_id = OLD.grant_id AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER matrix_room_retirement_outbox BEFORE UPDATE OR DELETE ON matrix_agent_conversations
FOR EACH ROW EXECUTE FUNCTION enqueue_matrix_room_retirement();
--> statement-breakpoint
CREATE FUNCTION close_revoked_matrix_conversations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    UPDATE matrix_agent_conversations SET closed_at = now() WHERE grant_id = NEW.id AND closed_at IS NULL;
    UPDATE agent_protocol_tasks SET state = 'TASK_STATE_CANCELED', output = NULL, updated_at = now()
      WHERE grant_id = NEW.id AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER matrix_grant_revocation AFTER UPDATE OF revoked_at ON workspace_agent_grants
FOR EACH ROW EXECUTE FUNCTION close_revoked_matrix_conversations();

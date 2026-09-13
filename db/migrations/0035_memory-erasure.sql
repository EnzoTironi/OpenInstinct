CREATE TABLE workspace_memory_erasure (
  namespace_id uuid PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE FUNCTION queue_workspace_memory_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO workspace_memory_erasure(namespace_id) VALUES (OLD.namespace_id) ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_memory_erasure_on_delete AFTER DELETE ON workspace_memory_namespace
FOR EACH ROW EXECUTE FUNCTION queue_workspace_memory_erasure();
--> statement-breakpoint
CREATE FUNCTION remove_account_memory_namespaces() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM workspace_memory_namespace WHERE user_id = 'better-auth:' || OLD.id;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_memory_erasure_on_delete AFTER DELETE ON public."user"
FOR EACH ROW EXECUTE FUNCTION remove_account_memory_namespaces();

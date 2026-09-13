CREATE TABLE workspace_memory_namespace (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  namespace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT true,
  eve_scope_key text UNIQUE,
  pending_operation text,
  pending_hash text,
  PRIMARY KEY (workspace_id, user_id),
  UNIQUE (namespace_id)
);
--> statement-breakpoint
CREATE TABLE workspace_memory_recall (
  namespace_id uuid NOT NULL REFERENCES workspace_memory_namespace(namespace_id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace_id, operation_id)
);

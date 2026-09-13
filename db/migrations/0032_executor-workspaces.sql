ALTER TABLE workspaces ADD COLUMN display_name text;
--> statement-breakpoint
CREATE TABLE workspace_repository (
  workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  head_sha text NOT NULL CHECK (head_sha ~ '^[a-f0-9]{40}$'),
  bundle bytea NOT NULL CHECK (octet_length(bundle) <= 25165824),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE workspace_revision (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  revision text NOT NULL CHECK (revision ~ '^[a-f0-9]{40}$'),
  parent_revision text,
  operation_id uuid NOT NULL,
  request_hash text NOT NULL,
  path text NOT NULL,
  author_user_id text NOT NULL,
  source text NOT NULL DEFAULT 'editor',
  source_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, revision),
  UNIQUE (workspace_id, operation_id)
);
--> statement-breakpoint
CREATE INDEX workspace_revision_history ON workspace_revision(workspace_id, created_at DESC);

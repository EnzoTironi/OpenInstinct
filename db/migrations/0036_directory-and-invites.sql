CREATE TABLE user_directory (
  user_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z][a-z0-9_]{2,29}$'),
  discoverable boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE TABLE workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  target_user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  invited_by_user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX workspace_invites_recipient_idx ON workspace_invites(target_user_id, status);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_invites_pending_idx ON workspace_invites(workspace_id, target_user_id) WHERE status = 'pending';

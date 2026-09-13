CREATE TABLE workspace_source (
  workspace_id text NOT NULL,
  revision text NOT NULL,
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  content bytea NOT NULL CHECK (octet_length(content) <= 10485760),
  PRIMARY KEY (workspace_id, revision),
  FOREIGN KEY (workspace_id, revision) REFERENCES workspace_revision(workspace_id, revision) ON DELETE CASCADE
);

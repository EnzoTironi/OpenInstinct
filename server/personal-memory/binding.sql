CREATE TABLE personal_memory_binding (
  key text PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 512 AND trim(key) = key),
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  namespace text NOT NULL CHECK (octet_length(namespace) BETWEEN 1 AND 1024),
  slot text NOT NULL CHECK (slot = 'profile'),
  UNIQUE (workspace_id, namespace, slot)
);

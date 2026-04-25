-- ============================================================
-- OROCHIMARU — Schéma de base de données (agent infrastructure)
-- ============================================================

-- État de santé des outils (historique)
CREATE TABLE IF NOT EXISTS tool_status (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name        TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('up', 'down', 'degraded', 'unknown')),
  response_time_ms INTEGER,
  error_message    TEXT,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_status_name    ON tool_status(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_status_checked ON tool_status(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_status_status  ON tool_status(status)
  WHERE status IN ('down', 'degraded');

-- Journal des sauvegardes
CREATE TABLE IF NOT EXISTS backups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type           TEXT NOT NULL CHECK (type IN ('supabase_tables', 'full')),
  status         TEXT NOT NULL CHECK (status IN ('success', 'failed', 'running')),
  r2_key         TEXT,
  size_bytes     BIGINT,
  duration_ms    INTEGER,
  tables_backed  JSONB NOT NULL DEFAULT '[]',
  rows_exported  INTEGER,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backups_status  ON backups(status);
CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC);

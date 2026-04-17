-- Table des statuts des agents
CREATE TABLE IF NOT EXISTS agents_status (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name  TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('OK', 'ERREUR', 'EN_COURS', 'INACTIF')),
  last_run    TIMESTAMPTZ NOT NULL DEFAULT now(),
  errors      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agents_status_agent_name ON agents_status(agent_name);
CREATE INDEX IF NOT EXISTS idx_agents_status_last_run ON agents_status(last_run DESC);

-- Table des rapports quotidiens
CREATE TABLE IF NOT EXISTS daily_reports (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date      DATE NOT NULL UNIQUE,
  content   JSONB NOT NULL,
  sent_at   TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(date DESC);

-- Table des alertes
CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name  TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('INFO', 'WARNING', 'URGENT')),
  message     TEXT NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_agent_name ON alerts(agent_name);
CREATE INDEX IF NOT EXISTS idx_alerts_level ON alerts(level);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved_at ON alerts(resolved_at);

-- Trigger pour mettre à jour updated_at sur agents_status
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agents_status_updated_at
  BEFORE UPDATE ON agents_status
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

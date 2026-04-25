-- ============================================================
-- ROBIN — Schéma de base de données (agent support client)
-- ============================================================

CREATE TABLE IF NOT EXISTS tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number     TEXT NOT NULL UNIQUE,              -- TKT-2026-001
  from_email        TEXT NOT NULL,
  from_name         TEXT NOT NULL,
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN ('technique', 'facturation', 'general', 'urgent')),
  priority          TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'in_progress', 'resolved', 'escalated', 'closed')),
  summary           TEXT,
  response_sent     TEXT,                              -- réponse envoyée (HTML)
  auto_response_sent TIMESTAMPTZ,
  escalated_at      TIMESTAMPTZ,
  escalated_to      TEXT,
  escalation_reason TEXT,
  resolved_at       TIMESTAMPTZ,
  resolution        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status    ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority  ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_category  ON tickets(category);
CREATE INDEX IF NOT EXISTS idx_tickets_email     ON tickets(from_email);
CREATE INDEX IF NOT EXISTS idx_tickets_created   ON tickets(created_at DESC);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_tickets_updated_at();

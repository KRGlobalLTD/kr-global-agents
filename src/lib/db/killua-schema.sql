-- ============================================================
-- KILLUA — Schéma de base de données (agent prospection)
-- ============================================================

-- Table des campagnes de prospection
CREATE TABLE IF NOT EXISTS campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED')),
  filters          JSONB,                    -- critères Apollo stockés
  total_prospects  INTEGER NOT NULL DEFAULT 0,
  emails_sent      INTEGER NOT NULL DEFAULT 0,
  replies          INTEGER NOT NULL DEFAULT 0,
  conversions      INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- Extension de la table prospects (colonnes KILLUA)
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS campaign_id              UUID REFERENCES campaigns(id),
  ADD COLUMN IF NOT EXISTS apollo_id                TEXT,
  ADD COLUMN IF NOT EXISTS job_title                TEXT,
  ADD COLUMN IF NOT EXISTS industry                 TEXT,
  ADD COLUMN IF NOT EXISTS employee_count           INTEGER,
  ADD COLUMN IF NOT EXISTS linkedin_url             TEXT,
  ADD COLUMN IF NOT EXISTS outreach_initial_sent    TIMESTAMPTZ,   -- J+0
  ADD COLUMN IF NOT EXISTS outreach_followup1_sent  TIMESTAMPTZ,   -- J+3
  ADD COLUMN IF NOT EXISTS outreach_followup2_sent  TIMESTAMPTZ,   -- J+7
  ADD COLUMN IF NOT EXISTS outreach_replied_at      TIMESTAMPTZ;   -- réponse détectée

-- Index unique sur apollo_id pour déduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_apollo_id
  ON prospects(apollo_id) WHERE apollo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospects_campaign_id ON prospects(campaign_id)
  WHERE campaign_id IS NOT NULL;

-- Mise à jour de la contrainte source pour inclure APOLLO
ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_source_check;
ALTER TABLE prospects ADD CONSTRAINT prospects_source_check
  CHECK (source IN ('EMAIL', 'FORM', 'MANUAL', 'APOLLO'));

-- Trigger updated_at sur campaigns
CREATE OR REPLACE FUNCTION update_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_campaigns_updated_at();

-- ============================================================
-- CHOPPER — Schéma de base de données (agent RH & freelances)
-- ============================================================

-- Table des freelances
CREATE TABLE IF NOT EXISTS freelances (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL UNIQUE,
  skills               JSONB NOT NULL DEFAULT '[]',
  hourly_rate          NUMERIC(10, 2),
  currency             TEXT NOT NULL DEFAULT 'EUR',
  platform             TEXT NOT NULL DEFAULT 'direct'
                         CHECK (platform IN ('upwork', 'fiverr', 'direct', 'autre')),
  platform_profile_url TEXT,
  score                NUMERIC(3, 1) CHECK (score BETWEEN 0 AND 5),
  score_detail         JSONB,                         -- détail par critère
  blacklisted          BOOLEAN NOT NULL DEFAULT false,
  blacklist_reason     TEXT,
  blacklisted_at       TIMESTAMPTZ,
  missions_completed   INTEGER NOT NULL DEFAULT 0,
  bio                  TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_freelances_platform    ON freelances(platform);
CREATE INDEX IF NOT EXISTS idx_freelances_blacklisted ON freelances(blacklisted);
CREATE INDEX IF NOT EXISTS idx_freelances_score       ON freelances(score DESC) WHERE score IS NOT NULL;

-- Table des missions
CREATE TABLE IF NOT EXISTS missions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_number    TEXT NOT NULL UNIQUE,             -- MSN-2026-001
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  skills_required   JSONB NOT NULL DEFAULT '[]',
  budget_min        NUMERIC(12, 2),
  budget_max        NUMERIC(12, 2),
  currency          TEXT NOT NULL DEFAULT 'EUR',
  duration_weeks    INTEGER,
  status            TEXT NOT NULL DEFAULT 'ouvert'
                      CHECK (status IN ('ouvert', 'en_cours', 'livre', 'termine')),
  freelance_id      UUID REFERENCES freelances(id) ON DELETE SET NULL,
  upwork_job_id     TEXT,
  fiverr_brief      TEXT,                             -- contenu formaté pour Fiverr (post manuel)
  published_at      TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_missions_status      ON missions(status);
CREATE INDEX IF NOT EXISTS idx_missions_freelance   ON missions(freelance_id) WHERE freelance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_missions_created     ON missions(created_at DESC);

-- Table des contrats
CREATE TABLE IF NOT EXISTS contracts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number  TEXT NOT NULL UNIQUE,              -- CTR-2026-001
  mission_id       UUID REFERENCES missions(id) ON DELETE SET NULL,
  freelance_id     UUID REFERENCES freelances(id) ON DELETE SET NULL,
  type             TEXT NOT NULL CHECK (type IN ('nda', 'mission', 'nda_mission')),
  content_html     TEXT NOT NULL,
  sent_at          TIMESTAMPTZ,
  signed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_mission    ON contracts(mission_id) WHERE mission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_freelance  ON contracts(freelance_id) WHERE freelance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_signed     ON contracts(signed_at) WHERE signed_at IS NULL;

-- Triggers updated_at
CREATE OR REPLACE FUNCTION update_freelances_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER freelances_updated_at
  BEFORE UPDATE ON freelances
  FOR EACH ROW EXECUTE FUNCTION update_freelances_updated_at();

CREATE OR REPLACE FUNCTION update_missions_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER missions_updated_at
  BEFORE UPDATE ON missions
  FOR EACH ROW EXECUTE FUNCTION update_missions_updated_at();

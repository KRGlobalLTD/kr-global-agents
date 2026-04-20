-- ============================================================
-- LUFFY — Schéma de base de données (agent emails entrants)
-- ============================================================

CREATE TABLE IF NOT EXISTS prospects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       TEXT UNIQUE,                        -- Message-ID email (dédup)
  name             TEXT,                               -- nom expéditeur
  contact_name     TEXT,                               -- alias pour rapports HASHIRAMA
  email            TEXT NOT NULL,
  company          TEXT,
  status           TEXT NOT NULL DEFAULT 'FROID'
                     CHECK (status IN ('CHAUD', 'FROID', 'CONVERTI', 'PERDU')),
  need             TEXT,                               -- besoin exprimé
  urgency          TEXT NOT NULL DEFAULT 'normale'
                     CHECK (urgency IN ('haute', 'normale', 'faible')),
  summary          TEXT,                               -- résumé IA
  estimated_value  NUMERIC(12, 2),                     -- valeur estimée du deal
  source           TEXT NOT NULL DEFAULT 'EMAIL'
                     CHECK (source IN ('EMAIL', 'FORM', 'MANUAL')),
  response_sent_at TIMESTAMPTZ,                        -- réponse LUFFY envoyée
  last_contact_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospects_email      ON prospects(email);
CREATE INDEX IF NOT EXISTS idx_prospects_status     ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_urgency    ON prospects(urgency);
CREATE INDEX IF NOT EXISTS idx_prospects_created_at ON prospects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospects_message_id ON prospects(message_id)
  WHERE message_id IS NOT NULL;

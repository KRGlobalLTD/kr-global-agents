-- ============================================================
-- NAMI — Schéma de base de données (agent onboarding)
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_customer_id  TEXT,
  stripe_payment_id   TEXT NOT NULL UNIQUE,   -- clé de déduplication webhook
  name                TEXT NOT NULL,
  email               TEXT NOT NULL,
  phone               TEXT,
  company             TEXT,
  country             TEXT,
  product             TEXT,                   -- description de l'achat
  amount_paid         NUMERIC(12, 2),
  currency            TEXT NOT NULL DEFAULT 'GBP',
  onboarded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at      TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'AT_RISK', 'CHURNED', 'COMPLETED')),
  -- Séquence email onboarding
  email_welcome_sent  TIMESTAMPTZ,            -- J+0
  email_brief_sent    TIMESTAMPTZ,            -- J+1
  email_update_sent   TIMESTAMPTZ,            -- J+7
  email_nps_sent      TIMESTAMPTZ,            -- J+30
  nps_score           SMALLINT CHECK (nps_score BETWEEN 0 AND 10),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_email           ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_stripe_customer ON clients(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_stripe_payment  ON clients(stripe_payment_id);
CREATE INDEX IF NOT EXISTS idx_clients_status          ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_onboarded_at    ON clients(onboarded_at DESC);

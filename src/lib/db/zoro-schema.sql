-- ============================================================
-- ZORO — Schéma de base de données (KR Global Solutions Ltd)
-- ============================================================

-- Table des transactions (revenus + dépenses)
CREATE TABLE IF NOT EXISTS transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date        TIMESTAMPTZ NOT NULL,
  amount      NUMERIC(12, 2) NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'EUR',
  category    TEXT NOT NULL CHECK (category IN (
    'SAAS', 'IA', 'PUBLICITE', 'FREELANCE',
    'REVENU_STRIPE', 'REVENU_GUMROAD', 'REVENU_AUTRE',
    'FRAIS_STRIPE', 'REMBOURSEMENT'
  )),
  entity      TEXT NOT NULL CHECK (entity IN ('KR_GLOBAL_UK', 'MAROC', 'FRANCE')),
  source      TEXT NOT NULL,
  description TEXT,
  stripe_id   TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_date     ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_transactions_entity   ON transactions(entity);
CREATE INDEX IF NOT EXISTS idx_transactions_stripe   ON transactions(stripe_id) WHERE stripe_id IS NOT NULL;

-- Table des rapports mensuels P&L
CREATE TABLE IF NOT EXISTS monthly_reports (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month      SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year       SMALLINT NOT NULL CHECK (year >= 2024),
  revenue    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  expenses   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  margin     NUMERIC(12, 2) GENERATED ALWAYS AS (revenue - expenses) STORED,
  content    JSONB NOT NULL,
  sent_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(month, year)
);

CREATE INDEX IF NOT EXISTS idx_monthly_reports_period ON monthly_reports(year DESC, month DESC);

-- Table des coûts d'outils SaaS
CREATE TABLE IF NOT EXISTS tool_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name    TEXT NOT NULL,
  amount       NUMERIC(12, 2) NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'EUR',
  billing_date DATE NOT NULL,
  entity       TEXT NOT NULL CHECK (entity IN ('KR_GLOBAL_UK', 'MAROC', 'FRANCE')),
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_costs_billing_date ON tool_costs(billing_date DESC);
CREATE INDEX IF NOT EXISTS idx_tool_costs_tool_name    ON tool_costs(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_costs_entity       ON tool_costs(entity);

-- Table des factures
CREATE TABLE IF NOT EXISTS invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number            TEXT NOT NULL UNIQUE,               -- KR-2026-001
  client_name       TEXT NOT NULL,
  client_email      TEXT NOT NULL,
  client_phone      TEXT,                               -- pour relance SMS
  amount            NUMERIC(12, 2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'EUR',
  issued_at         DATE NOT NULL,
  due_at            DATE NOT NULL,
  paid_at           DATE,
  r2_url            TEXT,                               -- URL PDF public
  status            TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','PAID','OVERDUE','WRITTEN_OFF')),
  reminder_7d_sent  TIMESTAMPTZ,
  reminder_14d_sent TIMESTAMPTZ,
  reminder_21d_sent TIMESTAMPTZ,
  reminder_30d_sent TIMESTAMPTZ,
  escalated_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_status  ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_at  ON invoices(due_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_number  ON invoices(number);

-- Table des échéances UK (Companies House, HMRC)
CREATE TABLE IF NOT EXISTS uk_deadlines (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT NOT NULL,
  deadline_type  TEXT NOT NULL CHECK (deadline_type IN (
    'CONFIRMATION_STATEMENT', 'ANNUAL_ACCOUNTS', 'CORPORATION_TAX', 'VAT'
  )),
  due_date       DATE NOT NULL,
  entity         TEXT NOT NULL CHECK (entity IN ('KR_GLOBAL_UK', 'MAROC', 'FRANCE')),
  alert_sent_30d TIMESTAMPTZ,
  alert_sent_14d TIMESTAMPTZ,
  alert_sent_7d  TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uk_deadlines_due_date ON uk_deadlines(due_date DESC);
CREATE INDEX IF NOT EXISTS idx_uk_deadlines_entity   ON uk_deadlines(entity);

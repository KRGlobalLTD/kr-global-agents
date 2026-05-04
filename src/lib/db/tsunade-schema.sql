-- ============================================================
-- TSUNADE — Schéma de base de données (agent finances & dividendes)
-- ============================================================

-- Calculs de dividendes trimestriels
CREATE TABLE IF NOT EXISTS dividend_calculations (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter                    SMALLINT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  year                       SMALLINT NOT NULL CHECK (year >= 2024),
  revenue                    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  expenses                   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  gross_profit               NUMERIC(14, 2) NOT NULL DEFAULT 0,
  corporation_tax_rate       NUMERIC(5, 4)  NOT NULL DEFAULT 0.19,
  corporation_tax            NUMERIC(14, 2) NOT NULL DEFAULT 0,
  profit_after_tax           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  retained_earnings_rate     NUMERIC(5, 4)  NOT NULL DEFAULT 0.20,
  retained_earnings_required NUMERIC(14, 2) NOT NULL DEFAULT 0,
  distributable_profit       NUMERIC(14, 2) NOT NULL DEFAULT 0,
  karim_share                NUMERIC(14, 2) NOT NULL DEFAULT 0,
  raphael_share              NUMERIC(14, 2) NOT NULL DEFAULT 0,
  currency                   TEXT NOT NULL DEFAULT 'EUR',
  status                     TEXT NOT NULL DEFAULT 'calculated'
                               CHECK (status IN ('calculated', 'approved', 'paid')),
  approved_at                TIMESTAMPTZ,
  paid_at                    TIMESTAMPTZ,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quarter, year)
);

CREATE INDEX IF NOT EXISTS idx_dividends_period ON dividend_calculations(year DESC, quarter DESC);
CREATE INDEX IF NOT EXISTS idx_dividends_status ON dividend_calculations(status);

-- Validations de dépenses
CREATE TABLE IF NOT EXISTS expense_validations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_number   TEXT NOT NULL UNIQUE,             -- EXP-2026-001
  description         TEXT NOT NULL,
  amount              NUMERIC(12, 2) NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  category            TEXT NOT NULL,
  requested_by        TEXT NOT NULL DEFAULT 'SYSTEM',
  threshold_tier      TEXT NOT NULL
                        CHECK (threshold_tier IN ('auto', 'log', 'require_approval')),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('auto_approved', 'logged', 'pending', 'approved', 'rejected')),
  approved_by         TEXT,
  approved_at         TIMESTAMPTZ,
  rejected_reason     TEXT,
  approval_email_sent TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_val_status   ON expense_validations(status);
CREATE INDEX IF NOT EXISTS idx_expense_val_threshold ON expense_validations(threshold_tier);
CREATE INDEX IF NOT EXISTS idx_expense_val_created  ON expense_validations(created_at DESC);

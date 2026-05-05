-- GARP — Rapports & KPIs
-- Exécuter dans Supabase SQL Editor

CREATE TABLE IF NOT EXISTS garp_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period       TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ NOT NULL,
  kpis         JSONB NOT NULL DEFAULT '{}',
  narrative    TEXT NOT NULL DEFAULT '',
  slack_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS garp_reports_period_idx     ON garp_reports (period);
CREATE INDEX IF NOT EXISTS garp_reports_created_at_idx ON garp_reports (created_at DESC);

CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period       TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ NOT NULL,
  revenus      NUMERIC(12,2) NOT NULL DEFAULT 0,
  depenses     NUMERIC(12,2) NOT NULL DEFAULT 0,
  marge_nette  NUMERIC(12,2) NOT NULL DEFAULT 0,
  marge_pct    NUMERIC(6,2)  NOT NULL DEFAULT 0,
  cout_ia      NUMERIC(12,2) NOT NULL DEFAULT 0,
  nouveaux_clients  INTEGER NOT NULL DEFAULT 0,
  taches_executees  INTEGER NOT NULL DEFAULT 0,
  taux_succes       NUMERIC(5,2) NOT NULL DEFAULT 100,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kpi_snapshots_period_idx ON kpi_snapshots (period, period_start DESC);

-- ============================================================
-- ITACHI — Schéma et migrations
-- ============================================================

-- Table principale du contenu (création initiale)
CREATE TABLE IF NOT EXISTS content (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marque           TEXT NOT NULL,
  type             TEXT NOT NULL,
  sujet            TEXT NOT NULL,
  ton              TEXT NOT NULL DEFAULT 'professionnel',
  langue           TEXT NOT NULL DEFAULT 'fr',
  longueur         TEXT NOT NULL DEFAULT 'moyen'
                     CHECK (longueur IN ('court', 'moyen', 'long')),
  entite_nom       TEXT NOT NULL,
  titre            TEXT,
  contenu          TEXT,
  hashtags         JSONB NOT NULL DEFAULT '[]',
  meta_description TEXT,
  statut           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (statut IN ('draft', 'approuve', 'publie', 'archive')),
  modele           TEXT,
  date_prevue      TIMESTAMPTZ,
  date_publication TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  likes            INTEGER NOT NULL DEFAULT 0,
  partages         INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Migration v2 — nouveaux types de contenu ITACHI
-- Exécuter même si la table existe déjà
-- ============================================================

-- Mettre à jour la contrainte CHECK sur le type
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_type_check;
ALTER TABLE content ADD CONSTRAINT content_type_check CHECK (
  type IN (
    'article_seo', 'post_linkedin', 'post_instagram', 'post_tiktok',
    'newsletter', 'script_podcast', 'script_youtube'
  )
);

ALTER TABLE content ADD COLUMN IF NOT EXISTS date_publication TIMESTAMPTZ;

-- ============================================================
-- Table calendrier saisonnier (nouvelle)
-- ============================================================

CREATE TABLE IF NOT EXISTS seasonal_calendar (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mois       INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
  secteur    TEXT NOT NULL,
  evenement  TEXT NOT NULL,
  intensite  TEXT NOT NULL DEFAULT 'normal'
               CHECK (intensite IN ('faible', 'normal', 'fort', 'critique')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seasonal_mois ON seasonal_calendar(mois);

-- ============================================================
-- Tables métriques et coûts (inchangées)
-- ============================================================

CREATE TABLE IF NOT EXISTS content_metrics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id  UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  vues        INTEGER NOT NULL DEFAULT 0,
  clics       INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_metrics_content_id  ON content_metrics(content_id);
CREATE INDEX IF NOT EXISTS idx_content_metrics_recorded_at ON content_metrics(recorded_at DESC);

CREATE TABLE IF NOT EXISTS couts_par_entite (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entite_nom    TEXT NOT NULL,
  agent_name    TEXT NOT NULL,
  modele        TEXT NOT NULL,
  operation     TEXT NOT NULL,
  tokens_input  INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  cout_estime   NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_couts_entite     ON couts_par_entite(entite_nom);
CREATE INDEX IF NOT EXISTS idx_couts_agent      ON couts_par_entite(agent_name);
CREATE INDEX IF NOT EXISTS idx_couts_created_at ON couts_par_entite(created_at DESC);

-- ============================================================
-- Index content
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_content_statut      ON content(statut);
CREATE INDEX IF NOT EXISTS idx_content_marque      ON content(marque);
CREATE INDEX IF NOT EXISTS idx_content_entite      ON content(entite_nom);
CREATE INDEX IF NOT EXISTS idx_content_type        ON content(type);
CREATE INDEX IF NOT EXISTS idx_content_date_prevue ON content(date_prevue);
CREATE INDEX IF NOT EXISTS idx_content_created     ON content(created_at DESC);

-- ============================================================
-- Trigger updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_content_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_updated_at ON content;
CREATE TRIGGER content_updated_at
  BEFORE UPDATE ON content
  FOR EACH ROW EXECUTE FUNCTION update_content_updated_at();

-- ============================================================
-- Données initiales seasonal_calendar
-- ============================================================

INSERT INTO seasonal_calendar (mois, secteur, evenement, intensite) VALUES
  (1,  'retail',      'Soldes hiver',              'fort'),
  (2,  'general',     'Saint-Valentin',             'normal'),
  (3,  'ecommerce',   'Printemps relance',          'normal'),
  (5,  'b2b',         'Fin Q1 bilan strategique',   'fort'),
  (6,  'recrutement', 'Saison recrutement ete',      'fort'),
  (7,  'tourisme',    'Haute saison ete',            'critique'),
  (8,  'ecommerce',   'Preparation rentree',         'fort'),
  (9,  'b2b',         'Rentree nouveaux budgets',    'critique'),
  (10, 'ecommerce',   'Pre-Black Friday',            'fort'),
  (11, 'ecommerce',   'Black Friday Cyber Monday',   'critique'),
  (12, 'general',     'Fetes de fin d annee',        'critique')
ON CONFLICT DO NOTHING;

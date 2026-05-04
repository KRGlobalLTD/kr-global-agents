-- ============================================================
-- ITACHI — Schéma de base de données (agent marketing & contenu)
-- ============================================================

-- Table du contenu généré
CREATE TABLE IF NOT EXISTS content (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marque           TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('article', 'post', 'strategie')),
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
  published_at     TIMESTAMPTZ,
  likes            INTEGER NOT NULL DEFAULT 0,
  partages         INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_statut  ON content(statut);
CREATE INDEX IF NOT EXISTS idx_content_marque  ON content(marque);
CREATE INDEX IF NOT EXISTS idx_content_entite  ON content(entite_nom);
CREATE INDEX IF NOT EXISTS idx_content_created ON content(created_at DESC);

-- Table des métriques de performance (une ligne = un enregistrement ponctuel)
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

-- Table des coûts IA ventilés par entité client
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

-- Trigger updated_at sur content
CREATE OR REPLACE FUNCTION update_content_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_updated_at
  BEFORE UPDATE ON content
  FOR EACH ROW EXECUTE FUNCTION update_content_updated_at();

-- ============================================================
-- Migration v2 — à exécuter si la table content existe déjà
-- ============================================================

ALTER TABLE content ADD COLUMN IF NOT EXISTS date_prevue TIMESTAMPTZ;
ALTER TABLE content ADD COLUMN IF NOT EXISTS likes       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content ADD COLUMN IF NOT EXISTS partages    INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_content_date_prevue ON content(date_prevue);

-- Fonction RPC pour incrémenter likes/partages en atomique
CREATE OR REPLACE FUNCTION increment_content_engagement(
  p_content_id UUID,
  p_likes      INTEGER DEFAULT 0,
  p_partages   INTEGER DEFAULT 0
) RETURNS VOID AS $$
BEGIN
  UPDATE content
  SET likes    = likes    + p_likes,
      partages = partages + p_partages
  WHERE id = p_content_id;
END;
$$ LANGUAGE plpgsql;

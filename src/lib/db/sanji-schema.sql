-- ============================================================
-- SANJI — Schéma de base de données (agent réseaux sociaux)
-- ============================================================

-- Table des publications par plateforme
CREATE TABLE IF NOT EXISTS social_publications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id       UUID REFERENCES content(id) ON DELETE SET NULL,
  plateforme       TEXT NOT NULL CHECK (plateforme IN ('linkedin', 'instagram', 'tiktok')),
  texte_adapte     TEXT NOT NULL,
  hashtags         JSONB NOT NULL DEFAULT '[]',
  statut           TEXT NOT NULL DEFAULT 'planifie'
                     CHECK (statut IN ('planifie', 'publie', 'echec')),
  platform_post_id TEXT,                              -- ID retourné par la plateforme
  erreur           TEXT,                              -- message d'erreur si statut=echec
  vues             INTEGER NOT NULL DEFAULT 0,
  likes            INTEGER NOT NULL DEFAULT 0,
  partages         INTEGER NOT NULL DEFAULT 0,
  commentaires     INTEGER NOT NULL DEFAULT 0,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_pub_statut      ON social_publications(statut);
CREATE INDEX IF NOT EXISTS idx_social_pub_plateforme  ON social_publications(plateforme);
CREATE INDEX IF NOT EXISTS idx_social_pub_content_id  ON social_publications(content_id)
  WHERE content_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_pub_created     ON social_publications(created_at DESC);

-- Table des mentions et commentaires surveillés
CREATE TABLE IF NOT EXISTS social_mentions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id      UUID REFERENCES social_publications(id) ON DELETE SET NULL,
  plateforme          TEXT NOT NULL CHECK (plateforme IN ('linkedin', 'instagram', 'tiktok')),
  platform_mention_id TEXT UNIQUE,                    -- déduplication
  auteur              TEXT,
  contenu             TEXT NOT NULL,
  sentiment           TEXT CHECK (sentiment IN ('positif', 'neutre', 'negatif')),
  opportunite         BOOLEAN NOT NULL DEFAULT false,
  raison              TEXT,                           -- explication IA
  alerted_at          TIMESTAMPTZ,
  replied_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_mentions_pub_id      ON social_mentions(publication_id)
  WHERE publication_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_mentions_plateforme  ON social_mentions(plateforme);
CREATE INDEX IF NOT EXISTS idx_social_mentions_opportunite ON social_mentions(opportunite)
  WHERE opportunite = true;
CREATE INDEX IF NOT EXISTS idx_social_mentions_created     ON social_mentions(created_at DESC);

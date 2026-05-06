-- ============================================================
-- SANJI Publer — Posts planifiés via Publer API
-- ============================================================

CREATE TABLE IF NOT EXISTS sanji_scheduled_posts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id       UUID        REFERENCES content(id) ON DELETE SET NULL,
  platform         TEXT        NOT NULL
                               CHECK (platform IN (
                                 'linkedin_company', 'linkedin_karim', 'linkedin_raphael',
                                 'instagram', 'tiktok', 'facebook'
                               )),
  texte            TEXT        NOT NULL,
  hashtags         JSONB       NOT NULL DEFAULT '[]',
  image_url        TEXT,                              -- URL R2 du visuel généré
  publer_post_id   TEXT,                              -- ID retourné par Publer
  scheduled_at     TIMESTAMPTZ NOT NULL,              -- créneau prévu (UTC)
  published_at     TIMESTAMPTZ,                       -- horodatage publication effective
  statut           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (statut IN ('pending', 'published', 'failed', 'cancelled')),
  erreur           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sanji_sched_statut       ON sanji_scheduled_posts(statut);
CREATE INDEX IF NOT EXISTS idx_sanji_sched_platform     ON sanji_scheduled_posts(platform);
CREATE INDEX IF NOT EXISTS idx_sanji_sched_scheduled_at ON sanji_scheduled_posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_sanji_sched_content_id   ON sanji_scheduled_posts(content_id)
  WHERE content_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sanji_sched_publer_id    ON sanji_scheduled_posts(publer_post_id)
  WHERE publer_post_id IS NOT NULL;

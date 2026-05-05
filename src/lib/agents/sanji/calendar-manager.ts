import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface ScheduledPost {
  id:           string;
  content_id:   string | null;
  platform:     string;
  content:      string;
  hashtags:     string[];
  status:       string;
  scheduled_at: string | null;
}

// Heures de publication par plateforme (UTC — London timezone ~= UTC en hiver)
const SCHEDULE_HOURS: Record<string, number> = {
  linkedin:  9,
  twitter:   12,
  instagram: 11,
};

export async function getScheduledPosts(platform?: string): Promise<ScheduledPost[]> {
  let query = supabase
    .from('social_posts')
    .select('id, content_id, platform, content_adapted, hashtags, status, scheduled_at')
    .eq('status', 'scheduled')
    .order('scheduled_at', { ascending: true });

  if (platform) query = query.eq('platform', platform);

  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture calendrier : ${error.message}`);

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id:           r['id'] as string,
      content_id:   r['content_id'] as string | null,
      platform:     r['platform'] as string,
      content:      r['content_adapted'] as string,
      hashtags:     Array.isArray(r['hashtags']) ? r['hashtags'] as string[] : [],
      status:       r['status'] as string,
      scheduled_at: r['scheduled_at'] as string | null,
    };
  });
}

export async function markAsPublished(id: string, postUrl?: string): Promise<void> {
  await supabase
    .from('social_posts')
    .update({ status: 'published', published_at: new Date().toISOString(), post_url: postUrl ?? null })
    .eq('id', id);
}

export async function scheduleFromApprovedContent(): Promise<{ scheduled: number; skipped: number }> {
  // Récupère les contenus ITACHI approuvés non encore planifiés
  const { data: contents, error } = await supabase
    .from('content')
    .select('id, contenu, hashtags, type')
    .eq('statut', 'approuve')
    .order('created_at', { ascending: true })
    .limit(20);

  if (error) throw new Error(`Erreur lecture contenus approuvés : ${error.message}`);

  let scheduled = 0;
  let skipped   = 0;

  for (const row of (contents ?? []) as Record<string, unknown>[]) {
    const contentId = row['id'] as string;
    const contenu   = row['contenu'] as string ?? '';
    const hashtags  = Array.isArray(row['hashtags']) ? row['hashtags'] as string[] : [];

    // Vérifier si déjà planifié pour chaque plateforme
    const { data: existing } = await supabase
      .from('social_posts')
      .select('platform')
      .eq('content_id', contentId)
      .in('status', ['scheduled', 'published']);

    const alreadyScheduled = new Set(
      ((existing ?? []) as Record<string, unknown>[]).map(r => r['platform'] as string)
    );

    const platforms = ['linkedin', 'twitter', 'instagram'] as const;

    for (const platform of platforms) {
      if (alreadyScheduled.has(platform)) {
        skipped++;
        continue;
      }

      const scheduledAt = nextScheduleTime(platform);

      await supabase.from('social_posts').insert({
        content_id:      contentId,
        platform,
        content_adapted: contenu.slice(0, platform === 'twitter' ? 250 : 2000),
        hashtags,
        status:          'scheduled',
        scheduled_at:    scheduledAt,
      });

      scheduled++;
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'SANJI',
    level:      'INFO',
    message:    `Calendrier mis à jour : ${scheduled} posts planifiés, ${skipped} déjà existants`,
  });

  return { scheduled, skipped };
}

function nextScheduleTime(platform: string): string {
  const hour = SCHEDULE_HOURS[platform] ?? 12;
  const now  = new Date();
  const next = new Date(now);

  next.setUTCHours(hour, 0, 0, 0);

  // Si l'heure est passée aujourd'hui, planifier pour demain
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  return next.toISOString();
}

export async function getDuePostsForPlatform(platform: string): Promise<ScheduledPost[]> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('social_posts')
    .select('id, content_id, platform, content_adapted, hashtags, status, scheduled_at')
    .eq('platform', platform)
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(5);

  if (error) throw new Error(`Erreur lecture posts dus : ${error.message}`);

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id:           r['id'] as string,
      content_id:   r['content_id'] as string | null,
      platform:     r['platform'] as string,
      content:      r['content_adapted'] as string,
      hashtags:     Array.isArray(r['hashtags']) ? r['hashtags'] as string[] : [],
      status:       r['status'] as string,
      scheduled_at: r['scheduled_at'] as string | null,
    };
  });
}

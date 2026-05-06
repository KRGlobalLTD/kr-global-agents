import { createClient } from '@supabase/supabase-js';
import type { PubPlatform } from './format-adapter';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Créneaux optimaux en heure Paris (heure locale)
const OPTIMAL_SLOTS: Record<PubPlatform, { hour: number; minute: number }[]> = {
  linkedin_company:  [{ hour: 8, minute: 0 }, { hour: 12, minute: 30 }, { hour: 17, minute: 30 }],
  linkedin_karim:    [{ hour: 9, minute: 0 }, { hour: 13, minute: 0  }, { hour: 18, minute: 0  }],
  linkedin_raphael:  [{ hour: 9, minute: 0 }, { hour: 13, minute: 0  }, { hour: 18, minute: 0  }],
  instagram:         [{ hour: 9, minute: 0 }, { hour: 13, minute: 0  }, { hour: 19, minute: 0  }],
  tiktok:            [{ hour: 12, minute: 0 }, { hour: 18, minute: 0 }, { hour: 21, minute: 0  }],
  facebook:          [{ hour: 9, minute: 0 }, { hour: 13, minute: 0  }, { hour: 18, minute: 0  }],
};

// Jours préférés par plateforme (0=dimanche, 1=lundi…)
const PREFERRED_DAYS: Record<PubPlatform, number[]> = {
  linkedin_company:  [2, 3, 4],       // mar, mer, jeu
  linkedin_karim:    [1, 3, 5],       // lun, mer, ven
  linkedin_raphael:  [1, 3, 5],       // lun, mer, ven
  instagram:         [1, 2, 3, 4, 5], // lun–ven
  tiktok:            [1, 2, 3, 4, 5, 6], // lun–sam
  facebook:          [1, 2, 3, 4, 5], // lun–ven
};

function toParisIso(year: number, month: number, day: number, hour: number, minute: number): string {
  // Construit un ISO en tenant compte du fuseau Paris (UTC+1 hiver, UTC+2 été)
  // Approximation simple : on utilise le décalage de la date considérée
  const localDate = new Date(year, month - 1, day, hour, minute, 0);
  // Offset Paris par rapport à UTC (en janvier = -60min, en été = -120min)
  const jan = new Date(year, 0, 1).getTimezoneOffset();
  const jul = new Date(year, 6, 1).getTimezoneOffset();
  const stdOffset = Math.max(jan, jul); // offset std (hiver)
  const isDST     = localDate.getTimezoneOffset() < stdOffset;
  const parisOffsetMin = isDST ? -120 : -60; // Paris = UTC+1 ou UTC+2

  const utcMs = localDate.getTime() - parisOffsetMin * 60_000;
  return new Date(utcMs).toISOString();
}

interface ScheduledSlot {
  platform:     PubPlatform;
  scheduled_at: string; // ISO UTC
}

interface ExistingPost {
  platform:     string;
  scheduled_at: string;
}

export async function getNextSlot(platform: PubPlatform): Promise<string> {
  const slots    = OPTIMAL_SLOTS[platform];
  const days     = PREFERRED_DAYS[platform];
  const now      = new Date();

  // Charge les posts déjà planifiés dans les 14 prochains jours
  const horizon  = new Date(now.getTime() + 14 * 86_400_000).toISOString();

  const { data: existing } = await supabase
    .from('sanji_scheduled_posts')
    .select('platform, scheduled_at')
    .eq('platform', platform)
    .eq('statut', 'pending')
    .gte('scheduled_at', now.toISOString())
    .lte('scheduled_at', horizon);

  const takenSlots = new Set(
    ((existing ?? []) as ExistingPost[]).map(r => r.scheduled_at.slice(0, 16)) // "YYYY-MM-DDTHH:MM"
  );

  // Parcourir les 14 prochains jours
  for (let d = 0; d < 14; d++) {
    const candidate = new Date(now.getTime() + d * 86_400_000);
    const dow = candidate.getDay();

    if (!days.includes(dow)) continue;

    const year  = candidate.getFullYear();
    const month = candidate.getMonth() + 1;
    const day   = candidate.getDate();

    for (const slot of slots) {
      const iso = toParisIso(year, month, day, slot.hour, slot.minute);

      // Doit être dans le futur (au moins 30 min)
      if (new Date(iso).getTime() <= now.getTime() + 30 * 60_000) continue;

      // Doit être libre
      if (takenSlots.has(iso.slice(0, 16))) continue;

      return iso;
    }
  }

  // Fallback : demain à 9h
  const tomorrow = new Date(now.getTime() + 86_400_000);
  return toParisIso(tomorrow.getFullYear(), tomorrow.getMonth() + 1, tomorrow.getDate(), 9, 0);
}

export async function schedulePost(params: {
  content_id:  string;
  platform:    PubPlatform;
  texte:       string;
  hashtags:    string[];
  image_url?:  string;
  publer_post_id?: string;
}): Promise<string> {
  const scheduled_at = await getNextSlot(params.platform);

  const { data, error } = await supabase
    .from('sanji_scheduled_posts')
    .insert({
      content_id:      params.content_id,
      platform:        params.platform,
      texte:           params.texte,
      hashtags:        params.hashtags,
      image_url:       params.image_url ?? null,
      publer_post_id:  params.publer_post_id ?? null,
      scheduled_at,
      statut:          'pending',
    })
    .select('id')
    .single();

  if (error) throw new Error(`Erreur scheduling ${params.platform}: ${error.message}`);
  return (data as { id: string }).id;
}

export async function getDueScheduledPosts(): Promise<ScheduledSlot[]> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('sanji_scheduled_posts')
    .select('id, platform, scheduled_at, content_id, texte, hashtags, image_url, publer_post_id')
    .eq('statut', 'pending')
    .lte('scheduled_at', now);

  if (error) throw new Error(`getDueScheduledPosts: ${error.message}`);
  return (data ?? []) as unknown as ScheduledSlot[];
}

export async function markPostPublished(postId: string, publerPostId?: string): Promise<void> {
  await supabase
    .from('sanji_scheduled_posts')
    .update({
      statut:          'published',
      published_at:    new Date().toISOString(),
      publer_post_id:  publerPostId ?? null,
    })
    .eq('id', postId);
}

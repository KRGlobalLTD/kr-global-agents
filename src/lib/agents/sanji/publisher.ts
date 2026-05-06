import { createClient }             from '@supabase/supabase-js';
import { adaptForAllPlatforms, adaptForPlatform, type PubPlatform } from './format-adapter';
import { generateAndUploadImage }    from './image-generator';
import { schedulePost, markPostPublished } from './scheduler';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PUBLER_BASE = 'https://app.publer.io/api/v1';

// Mapping plateforme → Publer account_id (configuré dans Doppler)
function getPublerAccountId(platform: PubPlatform): string | null {
  const map: Record<PubPlatform, string | undefined> = {
    linkedin_company:  process.env.PUBLER_ACCOUNT_LINKEDIN_COMPANY,
    linkedin_karim:    process.env.PUBLER_ACCOUNT_LINKEDIN_KARIM,
    linkedin_raphael:  process.env.PUBLER_ACCOUNT_LINKEDIN_RAPHAEL,
    instagram:         process.env.PUBLER_ACCOUNT_INSTAGRAM,
    tiktok:            process.env.PUBLER_ACCOUNT_TIKTOK,
    facebook:          process.env.PUBLER_ACCOUNT_FACEBOOK,
  };
  return map[platform] ?? null;
}

// ─── Types Publer API ─────────────────────────────────────────────────────────

interface PublerPostBody {
  account_ids:   string[];
  text:          string;
  scheduled_at?: string;   // ISO UTC
  media_urls?:   string[];
}

interface PublerPostResponse {
  id?:     string;
  uid?:    string;
  errors?: string[];
}

// ─── Publer : créer un post planifié ─────────────────────────────────────────

async function createPublerPost(params: {
  platform:     PubPlatform;
  texte:        string;
  hashtags:     string[];
  scheduledAt:  string;
  imageUrl?:    string;
}): Promise<string | null> {
  const accountId = getPublerAccountId(params.platform);
  if (!accountId) {
    await supabase.from('alerts').insert({
      agent_name: 'SANJI',
      level:      'WARNING',
      message:    `PUBLER_ACCOUNT_${params.platform.toUpperCase()} non configuré — post ignoré`,
    });
    return null;
  }

  const fullText = params.hashtags.length > 0
    ? `${params.texte}\n\n${params.hashtags.map(h => `#${h}`).join(' ')}`
    : params.texte;

  const body: PublerPostBody = {
    account_ids:  [accountId],
    text:         fullText,
    scheduled_at: params.scheduledAt,
  };

  if (params.imageUrl) body.media_urls = [params.imageUrl];

  const res = await fetch(`${PUBLER_BASE}/posts`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.PUBLER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Publer POST /posts ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = (await res.json()) as PublerPostResponse;

  if (data.errors && data.errors.length > 0) {
    throw new Error(`Publer erreur: ${data.errors.join(', ')}`);
  }

  return data.id ?? data.uid ?? null;
}

// ─── Types contenu ITACHI ─────────────────────────────────────────────────────

interface ContentRow {
  id:       string;
  titre:    string | null;
  contenu:  string | null;
  hashtags: string[] | null;
  type:     string | null;
}

// ─── Résultat de publication ──────────────────────────────────────────────────

export interface PublishPipelineResult {
  content_id:    string;
  platform:      PubPlatform;
  statut:        'scheduled' | 'echec';
  publer_post_id?: string;
  scheduled_at?: string;
  erreur?:       string;
}

// ─── Pipeline principal : un contenu → toutes les plateformes ────────────────

export async function publishContentViaPubler(
  contentId:  string,
  platforms?: PubPlatform[]
): Promise<PublishPipelineResult[]> {
  // 1. Charger le contenu depuis la table ITACHI
  const { data: row, error: fetchErr } = await supabase
    .from('content')
    .select('id, titre, contenu, hashtags, type')
    .eq('id', contentId)
    .single();

  if (fetchErr || !row) throw new Error(`Contenu introuvable : ${contentId}`);

  const content = row as unknown as ContentRow;
  const sujet   = content.titre ?? 'Contenu KR Global';
  const corps   = content.contenu ?? '';
  const tags    = Array.isArray(content.hashtags) ? content.hashtags : [];

  // 2. Adapter pour toutes les plateformes (ou celles demandées)
  const adapted = platforms
    ? await Promise.all(platforms.map(p => adaptForPlatform(sujet, corps, tags, p)))
    : await adaptForAllPlatforms(sujet, corps, tags);

  const results: PublishPipelineResult[] = [];

  for (const post of adapted) {
    try {
      // 3. Générer l'image (Instagram et Facebook ont l'image requise, LinkedIn optionnel)
      let imageUrl: string | undefined;
      const needsImage = post.platform === 'instagram' || post.platform === 'facebook';

      if (needsImage || post.platform === 'linkedin_company') {
        try {
          imageUrl = await generateAndUploadImage(post.imagePrompt, contentId);
        } catch (imgErr) {
          await supabase.from('alerts').insert({
            agent_name: 'SANJI',
            level:      'WARNING',
            message:    `Image génération échouée (${post.platform}): ${imgErr instanceof Error ? imgErr.message.slice(0, 150) : String(imgErr)}`,
          });
          if (needsImage) {
            results.push({
              content_id: contentId,
              platform:   post.platform,
              statut:     'echec',
              erreur:     'Image requise mais génération impossible',
            });
            continue;
          }
        }
      }

      // 4. Trouver le créneau et créer dans Publer
      const { getNextSlot } = await import('./scheduler');
      const scheduledAt     = await getNextSlot(post.platform);

      const publerPostId = await createPublerPost({
        platform:    post.platform,
        texte:       post.texte,
        hashtags:    post.hashtags,
        scheduledAt,
        imageUrl,
      });

      // 5. Enregistrer en base
      const scheduleId = await schedulePost({
        content_id:      contentId,
        platform:        post.platform,
        texte:           post.texte,
        hashtags:        post.hashtags,
        image_url:       imageUrl,
        publer_post_id:  publerPostId ?? undefined,
      });

      results.push({
        content_id:      contentId,
        platform:        post.platform,
        statut:          'scheduled',
        publer_post_id:  publerPostId ?? undefined,
        scheduled_at:    scheduledAt,
      });

      await supabase.from('alerts').insert({
        agent_name: 'SANJI',
        level:      'INFO',
        message:    `Post planifié via Publer — ${post.platform} le ${scheduledAt.slice(0, 16)} (schedule=${scheduleId})`,
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ content_id: contentId, platform: post.platform, statut: 'echec', erreur: msg });

      await supabase.from('alerts').insert({
        agent_name: 'SANJI',
        level:      'WARNING',
        message:    `Échec planification ${post.platform} (${contentId}): ${msg.slice(0, 200)}`,
      });
    }
  }

  // 6. Marquer le contenu ITACHI comme planifié si au moins un succès
  if (results.some(r => r.statut === 'scheduled')) {
    await supabase
      .from('content')
      .update({ statut: 'publie', published_at: new Date().toISOString() })
      .eq('id', contentId);
  }

  return results;
}

// ─── Batch : publie tous les contenus approuvés non encore planifiés ──────────

export async function publishApprovedContent(): Promise<{
  processed: number;
  scheduled: number;
  failed:    number;
}> {
  const { data: approved, error } = await supabase
    .from('content')
    .select('id')
    .eq('statut', 'approuve')
    .is('published_at', null)
    .limit(10);

  if (error) throw new Error(`publishApprovedContent query: ${error.message}`);

  const rows = (approved ?? []) as { id: string }[];
  let scheduled = 0;
  let failed    = 0;

  for (const { id } of rows) {
    try {
      const results = await publishContentViaPubler(id);
      if (results.some(r => r.statut === 'scheduled')) scheduled++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return { processed: rows.length, scheduled, failed };
}

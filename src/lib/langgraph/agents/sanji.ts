import { createClient }          from '@supabase/supabase-js';
import { publishContent }         from '@/lib/agents/sanji/social-publisher';
import { runMonitorCycle }        from '@/lib/agents/sanji/social-monitor';
import { adaptContent, adaptForAllPlatforms } from '@/lib/agents/sanji/content-adapter';
import {
  getScheduledPosts,
  getDuePostsForPlatform,
  markAsPublished,
  scheduleFromApprovedContent,
} from '@/lib/agents/sanji/calendar-manager';
import { sanjiChain }             from '@/lib/langchain/chains/sanji-chain';
import type { KRGlobalStateType } from '../state';
import type { Platform }          from '@/lib/agents/sanji/social-publisher';
import type { AdaptPlatform }     from '@/lib/agents/sanji/content-adapter';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function log(level: string, message: string): Promise<void> {
  await supabase.from('alerts').insert({ agent_name: 'SANJI', level, message });
}

async function notifySlack(text: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_CONTENU;
  if (!webhook) return;
  await fetch(webhook, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text, username: 'SANJI', icon_emoji: ':fork_and_knife:' }),
  }).catch(() => undefined);
}

export async function sanjiNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = state.task_input['action'] as string;

  try {
    // ── publish_post ───────────────────────────────────────────────────────────
    if (action === 'publish_post') {
      const contentId  = state.task_input['content_id'] as string | undefined;
      const texte      = state.task_input['texte']      as string | undefined;
      const hashtags   = state.task_input['hashtags']   as string[] | undefined;
      const plateformes = (state.task_input['plateformes'] as Platform[] | undefined) ?? ['linkedin'];
      const mediaUrl   = state.task_input['media_url']  as string | undefined;

      if (!contentId && !texte) throw new Error('content_id ou texte requis');

      const results = await publishContent({ contentId, texte, hashtags, plateformes, mediaUrl });

      const published = results.filter(r => r.statut === 'publie');
      if (published.length > 0) {
        await notifySlack(
          `:white_check_mark: *SANJI* — ${published.length} publication(s) réussie(s) : ` +
          published.map(r => r.plateforme).join(', '),
        );
      }

      await log('INFO', `publish_post : ${results.length} résultats — ${published.length} publiés`);

      return {
        agent_name:  'SANJI',
        status:      'completed',
        task_result: { results },
        error:       null,
      };
    }

    // ── adapt_content ──────────────────────────────────────────────────────────
    if (action === 'adapt_content') {
      const source   = state.task_input['source']   as string | undefined;
      const platform = state.task_input['platform'] as AdaptPlatform | undefined;

      if (!source) throw new Error('source requis pour adapt_content');

      const adapted = platform
        ? await adaptContent(source, platform)
        : await adaptForAllPlatforms(source);

      return {
        agent_name:  'SANJI',
        status:      'completed',
        task_result: { adapted },
        error:       null,
      };
    }

    // ── get_calendar ───────────────────────────────────────────────────────────
    if (action === 'get_calendar') {
      const platform = state.task_input['platform'] as string | undefined;
      const posts    = await getScheduledPosts(platform);

      return {
        agent_name:  'SANJI',
        status:      'completed',
        task_result: { posts, count: posts.length },
        error:       null,
      };
    }

    // ── schedule_content ───────────────────────────────────────────────────────
    if (action === 'schedule_content') {
      const result = await scheduleFromApprovedContent();
      await log('INFO', `schedule_content : ${result.scheduled} planifiés, ${result.skipped} ignorés`);

      return {
        agent_name:  'SANJI',
        status:      'completed',
        task_result: { ...result },
        error:       null,
      };
    }

    // ── publish_due ────────────────────────────────────────────────────────────
    // Publie les posts dont l'heure est venue pour une plateforme donnée
    if (action === 'publish_due') {
      const platform = (state.task_input['platform'] as string | undefined) ?? 'linkedin';
      const duePosts = await getDuePostsForPlatform(platform);

      const published: string[] = [];
      const failed:    string[] = [];

      for (const post of duePosts) {
        try {
          const results = await publishContent({
            texte:      post.content,
            hashtags:   post.hashtags,
            plateformes: [platform as Platform],
          });

          const ok = results.find(r => r.statut === 'publie');
          if (ok) {
            await markAsPublished(post.id, ok.platform_post_id);
            published.push(post.id);
          } else {
            failed.push(post.id);
          }
        } catch {
          failed.push(post.id);
        }
      }

      if (published.length > 0) {
        await notifySlack(`:mega: *SANJI* — ${published.length} post(s) publiés sur *${platform}*`);
      }

      await log('INFO', `publish_due ${platform} : ${published.length} publiés, ${failed.length} échecs`);

      return {
        agent_name:  'SANJI',
        status:      'completed',
        task_result: { platform, published: published.length, failed: failed.length },
        error:       null,
      };
    }

    // ── recycle_content ────────────────────────────────────────────────────────
    if (action === 'recycle_content') {
      // Trouve les meilleures publications (likes + partages élevés) et les replanifie
      const { data: top } = await supabase
        .from('social_publications')
        .select('id, plateforme, texte_adapte, hashtags, vues, likes, partages')
        .eq('statut', 'publie')
        .gte('likes', 5)
        .order('likes', { ascending: false })
        .limit(3);

      const recycled: string[] = [];

      for (const post of (top ?? []) as Record<string, unknown>[]) {
        const texte    = post['texte_adapte'] as string;
        const hashtags = Array.isArray(post['hashtags']) ? post['hashtags'] as string[] : [];
        const platform = post['plateforme'] as Platform;

        // Replanifier avec angle légèrement différent via LLM
        const refreshed = await sanjiChain.invoke({
          input: `Recycle ce contenu avec un angle légèrement différent pour ${platform} ` +
                 `(même message, nouvelle accroche) :\n\n${texte}`,
        }).catch(() => texte);

        const results = await publishContent({
          texte:      refreshed,
          hashtags,
          plateformes: [platform],
        });

        if (results.some(r => r.statut === 'publie')) recycled.push(post['id'] as string);
      }

      await log('INFO', `recycle_content : ${recycled.length} posts recyclés`);

      return {
        agent_name:  'SANJI',
        status:      'completed',
        task_result: { recycled: recycled.length },
        error:       null,
      };
    }

    // ── get_performance ────────────────────────────────────────────────────────
    if (action === 'get_performance') {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

      const { data, error: qErr } = await supabase
        .from('social_publications')
        .select('plateforme, statut, vues, likes, partages, commentaires, published_at')
        .gte('published_at', since);

      if (qErr) throw new Error(qErr.message);

      const stats: Record<string, { total: number; vues: number; likes: number; partages: number }> = {};

      for (const row of (data ?? []) as Record<string, unknown>[]) {
        const p = row['plateforme'] as string;
        if (!stats[p]) stats[p] = { total: 0, vues: 0, likes: 0, partages: 0 };
        stats[p].total++;
        stats[p].vues     += (row['vues']     as number) ?? 0;
        stats[p].likes    += (row['likes']    as number) ?? 0;
        stats[p].partages += (row['partages'] as number) ?? 0;
      }

      return {
        agent_name:  'SANJI',
        status:      'completed',
        task_result: { stats, period_days: 30 },
        error:       null,
      };
    }

    // ── monitor ────────────────────────────────────────────────────────────────
    if (action === 'monitor') {
      const result = await runMonitorCycle();
      return {
        agent_name:  'SANJI',
        status:      'completed',
        task_result: { monitor: result },
        error:       null,
      };
    }

    throw new Error(`Action inconnue : ${action}`);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log('WARNING', `Erreur SANJI action=${action} : ${message}`);

    return {
      agent_name: 'SANJI',
      status:     'failed',
      error:      message,
    };
  }
}

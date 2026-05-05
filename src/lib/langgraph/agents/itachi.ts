import { HumanMessage, AIMessage }           from '@langchain/core/messages';
import { type KRGlobalStateType }             from '../state';
import { getContentHistory, saveContentMemory } from '@/lib/langchain/memory';
import { generateContent, type ContentType } from '@/lib/agents/itachi/content-generator';
import { scheduleContent }                   from '@/lib/agents/itachi/content-scheduler';
import { trackMetrics }                      from '@/lib/agents/itachi/performance-tracker';
import { notifyDraft }                       from '@/lib/agents/itachi/slack-notifier';
import { generateWeeklyCalendar }            from '@/lib/agents/itachi/calendar-planner';
import { runSeasonalPlanner }                from '@/lib/agents/itachi/seasonal-planner';

type ItachiAction =
  | 'generate_content'
  | 'schedule_post'
  | 'track_performance'
  | 'generate_calendar'
  | 'seasonal_plan';

type Plateforme = 'linkedin' | 'instagram' | 'tiktok' | 'twitter' | 'blog' | 'podcast' | 'youtube';

const PLATEFORME_TYPE: Record<Plateforme, ContentType> = {
  linkedin:  'post_linkedin',
  instagram: 'post_instagram',
  tiktok:    'post_tiktok',
  twitter:   'post_tiktok',    // Twitter → même modèle court que TikTok
  blog:      'article_seo',
  podcast:   'script_podcast',
  youtube:   'script_youtube',
};

export async function itachiNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as ItachiAction) ?? 'generate_content';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`ITACHI action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case 'generate_content': {
        const plateforme  = ((input['plateforme'] as string) ?? 'linkedin') as Plateforme;
        const langue      = (input['langue']     as string) ?? 'fr';
        const ton         = (input['ton']        as string) ?? 'professionnel';
        const sujet       = (input['sujet']      as string) ?? '';
        const marque      = (input['marque']     as string) ?? 'KR Global Solutions Ltd';
        const entite_nom  = (input['entite_nom'] as string) ?? 'KR Global';
        const contentType = PLATEFORME_TYPE[plateforme] ?? 'post_linkedin';

        const contentHistory = await getContentHistory(sujet);

        const historyNote = contentHistory
          ? `\n\nContenus précédents sur ce sujet (éviter les répétitions) :\n${contentHistory}`
          : '';

        const generated = await generateContent({
          marque,
          type:      contentType,
          sujet:     `${sujet}${historyNote}`,
          ton,
          langue,
          entite_nom,
        });

        const contentId = await scheduleContent({
          request: {
            marque,
            type:      contentType,
            sujet,
            ton,
            langue,
            longueur:  contentType === 'article_seo' || contentType.startsWith('script') ? 'long' : 'court',
            entite_nom,
          },
          generated,
          statut: 'draft',
        });

        await notifyDraft({
          contentId,
          plateforme,
          langue,
          titre:    generated.titre,
          contenu:  generated.contenu,
          hashtags: generated.hashtags,
        });

        await saveContentMemory(contentId, plateforme, generated.titre, generated.contenu);

        result = {
          content_id:   contentId,
          titre:        generated.titre,
          contenu:      generated.contenu,
          hashtags:     generated.hashtags,
          plateforme,
          context_used: contentHistory.length > 0,
        };
        break;
      }

      case 'generate_calendar': {
        const marque     = (input['marque']     as string) ?? 'KR Global Solutions Ltd';
        const secteur    = (input['secteur']    as string) ?? 'agence IA et automatisation';
        const langue     = (input['langue']     as string) ?? 'fr';
        const entite_nom = (input['entite_nom'] as string) ?? 'KR Global';

        const calendar = await generateWeeklyCalendar(marque, secteur, langue, entite_nom);
        result = { ...calendar };
        break;
      }

      case 'seasonal_plan': {
        const marque = (input['marque'] as string) ?? 'KR Global Solutions Ltd';
        const langue = (input['langue'] as string) ?? 'fr';

        const plan = await runSeasonalPlanner(marque, langue);
        result = { ...plan };
        break;
      }

      case 'schedule_post': {
        const contentId = (input['content_id'] as string) ?? '';
        if (!contentId) throw new Error('content_id requis');

        result = { content_id: contentId, scheduled: true };
        break;
      }

      case 'track_performance': {
        const contentId = (input['content_id'] as string) ?? '';
        if (!contentId) throw new Error('content_id requis');

        await trackMetrics({
          contentId,
          vues:        (input['vues']        as number) ?? 0,
          clics:       (input['clics']       as number) ?? 0,
          conversions: (input['conversions'] as number) ?? 0,
        });

        result = { tracked: true, content_id: contentId };
        break;
      }

      default: {
        result = { message: `Action inconnue : ${action}` };
      }
    }

    return {
      agent_name:  'ITACHI',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, new AIMessage(`ITACHI completed action=${action}`)],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur ITACHI inconnue';
    return {
      agent_name: 'ITACHI',
      status:     'failed',
      error:      message,
      messages:   [userMsg, new AIMessage(`ITACHI error: ${message}`)],
    };
  }
}

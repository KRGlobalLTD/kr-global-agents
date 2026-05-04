import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { type KRGlobalStateType } from '../state';
import { generateContent, type ContentType, type Longueur } from '@/lib/agents/itachi/content-generator';
import { scheduleContent }  from '@/lib/agents/itachi/content-scheduler';
import { trackMetrics }     from '@/lib/agents/itachi/performance-tracker';
import { notifyDraft }      from '@/lib/agents/itachi/slack-notifier';

type ItachiAction = 'generate_content' | 'schedule_post' | 'track_performance';
type Plateforme   = 'linkedin' | 'twitter' | 'blog';

const PLATEFORME_TYPE: Record<Plateforme, ContentType> = {
  linkedin: 'post',
  twitter:  'post',
  blog:     'article',
};

const PLATEFORME_LONGUEUR: Record<Plateforme, Longueur> = {
  linkedin: 'moyen',
  twitter:  'court',
  blog:     'long',
};

export async function itachiNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as ItachiAction) ?? 'generate_content';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`ITACHI action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case 'generate_content': {
        const plateforme = ((input['plateforme'] as string) ?? 'linkedin') as Plateforme;
        const langue     = (input['langue']     as string) ?? 'fr';
        const ton        = (input['ton']        as string) ?? 'professionnel';
        const sujet      = (input['sujet']      as string) ?? '';

        const platformeCtx: Record<Plateforme, string> = {
          linkedin: '[LINKEDIN — 1500 chars max, storytelling pro, 3-5 hashtags]',
          twitter:  '[TWITTER/X — 280 chars max, accrocheur, 1-2 hashtags]',
          blog:     '[BLOG — 800-1200 mots, SEO-friendly, H1 + H2]',
        };

        const generated = await generateContent({
          marque:     'KR Global Solutions Ltd',
          type:       PLATEFORME_TYPE[plateforme],
          sujet:      `${platformeCtx[plateforme]} ${sujet}`,
          ton,
          langue,
          longueur:   PLATEFORME_LONGUEUR[plateforme],
          entite_nom: 'KR Global',
        });

        const contentId = await scheduleContent({
          request: {
            marque:     'KR Global Solutions Ltd',
            type:       PLATEFORME_TYPE[plateforme],
            sujet,
            ton,
            langue,
            longueur:   PLATEFORME_LONGUEUR[plateforme],
            entite_nom: 'KR Global',
          },
          generated,
          statut: 'draft',
        });

        await notifyDraft({
          contentId,
          plateforme,
          langue,
          titre:   generated.titre,
          contenu: generated.contenu,
          hashtags: generated.hashtags,
        });

        result = {
          content_id: contentId,
          titre:      generated.titre,
          contenu:    generated.contenu,
          hashtags:   generated.hashtags,
          plateforme,
        };
        break;
      }

      case 'schedule_post': {
        const contentId  = (input['content_id']  as string) ?? '';
        const datePrevue = input['date_prevue'] ? new Date(input['date_prevue'] as string) : undefined;
        if (!contentId) throw new Error('content_id requis');

        await scheduleContent({
          request: {
            marque:     'KR Global Solutions Ltd',
            type:       'post',
            sujet:      '',
            ton:        'professionnel',
            langue:     'fr',
            longueur:   'moyen',
            entite_nom: 'KR Global',
          },
          generated: { titre: '', contenu: '', hashtags: [], meta_description: '', modele: '' },
          statut:    'approuve',
        });

        result = { content_id: contentId, date_prevue: datePrevue?.toISOString() };
        break;
      }

      case 'track_performance': {
        const contentId  = (input['content_id'] as string) ?? '';
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

    const aiMsg = new AIMessage(`ITACHI completed action=${action}`);

    return {
      agent_name:  'ITACHI',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, aiMsg],
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

import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { createClient }            from '@supabase/supabase-js';
import { type KRGlobalStateType }  from '../state';
import { sakuraChain, sakuraChainJson } from '@/lib/langchain/chains/sakura-chain';
import { buildRGPDPrompt, buildAIActPrompt } from '@/lib/agents/sakura/rgpd-advisor';
import {
  buildFranceOutreachPrompt,
  saveFranceProspect,
  getFranceProspects,
  FRANCE_SECTORS,
  type FranceProspect,
  type FranceEmailType,
} from '@/lib/agents/sakura/outreach-writer';
import {
  buildFranceMarketPrompt,
  getFranceSectorData,
  saveFranceInsight,
} from '@/lib/agents/sakura/market-researcher';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type SakuraAction =
  | 'check_rgpd'
  | 'ai_act_check'
  | 'write_outreach'
  | 'research_market'
  | 'generate_pitch'
  | 'analyze_sector'
  | 'write_proposal'
  | 'get_prospects';

export async function sakuraNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as SakuraAction) ?? 'research_market';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`SAKURA action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'check_rgpd': {
        const useCase = (input['use_case'] as string | undefined) ?? '';
        if (!useCase) throw new Error('use_case requis pour check_rgpd');

        const llmPrompt = buildRGPDPrompt(useCase);
        const analysis  = await sakuraChain.invoke({ context: '', input: llmPrompt });

        await supabase.from('alerts').insert({
          agent_name: 'SAKURA',
          level:      'INFO',
          message:    `RGPD check : "${useCase.slice(0, 80)}"`,
        });

        result = { rgpd_analysis: analysis, use_case: useCase, authority: 'CNIL', law: 'RGPD + Loi Informatique et Libertés' };
        break;
      }

      case 'ai_act_check': {
        const systemDescription = (input['system_description'] as string | undefined) ?? '';
        if (!systemDescription) throw new Error('system_description requis pour ai_act_check');

        const llmPrompt = buildAIActPrompt(systemDescription);
        const raw       = await sakuraChainJson.invoke({ context: '', input: llmPrompt });

        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { parsed = { analysis: raw }; }

        await supabase.from('alerts').insert({
          agent_name: 'SAKURA',
          level:      'INFO',
          message:    `AI Act check : "${systemDescription.slice(0, 80)}"`,
        });

        result = { ai_act: parsed, regulation: 'EU AI Act 2024/1689' };
        break;
      }

      case 'write_outreach': {
        const entreprise = (input['entreprise'] as string | undefined) ?? '';
        if (!entreprise) throw new Error('entreprise requis pour write_outreach');

        const prospect: FranceProspect = {
          civilite:   ((input['civilite'] as string) ?? 'Monsieur') as FranceProspect['civilite'],
          prenom:     (input['prenom']    as string) ?? '',
          nom:        (input['nom']       as string) ?? '',
          poste:      (input['poste']     as string) ?? 'Directeur',
          entreprise,
          secteur:    (input['secteur']   as string) ?? 'tech_esn',
          taille:     ((input['taille']   as string) ?? 'pme') as FranceProspect['taille'],
          ville:      (input['ville']     as string) ?? 'Paris',
          pain_point: input['pain_point'] as string | undefined,
          email:      input['email']      as string | undefined,
          linkedin:   input['linkedin']   as string | undefined,
        };

        const emailType = ((input['type'] as string) ?? 'cold_email') as FranceEmailType;
        const llmPrompt = buildFranceOutreachPrompt(prospect, emailType);
        const raw       = await sakuraChainJson.invoke({ context: '', input: llmPrompt });

        let parsed: { subject?: string; body?: string } = {};
        try { parsed = JSON.parse(raw) as typeof parsed; }
        catch { parsed = { subject: 'KR Global — automatisation IA', body: raw }; }

        let prospect_id = '';
        if (emailType === 'cold_email' && prospect.email) {
          prospect_id = await saveFranceProspect(prospect);
        }

        result = {
          message: {
            subject:     parsed.subject ?? null,
            body:        parsed.body    ?? '',
            type:        emailType,
            prospect_id,
          },
        };
        break;
      }

      case 'research_market': {
        const sector   = input['sector']   as string | undefined;
        const question = input['question'] as string | undefined;

        const sectorData = getFranceSectorData(sector);
        const llmInput   = buildFranceMarketPrompt(sector, question);
        const analysis   = await sakuraChain.invoke({ context: '', input: llmInput });

        await saveFranceInsight(sector ?? 'general', analysis);

        result = { sector_data: sectorData, analysis, market: 'France' };
        break;
      }

      case 'generate_pitch': {
        const entreprise = (input['entreprise'] as string | undefined) ?? '';
        const secteur    = (input['secteur']    as string | undefined) ?? 'tech_esn';
        const taille     = ((input['taille']    as string) ?? 'pme') as FranceProspect['taille'];
        const pain_point = (input['pain_point'] as string | undefined) ?? '';
        if (!entreprise) throw new Error('entreprise requis pour generate_pitch');

        const sectorData = FRANCE_SECTORS[secteur];
        const pitch = await sakuraChain.invoke({
          context: sectorData ? JSON.stringify(sectorData) : '',
          input: `Génère un pitch commercial complet pour KR Global Solutions ciblant :
Entreprise : ${entreprise} | Secteur : ${secteur} | Taille : ${taille}
Pain point : ${pain_point || 'non précisé'}

Structure le pitch selon les attentes B2B françaises :
1. Accroche contextualisée (référence secteur/actualité FR)
2. Diagnostic du problème avec chiffres du marché
3. Solution KR Global avec cas d'usage concrets
4. ROI estimé et timeline de déploiement
5. Traitement conformité RGPD/AI Act
6. Étape suivante proposée (pilote 4 semaines, démo, etc.)`,
        });

        result = { pitch, entreprise, secteur, taille };
        break;
      }

      case 'analyze_sector': {
        const secteur = (input['secteur'] as string | undefined) ?? '';
        if (!secteur) throw new Error('secteur requis pour analyze_sector');

        const sectorData = FRANCE_SECTORS[secteur] ?? Object.values(FRANCE_SECTORS)[0];
        const analysis   = await sakuraChainJson.invoke({
          context: JSON.stringify(sectorData),
          input: `Analyse stratégique du secteur "${secteur}" en France pour KR Global. JSON :
{
  "opportunity_score": 0,
  "sales_cycle_months": 0,
  "decision_makers": [],
  "top_use_cases": [],
  "entry_strategy": "",
  "rgpd_complexity": "low|medium|high",
  "recommended_approach": "",
  "key_objections": [],
  "target_companies": []
}`,
        });

        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(analysis) as Record<string, unknown>; }
        catch { parsed = { analysis }; }

        result = { secteur, sector_data: sectorData, analysis: parsed };
        break;
      }

      case 'write_proposal': {
        const entreprise = (input['entreprise'] as string | undefined) ?? '';
        const besoins    = (input['besoins']    as string | undefined) ?? '';
        const budget     = (input['budget']     as string | undefined) ?? 'non précisé';
        if (!entreprise || !besoins) throw new Error('entreprise et besoins requis pour write_proposal');

        const proposal = await sakuraChain.invoke({
          context: '',
          input: `Rédige une introduction de proposition commerciale (offre de services) pour KR Global Solutions Ltd à destination de ${entreprise}.

Besoins exprimés : ${besoins}
Budget indicatif : ${budget}

Structure française d'une offre commerciale :
1. Contexte et compréhension du besoin (montre qu'on a écouté)
2. Approche proposée et méthodologie
3. Livrables et jalons
4. Équipe dédiée et profils
5. Planning prévisionnel (4-12 semaines selon scope)
6. Investissement et modalités
7. Prochaines étapes

Ton : professionnel, factuel, sans superlatifs. Utilise "nous" pour KR Global.`,
        });

        result = { proposal, entreprise, besoins };
        break;
      }

      case 'get_prospects': {
        const limit     = (input['limit'] as number | undefined) ?? 20;
        const prospects = await getFranceProspects(limit);
        result = { prospects, count: prospects.length };
        break;
      }

      default: {
        const reasoning = await sakuraChain.invoke({ context: '', input: `Tâche SAKURA : ${JSON.stringify(input)}` });
        result = { reasoning };
      }
    }

    return {
      agent_name:  'SAKURA',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, new AIMessage(`SAKURA completed action=${action}`)],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur SAKURA inconnue';
    await supabase.from('alerts').insert({ agent_name: 'SAKURA', level: 'WARNING', message: message.slice(0, 200) });
    return {
      agent_name: 'SAKURA',
      status:     'failed',
      error:      message,
      messages:   [userMsg, new AIMessage(`SAKURA error: ${message}`)],
    };
  }
}

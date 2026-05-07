import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { createClient }            from '@supabase/supabase-js';
import { type KRGlobalStateType }  from '../state';
import { gaaraChain, gaaraChainJson } from '@/lib/langchain/chains/gaara-chain';
import {
  saveLocalization,
  buildLocalizationPrompt,
  type LocalizationRequest,
} from '@/lib/agents/gaara/content-localizer';
import {
  buildOutreachPrompt,
  saveMarocProspect,
  getMarocProspects,
  type MarocProspect,
} from '@/lib/agents/gaara/outreach-writer';
import {
  buildMarketResearchPrompt,
  getCNDPKnowledge,
  getMarketKnowledge,
  saveMarketInsight,
} from '@/lib/agents/gaara/market-researcher';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type GaaraAction =
  | 'localize_content'
  | 'write_outreach'
  | 'research_market'
  | 'check_compliance'
  | 'generate_pitch'
  | 'translate'
  | 'get_prospects'
  | 'analyze_sector';

export async function gaaraNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as GaaraAction) ?? 'research_market';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`GAARA action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'localize_content': {
        const original = (input['content'] as string | undefined) ?? '';
        if (!original) throw new Error('content requis pour localize_content');

        const req: LocalizationRequest = {
          original_content: original,
          target_language:  ((input['language'] as string) ?? 'fr-MA') as LocalizationRequest['target_language'],
          format:           ((input['format']   as string) ?? 'email')  as LocalizationRequest['format'],
          sector:           input['sector']  as string | undefined,
          brand:            input['brand']   as string | undefined,
          tone:             (input['tone']   as 'formal' | 'conversational' | 'sales') ?? 'formal',
        };

        const llmPrompt = buildLocalizationPrompt(req);
        const raw       = await gaaraChainJson.invoke({ context: '', input: llmPrompt });

        let parsed: { localized?: string; cultural_notes?: string[] } = {};
        try { parsed = JSON.parse(raw) as typeof parsed; } catch { parsed = { localized: raw, cultural_notes: [] }; }

        const locResult = await saveLocalization(
          req,
          parsed.localized ?? raw,
          parsed.cultural_notes ?? [],
        );

        result = { localization: locResult };
        break;
      }

      case 'write_outreach': {
        const prospect: MarocProspect = {
          name:       (input['name']       as string) ?? 'Directeur',
          company:    (input['company']    as string) ?? '',
          role:       (input['role']       as string) ?? 'Directeur Général',
          sector:     (input['sector']     as string) ?? 'tech',
          city:       (input['city']       as string) ?? 'Casablanca',
          pain_point: input['pain_point']  as string | undefined,
          email:      input['email']       as string | undefined,
        };
        if (!prospect.company) throw new Error('company requis pour write_outreach');

        const language   = ((input['language']   as string) ?? 'fr-MA') as LocalizationRequest['target_language'];
        const emailType  = ((input['email_type'] as string) ?? 'initial') as 'initial' | 'followup1' | 'followup2';

        const llmPrompt = buildOutreachPrompt(prospect, language, emailType);
        const raw       = await gaaraChainJson.invoke({ context: '', input: llmPrompt });

        let parsed: { subject?: string; body?: string } = {};
        try { parsed = JSON.parse(raw) as typeof parsed; } catch { parsed = { subject: 'KR Global — IA pour votre entreprise', body: raw }; }

        // Sauvegarder prospect si email fourni et c'est un initial
        let prospect_id = '';
        if (emailType === 'initial' && prospect.email) {
          prospect_id = await saveMarocProspect(prospect);
        }

        result = {
          email: {
            subject:  parsed.subject ?? '',
            body:     parsed.body    ?? '',
            language,
            prospect,
            prospect_id,
          },
        };
        break;
      }

      case 'research_market': {
        const sector   = input['sector']   as string | undefined;
        const question = input['question'] as string | undefined;

        const insights = getMarketKnowledge(sector);
        const llmInput = buildMarketResearchPrompt(sector, question);
        const analysis = await gaaraChain.invoke({ context: '', input: llmInput });

        await saveMarketInsight(sector ?? 'general', analysis, 'GAARA internal knowledge');

        result = { insights, analysis, sector: sector ?? 'all' };
        break;
      }

      case 'check_compliance': {
        const useCase = (input['use_case'] as string | undefined) ?? '';
        const cndpKnowledge = getCNDPKnowledge();

        const analysis = await gaaraChain.invoke({
          context: cndpKnowledge,
          input: `Évalue la conformité CNDP (loi 09-08) pour ce cas d'usage au Maroc et fournis des recommandations concrètes :
${useCase || 'Usage général d\'agents IA traitant des données de prospects et clients marocains'}

Structure ta réponse : 1) Obligations légales applicables, 2) Risques identifiés, 3) Actions recommandées, 4) Délais.`,
        });

        result = { compliance_analysis: analysis, use_case: useCase, law: 'Loi 09-08 / CNDP Maroc' };
        break;
      }

      case 'generate_pitch': {
        const company    = (input['company']    as string | undefined) ?? '';
        const sector     = (input['sector']     as string | undefined) ?? 'tech';
        const language   = ((input['language']  as string) ?? 'fr-MA') as LocalizationRequest['target_language'];
        const pain_point = (input['pain_point'] as string | undefined) ?? '';
        if (!company) throw new Error('company requis pour generate_pitch');

        const insights   = getMarketKnowledge(sector);
        const sectorData = insights[0];

        const pitch = await gaaraChain.invoke({
          context: sectorData ? JSON.stringify(sectorData) : '',
          input: `Génère un pitch commercial complet (${language}) pour KR Global ciblant :
Entreprise : ${company} | Secteur : ${sector} | Pain point : ${pain_point || 'non précisé'}

Le pitch doit inclure :
1. Accroche personnalisée (référence secteur marocain)
2. Problème identifié et coût pour l'entreprise
3. Solution KR Global (agents IA adaptés)
4. Preuve sociale (résultat client similaire)
5. Proposition de valeur chiffrée
6. CTA clair pour prochain step

Adapte le vocabulaire et les références culturelles au marché marocain.`,
        });

        result = { pitch, language, company, sector };
        break;
      }

      case 'translate': {
        const text   = (input['text']     as string | undefined) ?? '';
        const fromLg = (input['from']     as string | undefined) ?? 'fr';
        const toLg   = (input['to']       as string | undefined) ?? 'ar';
        if (!text) throw new Error('text requis pour translate');

        const translated = await gaaraChain.invoke({
          context: '',
          input: `Traduis ce texte de ${fromLg} vers ${toLg}. Préserve le sens, le ton et les nuances culturelles marocaines. Retourne uniquement la traduction, sans commentaire.

Texte original :
${text}`,
        });

        result = { original: text, translated, from: fromLg, to: toLg };
        break;
      }

      case 'get_prospects': {
        const limit     = (input['limit'] as number | undefined) ?? 20;
        const prospects = await getMarocProspects(limit);
        result = { prospects, count: prospects.length };
        break;
      }

      case 'analyze_sector': {
        const sector   = (input['sector'] as string | undefined) ?? '';
        if (!sector) throw new Error('sector requis');

        const insights = getMarketKnowledge(sector);
        const analysis = await gaaraChainJson.invoke({
          context: JSON.stringify(insights),
          input: `Analyse le secteur "${sector}" au Maroc pour KR Global. JSON : {
  "opportunity_score": 0-10,
  "target_companies": ["..."],
  "best_ai_solutions": ["..."],
  "outreach_strategy": "...",
  "key_objections": ["..."],
  "entry_point": "..."
}`,
        });

        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(analysis) as Record<string, unknown>; } catch { parsed = { analysis }; }

        result = { sector, insights, analysis: parsed };
        break;
      }

      default: {
        const reasoning = await gaaraChain.invoke({ context: '', input: `Tâche GAARA : ${JSON.stringify(input)}` });
        result = { reasoning };
      }
    }

    return {
      agent_name:  'GAARA',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, new AIMessage(`GAARA completed action=${action}`)],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur GAARA inconnue';
    await supabase.from('alerts').insert({ agent_name: 'GAARA', level: 'WARNING', message: message.slice(0, 200) });
    return {
      agent_name: 'GAARA',
      status:     'failed',
      error:      message,
      messages:   [userMsg, new AIMessage(`GAARA error: ${message}`)],
    };
  }
}

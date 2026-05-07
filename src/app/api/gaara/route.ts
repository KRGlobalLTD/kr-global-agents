import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
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

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const action = (body['action'] as string) ?? '';

  try {
    switch (action) {

      case 'localize_content': {
        const content = body['content'] as string | undefined;
        if (!content) return NextResponse.json({ error: 'content requis' }, { status: 400 });

        const req: LocalizationRequest = {
          original_content: content,
          target_language:  ((body['language'] as string) ?? 'fr-MA') as LocalizationRequest['target_language'],
          format:           ((body['format']   as string) ?? 'email')  as LocalizationRequest['format'],
          sector:           body['sector'] as string | undefined,
          brand:            body['brand']  as string | undefined,
          tone:             (body['tone'] as 'formal' | 'conversational' | 'sales') ?? 'formal',
        };

        const llmPrompt = buildLocalizationPrompt(req);
        const raw       = await gaaraChainJson.invoke({ context: '', input: llmPrompt });

        let parsed: { localized?: string; cultural_notes?: string[] } = {};
        try { parsed = JSON.parse(raw) as typeof parsed; } catch { parsed = { localized: raw, cultural_notes: [] }; }

        const locResult = await saveLocalization(req, parsed.localized ?? raw, parsed.cultural_notes ?? []);
        return NextResponse.json({ agent_name: 'GAARA', localization: locResult });
      }

      case 'write_outreach': {
        const company = body['company'] as string | undefined;
        if (!company) return NextResponse.json({ error: 'company requis' }, { status: 400 });

        const prospect: MarocProspect = {
          name:       (body['name']       as string) ?? 'Directeur',
          company,
          role:       (body['role']       as string) ?? 'Directeur Général',
          sector:     (body['sector']     as string) ?? 'tech',
          city:       (body['city']       as string) ?? 'Casablanca',
          pain_point: body['pain_point']  as string | undefined,
          email:      body['email']       as string | undefined,
        };

        const language  = ((body['language']   as string) ?? 'fr-MA') as LocalizationRequest['target_language'];
        const emailType = ((body['email_type'] as string) ?? 'initial') as 'initial' | 'followup1' | 'followup2';

        const llmPrompt = buildOutreachPrompt(prospect, language, emailType);
        const raw       = await gaaraChainJson.invoke({ context: '', input: llmPrompt });

        let parsed: { subject?: string; body?: string } = {};
        try { parsed = JSON.parse(raw) as typeof parsed; } catch { parsed = { subject: 'KR Global — IA pour votre entreprise', body: raw }; }

        let prospect_id = '';
        if (emailType === 'initial' && prospect.email) {
          prospect_id = await saveMarocProspect(prospect);
        }

        return NextResponse.json({
          agent_name: 'GAARA',
          email: { subject: parsed.subject, body: parsed.body, language, prospect_id },
        });
      }

      case 'research_market': {
        const sector   = body['sector']   as string | undefined;
        const question = body['question'] as string | undefined;
        const insights = getMarketKnowledge(sector);
        const llmInput = buildMarketResearchPrompt(sector, question);
        const analysis = await gaaraChain.invoke({ context: '', input: llmInput });
        await saveMarketInsight(sector ?? 'general', analysis, 'GAARA internal knowledge');
        return NextResponse.json({ agent_name: 'GAARA', insights, analysis, sector: sector ?? 'all' });
      }

      case 'check_compliance': {
        const useCase       = (body['use_case'] as string | undefined) ?? '';
        const cndpKnowledge = getCNDPKnowledge();
        const analysis      = await gaaraChain.invoke({
          context: cndpKnowledge,
          input: `Évalue la conformité CNDP (loi 09-08) pour ce cas d'usage au Maroc :
${useCase || 'Traitement de données clients marocains via agents IA'}
Structure : 1) Obligations, 2) Risques, 3) Actions, 4) Délais.`,
        });
        return NextResponse.json({ agent_name: 'GAARA', compliance_analysis: analysis, law: 'Loi 09-08 / CNDP' });
      }

      case 'generate_pitch': {
        const company    = body['company']    as string | undefined;
        const sector     = (body['sector']    as string) ?? 'tech';
        const language   = ((body['language'] as string) ?? 'fr-MA') as LocalizationRequest['target_language'];
        const pain_point = (body['pain_point'] as string) ?? '';
        if (!company) return NextResponse.json({ error: 'company requis' }, { status: 400 });

        const sectorData = getMarketKnowledge(sector)[0];
        const pitch = await gaaraChain.invoke({
          context: sectorData ? JSON.stringify(sectorData) : '',
          input: `Génère un pitch commercial (${language}) pour KR Global ciblant ${company} (${sector}, Maroc).
Pain point : ${pain_point || 'à identifier'}. Include accroche, problème, solution, preuve, CTA.`,
        });
        return NextResponse.json({ agent_name: 'GAARA', pitch, language, company, sector });
      }

      case 'translate': {
        const text   = body['text'] as string | undefined;
        const fromLg = (body['from'] as string) ?? 'fr';
        const toLg   = (body['to']   as string) ?? 'ar';
        if (!text) return NextResponse.json({ error: 'text requis' }, { status: 400 });

        const translated = await gaaraChain.invoke({
          context: '',
          input: `Traduis de ${fromLg} vers ${toLg} (registre professionnel marocain). Retourne uniquement la traduction :\n\n${text}`,
        });
        return NextResponse.json({ agent_name: 'GAARA', original: text, translated, from: fromLg, to: toLg });
      }

      case 'analyze_sector': {
        const sector = body['sector'] as string | undefined;
        if (!sector) return NextResponse.json({ error: 'sector requis' }, { status: 400 });

        const insights = getMarketKnowledge(sector);
        const analysis = await gaaraChainJson.invoke({
          context: JSON.stringify(insights),
          input: `Analyse secteur "${sector}" Maroc pour KR Global. JSON : {"opportunity_score":0,"target_companies":[],"best_ai_solutions":[],"outreach_strategy":"","key_objections":[],"entry_point":""}`,
        });

        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(analysis) as Record<string, unknown>; } catch { parsed = { analysis }; }
        return NextResponse.json({ agent_name: 'GAARA', sector, insights, analysis: parsed });
      }

      case 'get_prospects': {
        const limit     = (body['limit'] as number | undefined) ?? 20;
        const prospects = await getMarocProspects(limit);
        return NextResponse.json({ agent_name: 'GAARA', prospects, count: prospects.length });
      }

      default:
        return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur GAARA inconnue';
    void supabase.from('alerts').insert({
      agent_name: 'GAARA',
      level:      'WARNING',
      message:    `API error action=${action} : ${message.slice(0, 200)}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const type   = searchParams.get('type')   ?? 'market';
  const sector = searchParams.get('sector') ?? undefined;

  try {
    if (type === 'prospects') {
      const limit     = parseInt(searchParams.get('limit') ?? '20', 10);
      const prospects = await getMarocProspects(limit);
      return NextResponse.json({ agent_name: 'GAARA', prospects, count: prospects.length });
    }

    if (type === 'compliance') {
      return NextResponse.json({ agent_name: 'GAARA', cndp_knowledge: getCNDPKnowledge() });
    }

    const insights = getMarketKnowledge(sector);
    return NextResponse.json({ agent_name: 'GAARA', insights, count: insights.length });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur lecture';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

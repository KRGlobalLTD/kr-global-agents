import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
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

      case 'check_rgpd': {
        const useCase = body['use_case'] as string | undefined;
        if (!useCase) return NextResponse.json({ error: 'use_case requis' }, { status: 400 });
        const analysis = await sakuraChain.invoke({ context: '', input: buildRGPDPrompt(useCase) });
        return NextResponse.json({ agent_name: 'SAKURA', rgpd_analysis: analysis, law: 'RGPD + LIL / CNIL' });
      }

      case 'ai_act_check': {
        const desc = body['system_description'] as string | undefined;
        if (!desc) return NextResponse.json({ error: 'system_description requis' }, { status: 400 });
        const raw  = await sakuraChainJson.invoke({ context: '', input: buildAIActPrompt(desc) });
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { parsed = { analysis: raw }; }
        return NextResponse.json({ agent_name: 'SAKURA', ai_act: parsed, regulation: 'EU AI Act 2024/1689' });
      }

      case 'write_outreach': {
        const entreprise = body['entreprise'] as string | undefined;
        if (!entreprise) return NextResponse.json({ error: 'entreprise requis' }, { status: 400 });

        const prospect: FranceProspect = {
          civilite:   ((body['civilite'] as string) ?? 'Monsieur') as FranceProspect['civilite'],
          prenom:     (body['prenom']    as string) ?? '',
          nom:        (body['nom']       as string) ?? '',
          poste:      (body['poste']     as string) ?? 'Directeur',
          entreprise,
          secteur:    (body['secteur']   as string) ?? 'tech_esn',
          taille:     ((body['taille']   as string) ?? 'pme') as FranceProspect['taille'],
          ville:      (body['ville']     as string) ?? 'Paris',
          pain_point: body['pain_point'] as string | undefined,
          email:      body['email']      as string | undefined,
          linkedin:   body['linkedin']   as string | undefined,
        };

        const emailType = ((body['type'] as string) ?? 'cold_email') as FranceEmailType;
        const raw       = await sakuraChainJson.invoke({ context: '', input: buildFranceOutreachPrompt(prospect, emailType) });

        let parsed: { subject?: string; body?: string } = {};
        try { parsed = JSON.parse(raw) as typeof parsed; }
        catch { parsed = { subject: 'KR Global', body: raw }; }

        let prospect_id = '';
        if (emailType === 'cold_email' && prospect.email) {
          prospect_id = await saveFranceProspect(prospect);
        }

        return NextResponse.json({ agent_name: 'SAKURA', message: { ...parsed, type: emailType, prospect_id } });
      }

      case 'research_market': {
        const sector   = body['sector']   as string | undefined;
        const question = body['question'] as string | undefined;
        const data     = getFranceSectorData(sector);
        const analysis = await sakuraChain.invoke({ context: '', input: buildFranceMarketPrompt(sector, question) });
        await saveFranceInsight(sector ?? 'general', analysis);
        return NextResponse.json({ agent_name: 'SAKURA', sector_data: data, analysis });
      }

      case 'generate_pitch': {
        const entreprise = body['entreprise'] as string | undefined;
        const secteur    = (body['secteur']   as string) ?? 'tech_esn';
        const pain_point = (body['pain_point'] as string) ?? '';
        const taille     = (body['taille']    as string) ?? 'pme';
        if (!entreprise) return NextResponse.json({ error: 'entreprise requis' }, { status: 400 });

        const sectorData = FRANCE_SECTORS[secteur];
        const pitch = await sakuraChain.invoke({
          context: sectorData ? JSON.stringify(sectorData) : '',
          input: `Pitch commercial (B2B français formel) pour KR Global → ${entreprise} (${secteur}, ${taille}). Pain point : ${pain_point || 'non précisé'}. Inclus : accroche, diagnostic, solution, ROI, RGPD, next step.`,
        });
        return NextResponse.json({ agent_name: 'SAKURA', pitch, entreprise, secteur });
      }

      case 'analyze_sector': {
        const secteur = body['secteur'] as string | undefined;
        if (!secteur) return NextResponse.json({ error: 'secteur requis' }, { status: 400 });

        const sectorData = FRANCE_SECTORS[secteur] ?? Object.values(FRANCE_SECTORS)[0];
        const raw = await sakuraChainJson.invoke({
          context: JSON.stringify(sectorData),
          input: `Analyse secteur "${secteur}" France pour KR Global. JSON: {"opportunity_score":0,"sales_cycle_months":0,"decision_makers":[],"top_use_cases":[],"entry_strategy":"","rgpd_complexity":"low|medium|high","key_objections":[],"target_companies":[]}`,
        });
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { parsed = { raw }; }
        return NextResponse.json({ agent_name: 'SAKURA', secteur, analysis: parsed });
      }

      case 'write_proposal': {
        const entreprise = body['entreprise'] as string | undefined;
        const besoins    = body['besoins']    as string | undefined;
        if (!entreprise || !besoins) return NextResponse.json({ error: 'entreprise et besoins requis' }, { status: 400 });

        const budget   = (body['budget'] as string) ?? 'non précisé';
        const proposal = await sakuraChain.invoke({
          context: '',
          input: `Offre commerciale française pour KR Global → ${entreprise}. Besoins : ${besoins}. Budget : ${budget}. Structure : contexte, approche, livrables, planning, investissement, prochaines étapes. Ton factuel et professionnel.`,
        });
        return NextResponse.json({ agent_name: 'SAKURA', proposal, entreprise });
      }

      case 'get_prospects': {
        const limit     = (body['limit'] as number | undefined) ?? 20;
        const prospects = await getFranceProspects(limit);
        return NextResponse.json({ agent_name: 'SAKURA', prospects, count: prospects.length });
      }

      default:
        return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur SAKURA inconnue';
    void supabase.from('alerts').insert({
      agent_name: 'SAKURA',
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
      const prospects = await getFranceProspects(limit);
      return NextResponse.json({ agent_name: 'SAKURA', prospects, count: prospects.length });
    }

    if (type === 'sectors') {
      const data = getFranceSectorData(sector);
      return NextResponse.json({ agent_name: 'SAKURA', sectors: data });
    }

    // Default: market overview
    const data = getFranceSectorData(sector);
    return NextResponse.json({ agent_name: 'SAKURA', sector_data: data, sectors_count: Object.keys(FRANCE_SECTORS).length });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur lecture';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { publishContent, type Platform } from '@/lib/agents/sanji/social-publisher';
import { runMonitorCycle } from '@/lib/agents/sanji/social-monitor';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyInternalToken(request: NextRequest): boolean {
  return request.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

// ---- Payload types ----

type ActionPayload =
  | {
      action:       'publish';
      contentId?:   string;
      texte?:       string;
      hashtags?:    string[];
      plateformes:  Platform[];
      mediaUrl?:    string;
    }
  | { action: 'monitor' };

// ---- POST ----

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: ActionPayload;
  try {
    body = (await request.json()) as ActionPayload;
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'publish': {
        if (!body.contentId && !body.texte) {
          return NextResponse.json(
            { error: 'contentId ou texte requis' },
            { status: 400 }
          );
        }
        if (!body.plateformes || body.plateformes.length === 0) {
          return NextResponse.json(
            { error: 'plateformes requis (linkedin, instagram, tiktok)' },
            { status: 400 }
          );
        }

        const results = await publishContent({
          contentId:  body.contentId,
          texte:      body.texte,
          hashtags:   body.hashtags,
          plateformes: body.plateformes,
          mediaUrl:   body.mediaUrl,
        });

        return NextResponse.json({ success: true, results });
      }

      case 'monitor': {
        const result = await runMonitorCycle();
        return NextResponse.json({ success: true, result });
      }

      default: {
        return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';

    try {
      await supabase.from('alerts').insert({
        agent_name: 'SANJI',
        level:      'URGENT',
        message:    `Erreur API SANJI : action=${body.action}`,
      });
    } catch {
      // log silencieux
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---- GET — stats publications récentes ----

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const plateforme = searchParams.get('plateforme');
  const since      = searchParams.get('since'); // ISO date string optionnel

  const sinceDate = since ?? new Date(Date.now() - 30 * 86_400_000).toISOString();

  let query = supabase
    .from('social_publications')
    .select(
      'id, plateforme, statut, texte_adapte, hashtags, ' +
      'vues, likes, partages, commentaires, published_at, created_at'
    )
    .gte('created_at', sinceDate)
    .order('created_at', { ascending: false });

  if (plateforme) {
    query = query.eq('plateforme', plateforme);
  }

  const { data: publications, error: pubError } = await query;
  if (pubError) {
    return NextResponse.json({ error: pubError.message }, { status: 500 });
  }

  // Résumé par plateforme
  const { data: statsRaw, error: statsError } = await supabase
    .from('social_publications')
    .select('plateforme, statut, vues, likes, commentaires')
    .gte('created_at', sinceDate);

  if (statsError) {
    return NextResponse.json({ error: statsError.message }, { status: 500 });
  }

  interface StatRow {
    plateforme:   string;
    statut:       string;
    vues:         number;
    likes:        number;
    commentaires: number;
  }

  const rows = (statsRaw ?? []) as unknown as StatRow[];

  const statsByPlatform: Record<string, {
    total:    number;
    publie:   number;
    planifie: number;
    echec:    number;
    vues:     number;
    likes:    number;
    commentaires: number;
  }> = {};

  for (const row of rows) {
    const p = row.plateforme;
    if (!statsByPlatform[p]) {
      statsByPlatform[p] = { total: 0, publie: 0, planifie: 0, echec: 0, vues: 0, likes: 0, commentaires: 0 };
    }
    statsByPlatform[p].total++;
    if (row.statut === 'publie')   statsByPlatform[p].publie++;
    if (row.statut === 'planifie') statsByPlatform[p].planifie++;
    if (row.statut === 'echec')    statsByPlatform[p].echec++;
    statsByPlatform[p].vues         += row.vues;
    statsByPlatform[p].likes        += row.likes;
    statsByPlatform[p].commentaires += row.commentaires;
  }

  // Mentions récentes non traitées
  const { data: mentions } = await supabase
    .from('social_mentions')
    .select('id, plateforme, auteur, sentiment, opportunite, created_at')
    .eq('opportunite', true)
    .is('replied_at', null)
    .order('created_at', { ascending: false })
    .limit(10);

  return NextResponse.json({
    agent:        'SANJI',
    status:       'ACTIF',
    period:       sinceDate,
    publications: publications ?? [],
    stats:        statsByPlatform,
    opportunities_unhandled: mentions ?? [],
  });
}

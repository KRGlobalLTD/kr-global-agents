import { NextRequest, NextResponse } from 'next/server';
import { getContentMetrics, generateWeeklyReport } from '@/lib/agents/itachi/performance-tracker';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

interface TrackBody {
  content_id:  string;
  vues?:       number;
  likes?:      number;
  partages?:   number;
  clics?:      number;
  conversions?: number;
}

// GET /api/itachi/performance?content_id=xxx  → métriques d'un post
// GET /api/itachi/performance                 → stats globales par plateforme
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const contentId = searchParams.get('content_id');

  if (contentId) {
    const metrics = await getContentMetrics(contentId);
    if (!metrics) {
      return NextResponse.json({ error: 'Contenu introuvable' }, { status: 404 });
    }
    return NextResponse.json({ success: true, metrics });
  }

  // Stats globales : vues/clics/conversions par type de contenu (≈ plateforme)
  const { data, error } = await supabase
    .from('content')
    .select('id, marque, type, langue, statut, content_metrics(vues, clics, conversions)')
    .eq('statut', 'publie')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type MetricEntry = { vues: number; clics: number; conversions: number };
  type ContentEntry = { type: string; content_metrics: MetricEntry[] };

  const rows = (data ?? []) as unknown as ContentEntry[];

  const byType: Record<string, { vues: number; clics: number; conversions: number; count: number }> = {};
  for (const row of rows) {
    const t = row.type;
    if (!byType[t]) byType[t] = { vues: 0, clics: 0, conversions: 0, count: 0 };
    byType[t].count++;
    for (const m of row.content_metrics ?? []) {
      byType[t].vues        += m.vues;
      byType[t].clics       += m.clics;
      byType[t].conversions += m.conversions;
    }
  }

  const statsParPlateforme = Object.entries(byType).map(([plateforme, s]) => ({
    plateforme,
    posts:       s.count,
    vues:        s.vues,
    clics:       s.clics,
    conversions: s.conversions,
    ctr:         s.vues > 0 ? +((s.clics / s.vues) * 100).toFixed(2) : 0,
    roi_contenu: s.conversions > 0 ? +(s.conversions / s.count).toFixed(2) : 0,
  }));

  return NextResponse.json({
    agent:               'ITACHI',
    posts_publies:       rows.length,
    stats_par_plateforme: statsParPlateforme,
  });
}

// POST /api/itachi/performance — enregistre des métriques
// Body : { content_id, vues?, likes?, partages?, clics?, conversions? }
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  if (searchParams.get('action') === 'weekly_report') {
    await generateWeeklyReport();
    return NextResponse.json({ success: true, message: 'Rapport hebdomadaire envoyé sur Slack' });
  }

  let body: TrackBody;
  try {
    body = (await req.json()) as TrackBody;
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });
  }

  const { content_id, vues = 0, likes = 0, partages = 0, clics = 0, conversions = 0 } = body;

  if (!content_id) {
    return NextResponse.json({ error: 'content_id est requis' }, { status: 400 });
  }

  const { error: fetchError } = await supabase
    .from('content')
    .select('id')
    .eq('id', content_id)
    .single();

  if (fetchError) {
    return NextResponse.json({ error: `Contenu introuvable : ${content_id}` }, { status: 404 });
  }

  const { error } = await supabase.from('content_metrics').insert({
    content_id,
    vues,
    clics,
    conversions,
    recorded_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mise à jour des compteurs agrégés directement sur content (likes et partages)
  if (likes > 0 || partages > 0) {
    await supabase.rpc('increment_content_engagement', {
      p_content_id: content_id,
      p_likes:      likes,
      p_partages:   partages,
    }).then(() => {
      // ignore si la RPC n'existe pas encore
    });
  }

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Métriques enregistrées : content_id=${content_id}, vues=${vues}, clics=${clics}, conversions=${conversions}`,
  });

  return NextResponse.json({ success: true, content_id });
}

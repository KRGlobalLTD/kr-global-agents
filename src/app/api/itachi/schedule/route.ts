import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { notifyDraft } from '@/lib/agents/itachi/slack-notifier';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

interface ScheduleBody {
  content_id:  string;
  date_prevue: string; // ISO 8601
}

interface ContentRow {
  id:       string;
  titre:    string | null;
  contenu:  string | null;
  hashtags: string[];
  marque:   string;
  type:     string;
  langue:   string;
  statut:   string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: ScheduleBody;
  try {
    body = (await req.json()) as ScheduleBody;
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });
  }

  const { content_id, date_prevue } = body;

  if (!content_id || !date_prevue) {
    return NextResponse.json({ error: 'content_id et date_prevue sont requis' }, { status: 400 });
  }

  const datePrevue = new Date(date_prevue);
  if (isNaN(datePrevue.getTime())) {
    return NextResponse.json({ error: 'date_prevue invalide (format ISO 8601 attendu)' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('content')
    .update({ date_prevue: datePrevue.toISOString() })
    .eq('id', content_id)
    .select('id, titre, contenu, hashtags, marque, type, langue, statut')
    .single();

  if (error) {
    return NextResponse.json({ error: `Contenu introuvable ou erreur : ${error.message}` }, { status: 404 });
  }

  const row = data as ContentRow;

  await notifyDraft({
    contentId:  row.id,
    plateforme: row.type === 'article' ? 'blog' : row.type,
    langue:     row.langue,
    titre:      row.titre,
    contenu:    row.contenu ?? '',
    hashtags:   Array.isArray(row.hashtags) ? row.hashtags : [],
    datePrevue,
  });

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Contenu planifié id=${content_id} pour le ${datePrevue.toISOString()}`,
  });

  return NextResponse.json({
    success:     true,
    content_id,
    date_prevue: datePrevue.toISOString(),
    statut:      row.statut,
  });
}

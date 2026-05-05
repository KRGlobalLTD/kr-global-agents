import { NextRequest, NextResponse } from 'next/server';
import { runSeasonalPlanner } from '@/lib/agents/itachi/seasonal-planner';

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

interface SeasonalBody {
  marque?:  string;
  langue?:  string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: SeasonalBody = {};
  try {
    body = (await req.json()) as SeasonalBody;
  } catch {
    // Corps vide → valeurs par défaut
  }

  const {
    marque = 'KR Global Solutions Ltd',
    langue = 'fr',
  } = body;

  try {
    const result = await runSeasonalPlanner(marque, langue);

    return NextResponse.json({
      success:          true,
      events_detected:  result.events_detected,
      sectors_alerted:  result.sectors_alerted,
      themes_suggested: result.themes_suggested,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    endpoint:    'POST /api/itachi/seasonal',
    description: 'Adapte la stratégie contenu selon la saisonnalité (lecture table seasonal_calendar + calendrier statique)',
    body: {
      marque: 'string — nom de la marque (défaut: KR Global Solutions Ltd)',
      langue: '"fr" | "en" | "ar" (défaut: fr)',
    },
    note: 'Alerte automatiquement KILLUA via Slack #prospects pour les secteurs à fort enjeu',
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyCalendar } from '@/lib/agents/itachi/calendar-planner';

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

interface CalendarBody {
  week?:       string;  // "next" (seule valeur supportée)
  marque?:     string;
  secteur?:    string;
  langue?:     string;
  entite_nom?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: CalendarBody = {};
  try {
    body = (await req.json()) as CalendarBody;
  } catch {
    // Corps vide → valeurs par défaut
  }

  const {
    marque     = 'KR Global Solutions Ltd',
    secteur    = 'agence IA et automatisation',
    langue     = 'fr',
    entite_nom = 'KR Global',
  } = body;

  try {
    const result = await generateWeeklyCalendar(marque, secteur, langue, entite_nom);

    return NextResponse.json({
      success:       true,
      week_start:    result.week_start,
      items_created: result.items_created,
      content_ids:   result.content_ids,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    endpoint:    'POST /api/itachi/calendar',
    description: 'Génère le calendrier éditorial de la semaine suivante',
    body: {
      week:       '"next" (défaut)',
      marque:     'string — nom de la marque',
      secteur:    'string — secteur d\'activité',
      langue:     '"fr" | "en" | "ar"',
      entite_nom: 'string — entité facturation',
    },
  });
}

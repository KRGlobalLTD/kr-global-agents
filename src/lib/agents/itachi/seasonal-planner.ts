import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface SeasonalEvent {
  id:        string;
  mois:      number;
  secteur:   string;
  evenement: string;
  intensite: 'faible' | 'normal' | 'fort' | 'critique';
}

export interface SeasonalPlanResult {
  events_detected:  number;
  sectors_alerted:  string[];
  themes_suggested: Record<string, string[]>;
}

// Calendrier saisonnier statique de référence (complété par la table Supabase)
const STATIC_SEASONAL: Array<Omit<SeasonalEvent, 'id'>> = [
  { mois: 1,  secteur: 'retail',       evenement: 'Soldes d\'hiver',            intensite: 'fort'     },
  { mois: 2,  secteur: 'general',      evenement: 'Saint-Valentin',             intensite: 'normal'   },
  { mois: 3,  secteur: 'ecommerce',    evenement: 'Printemps / nouvelles cols', intensite: 'normal'   },
  { mois: 4,  secteur: 'general',      evenement: 'Pâques / vacances scolaires', intensite: 'normal'  },
  { mois: 5,  secteur: 'b2b',          evenement: 'Fin Q1 — bilan stratégique', intensite: 'fort'     },
  { mois: 6,  secteur: 'recrutement',  evenement: 'Saison recrutement été',     intensite: 'fort'     },
  { mois: 7,  secteur: 'tourisme',     evenement: 'Haute saison été',           intensite: 'critique' },
  { mois: 8,  secteur: 'ecommerce',    evenement: 'Préparation rentrée',        intensite: 'fort'     },
  { mois: 9,  secteur: 'b2b',          evenement: 'Rentrée / nouveaux budgets', intensite: 'critique' },
  { mois: 10, secteur: 'ecommerce',    evenement: 'Pré-Black Friday',           intensite: 'fort'     },
  { mois: 11, secteur: 'ecommerce',    evenement: 'Black Friday / Cyber Monday', intensite: 'critique'},
  { mois: 12, secteur: 'general',      evenement: 'Fêtes de fin d\'année',      intensite: 'critique' },
];

// Thèmes suggérés par secteur et par intensité
function suggestThemes(evenement: string, secteur: string, intensite: string): string[] {
  const base = [
    `Comment préparer votre ${secteur} pour ${evenement}`,
    `Stratégie IA pour maximiser ${evenement}`,
    `${evenement} : checklist complète pour les entreprises`,
  ];

  if (intensite === 'fort' || intensite === 'critique') {
    base.push(
      `Automatisation indispensable avant ${evenement}`,
      `${evenement} : ce que vos concurrents font déjà (et pas vous)`,
    );
  }

  return base;
}

async function getUpcomingEvents(weeksAhead: number): Promise<SeasonalEvent[]> {
  const now    = new Date();
  const target = new Date(now.getTime() + weeksAhead * 7 * 24 * 60 * 60 * 1000);

  // Mois concernés (current → target)
  const moisCourant = now.getMonth() + 1;
  const moisCible   = target.getMonth() + 1;

  const moisRange: number[] = [];
  for (let m = moisCourant; m <= moisCible; m++) {
    moisRange.push(m > 12 ? m - 12 : m);
  }

  const { data, error } = await supabase
    .from('seasonal_calendar')
    .select('id, mois, secteur, evenement, intensite')
    .in('mois', moisRange)
    .order('mois', { ascending: true });

  if (error) {
    await supabase.from('alerts').insert({
      agent_name: 'ITACHI',
      level:      'WARNING',
      message:    `seasonal_calendar lecture erreur : ${error.message}`,
    });
  }

  // Fusionner les données Supabase avec le calendrier statique
  const dbEvents = (data ?? []) as SeasonalEvent[];
  const staticEvents = STATIC_SEASONAL
    .filter(e => moisRange.includes(e.mois))
    .map(e => ({ ...e, id: `static_${e.mois}_${e.secteur}` }));

  const existing = new Set(dbEvents.map(e => `${e.mois}_${e.secteur}`));
  const toMerge  = staticEvents.filter(e => !existing.has(`${e.mois}_${e.secteur}`));

  return [...dbEvents, ...toMerge];
}

async function alertProspects(secteur: string, evenement: string, intensite: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_PROSPECTS;
  if (!url) return;

  const icon = intensite === 'critique' ? '🚨' : intensite === 'fort' ? '⚠️' : '📅';

  await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text:
        `${icon} *ITACHI - Signal saisonnier : intensifier la prospection*\n` +
        `*Secteur :* ${secteur}\n` +
        `*Événement :* ${evenement}\n` +
        `*Intensité :* ${intensite.toUpperCase()}\n` +
        `*Action KILLUA :* augmenter le volume de cold emails et la fréquence de relance pour ce secteur dans les 3 prochaines semaines.`,
      username:   'ITACHI',
      icon_emoji: ':calendar:',
    }),
  });
}

async function adaptContentThemes(
  events: SeasonalEvent[],
  marque: string,
  langue: string
): Promise<Record<string, string[]>> {
  const themes: Record<string, string[]> = {};

  for (const ev of events) {
    const key     = `${ev.secteur} — ${ev.evenement}`;
    themes[key]   = suggestThemes(ev.evenement, ev.secteur, ev.intensite);
  }

  // Notifier Slack #contenu avec les thèmes adaptés
  if (Object.keys(themes).length > 0) {
    const lines = Object.entries(themes).map(([evt, themeList]) =>
      `*${evt}* :\n` + themeList.map(t => `  • ${t}`).join('\n')
    );

    const slackUrl = process.env.SLACK_WEBHOOK_CONTENU;
    if (slackUrl) {
      await fetch(slackUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text:
            `🌿 *ITACHI - Adaptation saisonnière du calendrier contenu*\n` +
            `Marque : ${marque} | Langue : ${langue}\n\n` +
            `Thèmes suggérés pour les 3 prochaines semaines :\n` +
            lines.join('\n\n'),
          username:   'ITACHI',
          icon_emoji: ':calendar:',
        }),
      });
    }
  }

  return themes;
}

export async function runSeasonalPlanner(
  marque: string,
  langue: string
): Promise<SeasonalPlanResult> {
  const WEEKS_AHEAD = 3;
  const events      = await getUpcomingEvents(WEEKS_AHEAD);

  const strongEvents    = events.filter(e => e.intensite === 'fort' || e.intensite === 'critique');
  const sectorsAlerted: string[] = [];

  // Alerter KILLUA pour chaque secteur à fort enjeu
  for (const ev of strongEvents) {
    if (!sectorsAlerted.includes(ev.secteur)) {
      await alertProspects(ev.secteur, ev.evenement, ev.intensite);
      sectorsAlerted.push(ev.secteur);
    }
  }

  const themes = await adaptContentThemes(events, marque, langue);

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Planification saisonnière : ${events.length} événements détectés, ${sectorsAlerted.length} secteurs alertés`,
  });

  return {
    events_detected:  events.length,
    sectors_alerted:  sectorsAlerted,
    themes_suggested: themes,
  };
}

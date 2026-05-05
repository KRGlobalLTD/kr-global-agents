import { createClient } from '@supabase/supabase-js';
import type { ContentType } from './content-generator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Mix hebdomadaire : 2 SEO + 5 social + 1 newsletter + 1 podcast = 9 items
interface CalendarSlot {
  type: ContentType;
  jour: number; // 1=lundi … 5=vendredi
}

const WEEKLY_SLOTS: CalendarSlot[] = [
  { type: 'article_seo',    jour: 1 },
  { type: 'post_linkedin',  jour: 1 },
  { type: 'post_instagram', jour: 2 },
  { type: 'article_seo',    jour: 3 },
  { type: 'post_tiktok',    jour: 3 },
  { type: 'post_linkedin',  jour: 4 },
  { type: 'newsletter',     jour: 4 },
  { type: 'post_instagram', jour: 5 },
  { type: 'script_podcast', jour: 5 },
];

export interface CalendarPlanResult {
  week_start:    string;
  items_created: number;
  content_ids:   string[];
}

// --- Helpers ---

function getNextMonday(): Date {
  const d   = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(9, 0, 0, 0);
  return d;
}

function toSlotDate(monday: Date, jour: number): Date {
  const d = new Date(monday);
  d.setDate(monday.getDate() + jour - 1);
  return d;
}

async function generateTopics(
  marque:  string,
  secteur: string,
  langue:  string
): Promise<Partial<Record<ContentType, string[]>>> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kr-global.com',
      'X-Title':      'ITACHI - KR Global',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.0-flash-001',
      messages: [{
        role:    'user',
        content:
          `Tu es stratège contenu pour ${marque} (agence IA, Londres).\n` +
          `Génère des sujets de contenu pour la semaine prochaine, secteur : ${secteur}, langue : ${langue}.\n\n` +
          `Retourne UNIQUEMENT ce JSON (sujets concis, actionnables, saisonniers) :\n` +
          `{\n` +
          `  "article_seo": ["sujet 1", "sujet 2"],\n` +
          `  "post_linkedin": ["sujet 1", "sujet 2"],\n` +
          `  "post_instagram": ["sujet 1", "sujet 2"],\n` +
          `  "post_tiktok": ["sujet 1"],\n` +
          `  "newsletter": ["sujet 1"],\n` +
          `  "script_podcast": ["sujet 1"]\n` +
          `}`,
      }],
      response_format: { type: 'json_object' },
      temperature: 0.85,
      max_tokens:  800,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter topics ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const raw  = data.choices?.[0]?.message?.content ?? '{}';

  try { return JSON.parse(raw) as Partial<Record<ContentType, string[]>>; }
  catch { return {}; }
}

async function postSlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_CONTENU;
  if (!url) return;
  await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, username: 'ITACHI', icon_emoji: ':calendar:' }),
  });
}

// --- Main ---

export async function generateWeeklyCalendar(
  marque:     string,
  secteur:    string,
  langue:     string,
  entite_nom: string
): Promise<CalendarPlanResult> {
  const monday = getNextMonday();
  const topics = await generateTopics(marque, secteur, langue);

  const cursors: Partial<Record<ContentType, number>> = {};
  const contentIds: string[] = [];

  const TYPE_LABELS: Record<ContentType, string> = {
    article_seo:    '📝 Article SEO',
    post_linkedin:  '🔗 LinkedIn',
    post_instagram: '📸 Instagram',
    post_tiktok:    '🎵 TikTok',
    newsletter:     '📬 Newsletter',
    script_podcast: '🎙️ Podcast',
    script_youtube: '🎬 YouTube',
  };

  const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
  const summaryLines: string[] = [];

  for (const slot of WEEKLY_SLOTS) {
    const slotTopics = topics[slot.type] ?? [`${slot.type} — ${marque}`];
    const cursor = cursors[slot.type] ?? 0;
    const sujet  = slotTopics[cursor % slotTopics.length] ?? `Contenu ${slot.type}`;
    cursors[slot.type] = cursor + 1;

    const datePub = toSlotDate(monday, slot.jour);
    const isLong  = slot.type === 'article_seo' || slot.type.startsWith('script');

    const { data, error } = await supabase
      .from('content')
      .insert({
        marque,
        type:        slot.type,
        sujet,
        ton:         'professionnel',
        langue,
        longueur:    isLong ? 'long' : 'court',
        entite_nom,
        statut:      'draft',
        date_prevue: datePub.toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      await supabase.from('alerts').insert({
        agent_name: 'ITACHI',
        level:      'WARNING',
        message:    `Calendrier : erreur insert (${slot.type}) : ${error.message}`,
      });
      continue;
    }

    contentIds.push((data as { id: string }).id);
    summaryLines.push(`• ${DAY_NAMES[slot.jour - 1]} — ${TYPE_LABELS[slot.type]} : ${sujet.slice(0, 55)}`);
  }

  const weekStart = monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const weekEnd   = toSlotDate(monday, 5).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  await postSlack(
    `📅 *Calendrier éditorial — semaine du ${weekStart} au ${weekEnd}*\n` +
    `Marque : ${marque} | ${contentIds.length}/${WEEKLY_SLOTS.length} drafts créés\n\n` +
    summaryLines.join('\n') + '\n\n' +
    `_Déclenchez la génération de chaque draft via_ \`POST /api/itachi/generate\``
  );

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Calendrier semaine du ${weekStart} créé : ${contentIds.length} drafts (${marque})`,
  });

  return {
    week_start:    monday.toISOString(),
    items_created: contentIds.length,
    content_ids:   contentIds,
  };
}

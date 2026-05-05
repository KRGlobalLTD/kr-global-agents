import { createClient } from '@supabase/supabase-js';
import { callOpenRouter, parseJsonSafe } from './content-generator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface PodcastInput {
  sujet:      string;
  marque:     string;
  langue:     string;
  ton:        string;
  entite_nom: string;
}

export interface PodcastOutput {
  titre:          string;
  description:    string;
  script_complet: string;
  show_notes:     string;
  modele:         string;
}

const MODEL = 'moonshotai/kimi-k2';
const COST_PER_1K = { input: 0.0010, output: 0.0030 };

// Thèmes récurrents du podcast KR Global
const PODCAST_THEMES = [
  'Entrepreneuriat et agence IA',
  'Automatisation et productivité',
  'Lifestyle entrepreneur / voyage business',
  'Stratégie digitale et croissance',
  'Behind-the-scenes de KR Global',
];

function buildSystemPrompt(input: PodcastInput): string {
  const themes = PODCAST_THEMES.join(', ');

  return (
    `Tu es le producteur de contenu podcast de KR Global Solutions Ltd (agence IA, Londres UK).\n` +
    `Marque : ${input.marque} | Langue : ${input.langue} | Ton : ${input.ton}\n` +
    `Thèmes du podcast : ${themes}\n\n` +
    `Génère un script de podcast complet pour une durée de 20-30 minutes.\n\n` +
    `Structure OBLIGATOIRE avec timings :\n` +
    `[INTRO — 2 min]\n` +
    `Accroche percutante + musique de générique + présentation du sujet et de l'épisode\n\n` +
    `[SUJET 1 — 8 min]\n` +
    `Développement principal avec exemples concrets, anecdotes, cas d'usage\n\n` +
    `[SUJET 2 — 8 min]\n` +
    `Approfondissement, témoignages ou cas pratiques, conseil actionnable\n\n` +
    `[CONCLUSION + CTA — 2 min]\n` +
    `Synthèse des points clés + invitation à l'action (visite site, contact, prochain épisode)\n\n` +
    `Retourne UNIQUEMENT un JSON valide :\n` +
    `{\n` +
    `  "titre": "...",\n` +
    `  "description": "...",\n` +
    `  "script_complet": "...",\n` +
    `  "show_notes": "..."\n` +
    `}\n\n` +
    `Règles :\n` +
    `- "titre" : accrocheur, SEO-friendly, max 70 chars\n` +
    `- "description" : 200-300 mots, optimisé pour Spotify/Apple Podcasts\n` +
    `- "script_complet" : script rédigé mot pour mot avec les timings entre crochets [INTRO — 2min]\n` +
    `- "show_notes" : liste des points clés, ressources mentionnées, liens utiles\n` +
    `- Style oral naturel, pas de jargon technique non expliqué\n` +
    `- Jamais de statistiques inventées`
  );
}

export async function generatePodcastScript(input: PodcastInput): Promise<PodcastOutput> {
  const { raw, usage } = await callOpenRouter(
    MODEL,
    buildSystemPrompt(input),
    `Sujet de cet épisode : ${input.sujet}`,
    7000
  );

  const parsed = parseJsonSafe(raw);

  const titre = typeof parsed['titre'] === 'string' && parsed['titre'].length > 0
    ? parsed['titre'] : `Épisode : ${input.sujet}`;

  const description = typeof parsed['description'] === 'string'
    ? parsed['description'] : '';

  const script_complet = typeof parsed['script_complet'] === 'string'
    ? parsed['script_complet'] : '';

  const show_notes = typeof parsed['show_notes'] === 'string'
    ? parsed['show_notes'] : '';

  const cout = (usage.prompt_tokens / 1000) * COST_PER_1K.input
             + (usage.completion_tokens / 1000) * COST_PER_1K.output;

  await supabase.from('couts_par_entite').insert({
    entite_nom:    input.entite_nom,
    agent_name:    'ITACHI',
    modele:        MODEL,
    operation:     'podcast_script',
    tokens_input:  usage.prompt_tokens,
    tokens_output: usage.completion_tokens,
    cout_estime:   cout,
  });

  const slackUrl = process.env.SLACK_WEBHOOK_CONTENU;
  if (slackUrl) {
    await fetch(slackUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text:
          `🎙️ *Nouveau script podcast généré*\n` +
          `*Titre :* ${titre}\n` +
          `*Sujet :* ${input.sujet}\n` +
          `*Marque :* ${input.marque} | *Langue :* ${input.langue}\n` +
          `_Script disponible — à enregistrer et monter_`,
        username:   'ITACHI',
        icon_emoji: ':microphone:',
      }),
    });
  }

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Script podcast "${titre}" généré (${usage.completion_tokens} tokens, entité=${input.entite_nom})`,
  });

  return { titre, description, script_complet, show_notes, modele: MODEL };
}

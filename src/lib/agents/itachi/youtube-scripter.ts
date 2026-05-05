import { createClient } from '@supabase/supabase-js';
import { callOpenRouter, parseJsonSafe } from './content-generator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface YoutubeInput {
  sujet:      string;
  marque:     string;
  langue:     string;
  ton:        string;
  entite_nom: string;
}

export interface YoutubeOutput {
  titre:               string;
  description_youtube: string;
  script:              string;
  tags:                string[];
  modele:              string;
}

const MODEL = 'moonshotai/kimi-k2';
const COST_PER_1K = { input: 0.0010, output: 0.0030 };

function buildSystemPrompt(input: YoutubeInput): string {
  return (
    `Tu es le scripteur YouTube de KR Global Solutions Ltd (agence IA, Londres UK).\n` +
    `Marque : ${input.marque} | Langue : ${input.langue} | Ton : ${input.ton}\n\n` +
    `Génère un script YouTube COMPLET optimisé pour la synthèse vocale ElevenLabs.\n` +
    `Durée cible : 8-12 minutes (environ 1 200-1 800 mots à l'oral).\n\n` +
    `Structure OBLIGATOIRE :\n` +
    `[HOOK — 30s] Accroche irrésistible : question, stat choc, ou promesse forte\n` +
    `[INTRO PROBLÈME — 1min] Identification du problème central, pourquoi ce sujet maintenant\n` +
    `[SECTION 1 — 2min] Premier point clé avec exemple concret\n` +
    `[SECTION 2 — 2min] Deuxième point clé avec cas d'usage réel\n` +
    `[SECTION 3 — 2min] Troisième point clé avec conseil actionnable\n` +
    `[SECTION 4 — 2min] Optionnel : approfondissement ou bonus\n` +
    `[CONCLUSION + CTA — 1min] Synthèse + abonnement + ressource gratuite\n\n` +
    `Règles ElevenLabs (synthèse vocale) :\n` +
    `- Phrases courtes (max 20 mots), naturelles à l'oral\n` +
    `- Pas de listes à puces (transformer en phrases)\n` +
    `- Pauses indiquées par [...] dans le script\n` +
    `- Répétition clé des mots importants pour l'intonation\n` +
    `- Zéro jargon technique sans explication immédiate\n\n` +
    `Retourne UNIQUEMENT un JSON valide :\n` +
    `{\n` +
    `  "titre": "...",\n` +
    `  "description_youtube": "...",\n` +
    `  "script": "...",\n` +
    `  "tags": ["tag1", "tag2"]\n` +
    `}\n\n` +
    `- "titre" : accrocheur, 60-70 chars, incluant le mot-clé principal\n` +
    `- "description_youtube" : 500 chars max, inclut les timestamps des sections, CTA et liens\n` +
    `- "script" : script complet avec les marqueurs de section entre crochets\n` +
    `- "tags" : 10-15 tags YouTube optimisés (mix large + niche)`
  );
}

export async function generateYoutubeScript(input: YoutubeInput): Promise<YoutubeOutput> {
  const { raw, usage } = await callOpenRouter(
    MODEL,
    buildSystemPrompt(input),
    `Sujet de la vidéo : ${input.sujet}`,
    7000
  );

  const parsed = parseJsonSafe(raw);

  const titre = typeof parsed['titre'] === 'string' && parsed['titre'].length > 0
    ? parsed['titre'] : input.sujet;

  const description_youtube = typeof parsed['description_youtube'] === 'string'
    ? parsed['description_youtube'].slice(0, 5000) : '';

  const script = typeof parsed['script'] === 'string' ? parsed['script'] : '';

  const tags = Array.isArray(parsed['tags'])
    ? (parsed['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];

  const cout = (usage.prompt_tokens / 1000) * COST_PER_1K.input
             + (usage.completion_tokens / 1000) * COST_PER_1K.output;

  await supabase.from('couts_par_entite').insert({
    entite_nom:    input.entite_nom,
    agent_name:    'ITACHI',
    modele:        MODEL,
    operation:     'youtube_script',
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
          `🎬 *Nouveau script YouTube généré*\n` +
          `*Titre :* ${titre}\n` +
          `*Sujet :* ${input.sujet}\n` +
          `*Marque :* ${input.marque} | *Langue :* ${input.langue}\n` +
          `_Script prêt pour ElevenLabs — à enregistrer et monter_`,
        username:   'ITACHI',
        icon_emoji: ':clapper:',
      }),
    });
  }

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Script YouTube "${titre}" généré (${usage.completion_tokens} tokens, entité=${input.entite_nom})`,
  });

  return { titre, description_youtube, script, tags, modele: MODEL };
}

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type ContentType =
  | 'article_seo'
  | 'post_linkedin'
  | 'post_instagram'
  | 'post_tiktok'
  | 'newsletter'
  | 'script_podcast'
  | 'script_youtube';

export type Longueur = 'court' | 'moyen' | 'long';

export interface ContentRequest {
  marque:     string;
  type:       ContentType;
  sujet:      string;
  ton:        string;
  langue:     string;
  longueur?:  Longueur;
  entite_nom: string;
}

export interface GeneratedContent {
  titre:            string;
  contenu:          string;
  hashtags:         string[];
  meta_description: string;
  modele:           string;
}

interface OpenRouterUsage {
  prompt_tokens:     number;
  completion_tokens: number;
  total_tokens:      number;
}

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
  usage?:  OpenRouterUsage;
}

// Articles longs → kimi-k2 | Posts courts → gemini | (claude-sonnet-4-5 utilisé par seo-writer/podcast pour contenu stratégique)
const MODEL_MAP: Record<ContentType, string> = {
  article_seo:    'moonshotai/kimi-k2',
  script_podcast: 'moonshotai/kimi-k2',
  script_youtube: 'moonshotai/kimi-k2',
  post_linkedin:  'google/gemini-2.0-flash-001',
  post_instagram: 'google/gemini-2.0-flash-001',
  post_tiktok:    'google/gemini-2.0-flash-001',
  newsletter:     'google/gemini-2.0-flash-001',
};

const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'moonshotai/kimi-k2':          { input: 0.0010, output: 0.0030 },
  'google/gemini-2.0-flash-001': { input: 0.0001, output: 0.0004 },
  'anthropic/claude-sonnet-4-5': { input: 0.0015, output: 0.0075 },
};

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const rates = COST_PER_1K[model] ?? { input: 0.001, output: 0.003 };
  return (tokensIn / 1000) * rates.input + (tokensOut / 1000) * rates.output;
}

const TYPE_INSTRUCTIONS: Record<ContentType, string> = {
  article_seo:
    `Génère un article SEO complet en HTML.\n` +
    `Structure obligatoire : <h1>Titre accrocheur</h1>, intro 150 mots, 3-4 <h2> avec contenu riche, conclusion, <strong>CTA final</strong>.\n` +
    `Densité mots-clés 1-2%. Longueur 800-1200 mots. "contenu" = HTML complet.`,

  post_linkedin:
    `Génère un post LinkedIn professionnel.\n` +
    `Règles : accroche forte ligne 1 (jamais commencer par "Je"), 3-5 paragraphes courts séparés par sauts de ligne, 1 insight actionnable, question engageante en fin.\n` +
    `Max 1300 caractères. "contenu" = texte brut du post. 3-5 hashtags dans "hashtags".`,

  post_instagram:
    `Génère une légende Instagram engageante.\n` +
    `Règles : première ligne accrocheuse + emoji, corps avec emojis pertinents, CTA clair, 10-15 hashtags mix populaires + niche.\n` +
    `Max 2200 caractères. "contenu" = légende complète. Hashtags sans # dans "hashtags".`,

  post_tiktok:
    `Génère un script TikTok court et dynamique.\n` +
    `Structure : hook 3 secondes (question ou affirmation choc), développement problème-solution-résultat, CTA à 80% du script.\n` +
    `Ton conversationnel, rythme rapide. Max 150 mots. "contenu" = script à lire.`,

  newsletter:
    `Génère une newsletter complète.\n` +
    `"titre" = objet email max 50 chars. "meta_description" = texte prévisualisation max 100 chars.\n` +
    `"contenu" = corps HTML : intro + 2-3 sections thématiques + CTA final. Ton chaleureux, valeur ajoutée immédiate.`,

  script_podcast:
    `Génère un script de podcast pour 20-30 minutes.\n` +
    `Structure avec timings : [INTRO 2min] accroche + présentation, [SUJET 1 8min] avec exemples, [SUJET 2 8min] avec cas concrets, [CONCLUSION+CTA 2min].\n` +
    `Thèmes : entrepreneuriat IA, lifestyle entrepreneur, voyage business. "contenu" = script complet. "meta_description" = show notes.`,

  script_youtube:
    `Génère un script YouTube optimisé pour synthèse vocale ElevenLabs.\n` +
    `Durée : 8-12 minutes. Structure : [HOOK 30s], [INTRO PROBLÈME 1min], [SECTION 1-3 2min chacune], [CONCLUSION+CTA 1min].\n` +
    `Style : phrases courtes, fluides à l'oral, pas de listes complexes. "contenu" = script complet. "meta_description" = description YouTube 500 chars max.`,
};

function buildSystemPrompt(req: ContentRequest): string {
  return (
    `Tu es ITACHI, l'agent marketing et contenu de KR Global Solutions Ltd (agence IA, Londres UK).\n` +
    `Marque : ${req.marque} | Ton : ${req.ton} | Langue : ${req.langue}\n\n` +
    `${TYPE_INSTRUCTIONS[req.type]}\n\n` +
    `Retourne UNIQUEMENT un JSON valide :\n` +
    `{ "titre": "...", "contenu": "...", "hashtags": ["mot1", "mot2"], "meta_description": "..." }\n\n` +
    `Contraintes : "hashtags" sans le symbole # | "meta_description" 155 chars max | jamais de données fictives`
  );
}

export async function callOpenRouter(
  model:       string,
  systemPrompt: string,
  userPrompt:  string,
  maxTokens =  4000
): Promise<{ raw: string; usage: OpenRouterUsage }> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kr-global.com',
      'X-Title':      'ITACHI - KR Global',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.75,
      max_tokens:      maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }

  const data = (await res.json()) as OpenRouterResponse;
  const raw  = data.choices?.[0]?.message?.content ?? '{}';
  const usage: OpenRouterUsage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  return { raw, usage };
}

export function parseJsonSafe(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`JSON contenu invalide : ${raw.slice(0, 200)}`); }
}

export async function generateContent(req: ContentRequest): Promise<GeneratedContent> {
  const model     = MODEL_MAP[req.type];
  const maxTokens = model === 'moonshotai/kimi-k2' ? 6000 : 3000;

  const { raw, usage } = await callOpenRouter(
    model,
    buildSystemPrompt(req),
    `Sujet : ${req.sujet}`,
    maxTokens
  );

  const parsed = parseJsonSafe(raw);

  const titre = typeof parsed['titre'] === 'string' && parsed['titre'].length > 0
    ? parsed['titre'] : req.sujet;

  const contenu = typeof parsed['contenu'] === 'string' ? parsed['contenu'] : '';

  const hashtags = Array.isArray(parsed['hashtags'])
    ? (parsed['hashtags'] as unknown[]).filter((h): h is string => typeof h === 'string')
    : [];

  const meta_description = typeof parsed['meta_description'] === 'string'
    ? parsed['meta_description'].slice(0, 155) : '';

  const cout = estimateCost(model, usage.prompt_tokens, usage.completion_tokens);

  await supabase.from('couts_par_entite').insert({
    entite_nom:    req.entite_nom,
    agent_name:    'ITACHI',
    modele:        model,
    operation:     `generate_${req.type}`,
    tokens_input:  usage.prompt_tokens,
    tokens_output: usage.completion_tokens,
    cout_estime:   cout,
  });

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Contenu "${titre}" généré (type=${req.type}, modèle=${model}, entité=${req.entite_nom})`,
  });

  return { titre, contenu, hashtags, meta_description, modele: model };
}

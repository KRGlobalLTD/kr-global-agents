import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export type ContentType = 'article' | 'post' | 'strategie';
export type Longueur    = 'court' | 'moyen' | 'long';

export interface ContentRequest {
  marque:     string;
  type:       ContentType;
  sujet:      string;
  ton:        string;
  langue:     string;
  longueur:   Longueur;
  entite_nom: string;
}

export interface GeneratedContent {
  titre:            string;
  contenu:          string;
  hashtags:         string[];
  meta_description: string;
  modele:           string;
}

// ---- OpenRouter types ----

interface OpenRouterUsage {
  prompt_tokens:     number;
  completion_tokens: number;
  total_tokens:      number;
}

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
  usage?:  OpenRouterUsage;
}

// ---- Model routing ----

const MODEL_MAP: Record<ContentType, string> = {
  article:   'moonshotai/kimi-k2',
  post:      'google/gemini-2.0-flash',
  strategie: 'anthropic/claude-sonnet-4-5',
};

// Coût estimé pour 1 000 tokens (en EUR, approximatif)
const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'moonshotai/kimi-k2':          { input: 0.0010, output: 0.0030 },
  'google/gemini-2.0-flash':     { input: 0.0001, output: 0.0004 },
  'anthropic/claude-sonnet-4-5': { input: 0.0015, output: 0.0075 },
};

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const rates = COST_PER_1K[model] ?? { input: 0.001, output: 0.003 };
  return (tokensIn / 1000) * rates.input + (tokensOut / 1000) * rates.output;
}

// ---- Prompt builders ----

const WORD_TARGETS: Record<Longueur, string> = {
  court: '100–200 mots',
  moyen: '400–600 mots',
  long:  '1 000–1 500 mots',
};

function buildSystemPrompt(req: ContentRequest): string {
  return (
    `Tu es ITACHI, l'agent marketing et contenu de KR Global Solutions Ltd (agence IA, Londres).\n\n` +
    `Génère du contenu pour la marque : ${req.marque}\n` +
    `Type : ${req.type} | Ton : ${req.ton} | Langue : ${req.langue} | Longueur cible : ${WORD_TARGETS[req.longueur]}\n\n` +
    `Retourne UNIQUEMENT un JSON valide avec ces clés exactes :\n` +
    `{ "titre": "...", "contenu": "...", "hashtags": ["...", "..."], "meta_description": "..." }\n\n` +
    `Règles :\n` +
    `- "contenu" : texte brut ou Markdown selon le type (aucun HTML)\n` +
    `- "hashtags" : tableau de 5 à 10 mots-clés sans le symbole # (ex: ["ia", "marketing"])\n` +
    `- "meta_description" : phrase de 150 caractères max, optimisée SEO\n` +
    `Ne jamais inventer de données, chiffres ou références fictives.`
  );
}

// ---- OpenRouter call ----

async function callOpenRouter(
  model:        string,
  systemPrompt: string,
  userPrompt:   string
): Promise<{ raw: string; usage: OpenRouterUsage }> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
      max_tokens:      4000,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${err}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  const raw  = data.choices?.[0]?.message?.content ?? '{}';

  const usage: OpenRouterUsage = data.usage ?? {
    prompt_tokens:     0,
    completion_tokens: 0,
    total_tokens:      0,
  };

  return { raw, usage };
}

// ---- Parsing helper ----

function parseJsonSafe(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`JSON contenu invalide : ${raw.slice(0, 200)}`);
  }
}

// ---- Main export ----

export async function generateContent(req: ContentRequest): Promise<GeneratedContent> {
  const model = MODEL_MAP[req.type];

  const { raw, usage } = await callOpenRouter(
    model,
    buildSystemPrompt(req),
    `Sujet : ${req.sujet}`
  );

  const parsed = parseJsonSafe(raw);

  const titre = typeof parsed['titre'] === 'string' && parsed['titre'].length > 0
    ? parsed['titre']
    : req.sujet;

  const contenu = typeof parsed['contenu'] === 'string'
    ? parsed['contenu']
    : '';

  const hashtags = Array.isArray(parsed['hashtags'])
    ? (parsed['hashtags'] as unknown[]).filter((h): h is string => typeof h === 'string')
    : [];

  const meta_description = typeof parsed['meta_description'] === 'string'
    ? parsed['meta_description'].slice(0, 160)
    : '';

  // Journaliser le coût IA par entité
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

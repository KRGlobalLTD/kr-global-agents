/**
 * Embedding providers — provider sélectionné automatiquement :
 *   JINA_API_KEY    → Jina jina-embeddings-v2-base-multilingual (768 dim, FR/EN/AR)
 *   OPENROUTER_API_KEY → openai/text-embedding-3-small (1536 dim)
 */

const JINA_MODEL = 'jina-embeddings-v3';
const OR_MODEL   = 'openai/text-embedding-3-small';

// Taille du vecteur — dépend du provider actif
export const VECTOR_DIM: number = process.env.JINA_API_KEY ? 1024 : 1536;

interface EmbedData {
  embedding: number[];
}

interface EmbedResponse {
  data: EmbedData[];
}

// ── Jina AI ──────────────────────────────────────────────────────────────────

async function jinaEmbed(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.JINA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:          JINA_MODEL,
      input:          texts,
      task:           'retrieval.passage',
      embedding_type: 'float',
    }),
  });

  if (!res.ok) throw new Error(`Jina embed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as EmbedResponse;
  return data.data.map(d => d.embedding);
}

// ── OpenRouter ────────────────────────────────────────────────────────────────

async function openrouterEmbed(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: OR_MODEL, input: texts }),
  });

  if (!res.ok) throw new Error(`OpenRouter embed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as EmbedResponse;
  return data.data.map(d => d.embedding);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];

  if (process.env.JINA_API_KEY) return jinaEmbed(texts);
  if (process.env.OPENROUTER_API_KEY) return openrouterEmbed(texts);

  throw new Error(
    'Aucun provider d\'embedding configuré. ' +
    'Ajouter JINA_API_KEY (gratuit → jina.ai) ou créditer OPENROUTER_API_KEY.',
  );
}

export async function embedOne(text: string): Promise<number[]> {
  const vectors = await embed([text]);
  return vectors[0]!;
}

export function activeProvider(): string {
  if (process.env.JINA_API_KEY) return `Jina AI (${JINA_MODEL}, ${VECTOR_DIM}d)`;
  if (process.env.OPENROUTER_API_KEY) return `OpenRouter (${OR_MODEL}, ${VECTOR_DIM}d)`;
  return 'none';
}

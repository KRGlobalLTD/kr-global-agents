import { qdrant } from './client';
import { embedOne, embed } from './embeddings';
import type { CollectionName } from './collections';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MemoryPoint {
  id:      string;
  text:    string;
  payload: Record<string, unknown>;
}

export interface RecallResult {
  id:      string;
  score:   number;
  text:    string;
  payload: Record<string, unknown>;
}

export interface RecallOptions {
  limit?:  number;
  filter?: QdrantFilter;
  minScore?: number;
}

export type QdrantFilter = Record<string, unknown>;

interface QdrantPoint {
  id:      string;
  vector:  number[];
  payload: Record<string, unknown>;
}

interface QdrantSearchResult {
  id:      string;
  score:   number;
  payload: Record<string, unknown>;
}

interface QdrantSearchResponse {
  result: QdrantSearchResult[];
}

interface QdrantGetResponse {
  result: Array<{
    id:      string;
    payload: Record<string, unknown>;
  }>;
}

// ── Core operations ───────────────────────────────────────────────────────────

export async function remember(
  collection: CollectionName,
  point: MemoryPoint,
): Promise<void> {
  const vector = await embedOne(point.text);

  const payload: Record<string, unknown> = {
    ...point.payload,
    _text: point.text,
  };

  const qdrantPoint: QdrantPoint = {
    id:      point.id,
    vector,
    payload,
  };

  await qdrant('PUT', `/collections/${collection}/points`, {
    points: [qdrantPoint],
  });
}

export async function rememberMany(
  collection: CollectionName,
  points: MemoryPoint[],
): Promise<void> {
  if (!points.length) return;

  const texts   = points.map(p => p.text);
  const vectors = await embed(texts);

  const qdrantPoints: QdrantPoint[] = points.map((p, i) => ({
    id:      p.id,
    vector:  vectors[i]!,
    payload: { ...p.payload, _text: p.text },
  }));

  await qdrant('PUT', `/collections/${collection}/points`, {
    points: qdrantPoints,
  });
}

export async function recall(
  collection: CollectionName,
  query: string,
  options: RecallOptions = {},
): Promise<RecallResult[]> {
  const { limit = 5, filter, minScore = 0 } = options;

  const vector = await embedOne(query);

  const body: Record<string, unknown> = {
    vector,
    limit,
    with_payload: true,
    with_vector:  false,
    score_threshold: minScore,
  };

  if (filter) body.filter = filter;

  const res = await qdrant<QdrantSearchResponse>(
    'POST',
    `/collections/${collection}/points/search`,
    body,
  );

  return res.result.map(r => ({
    id:      String(r.id),
    score:   r.score,
    text:    String(r.payload._text ?? ''),
    payload: Object.fromEntries(
      Object.entries(r.payload).filter(([k]) => k !== '_text'),
    ),
  }));
}

export async function forget(
  collection: CollectionName,
  id: string,
): Promise<void> {
  await qdrant('POST', `/collections/${collection}/points/delete`, {
    points: [id],
  });
}

export async function getMemory(
  collection: CollectionName,
  id: string,
): Promise<RecallResult | null> {
  const res = await qdrant<QdrantGetResponse>(
    'POST',
    `/collections/${collection}/points`,
    { ids: [id], with_payload: true },
  );

  if (!res.result.length) return null;

  const point = res.result[0]!;
  const payload = point.payload;

  return {
    id:      String(point.id),
    score:   1,
    text:    String(payload._text ?? ''),
    payload: Object.fromEntries(
      Object.entries(payload).filter(([k]) => k !== '_text'),
    ),
  };
}

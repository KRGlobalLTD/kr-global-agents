import { VECTOR_DIM } from './embeddings';
import { qdrant } from './client';

export const COLLECTIONS = {
  clients:    'kr_clients',
  prospects:  'kr_prospects',
  content:    'kr_content',
  knowledge:  'kr_knowledge',
  emails:     'kr_emails',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

interface CollectionInfo {
  status: string;
  vectors_count?: number;
}

interface CollectionsListResponse {
  result: { collections: { name: string }[] };
}

interface CollectionGetResponse {
  result: CollectionInfo;
}

export async function ensureCollection(name: CollectionName): Promise<void> {
  await qdrant('PUT', `/collections/${name}`, {
    vectors: {
      size:     VECTOR_DIM,
      distance: 'Cosine',
    },
    optimizers_config: {
      default_segment_number: 2,
    },
    replication_factor: 1,
  });
}

export async function collectionExists(name: CollectionName): Promise<boolean> {
  try {
    const list = await qdrant<CollectionsListResponse>('GET', '/collections');
    return list.result.collections.some(c => c.name === name);
  } catch {
    return false;
  }
}

export async function collectionInfo(name: CollectionName): Promise<CollectionInfo> {
  const res = await qdrant<CollectionGetResponse>('GET', `/collections/${name}`);
  return res.result;
}

export async function initAllCollections(): Promise<void> {
  for (const name of Object.values(COLLECTIONS)) {
    await ensureCollection(name as CollectionName);
  }
}

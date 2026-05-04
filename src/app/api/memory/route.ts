import { NextRequest, NextResponse } from 'next/server';
import { remember, rememberMany, recall, forget, getMemory } from '@/lib/qdrant/memory';
import { COLLECTIONS, type CollectionName } from '@/lib/qdrant/collections';

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

const VALID_COLLECTIONS = new Set<string>(Object.values(COLLECTIONS));

function isValidCollection(c: unknown): c is CollectionName {
  return typeof c === 'string' && VALID_COLLECTIONS.has(c);
}

// ── POST ──────────────────────────────────────────────────────────────────────

interface RememberBody {
  action:     'remember';
  collection: string;
  id:         string;
  text:       string;
  payload?:   Record<string, unknown>;
}

interface RememberManyBody {
  action:     'remember_many';
  collection: string;
  points: Array<{
    id:       string;
    text:     string;
    payload?: Record<string, unknown>;
  }>;
}

interface RecallBody {
  action:      'recall';
  collection:  string;
  query:       string;
  limit?:      number;
  min_score?:  number;
  filter?:     Record<string, unknown>;
}

interface ForgetBody {
  action:     'forget';
  collection: string;
  id:         string;
}

interface GetBody {
  action:     'get';
  collection: string;
  id:         string;
}

type MemoryBody = RememberBody | RememberManyBody | RecallBody | ForgetBody | GetBody;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: MemoryBody;
  try {
    body = (await req.json()) as MemoryBody;
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });
  }

  const { action } = body;

  if (!action) {
    return NextResponse.json({ error: 'action requise' }, { status: 400 });
  }

  if (!isValidCollection(body.collection)) {
    return NextResponse.json({
      error: `collection invalide. Valeurs : ${Object.values(COLLECTIONS).join(', ')}`,
    }, { status: 400 });
  }

  const collection = body.collection;

  try {
    switch (action) {

      case 'remember': {
        const b = body as RememberBody;
        if (!b.id || !b.text) {
          return NextResponse.json({ error: 'id et text sont requis' }, { status: 400 });
        }
        await remember(collection, { id: b.id, text: b.text, payload: b.payload ?? {} });
        return NextResponse.json({ ok: true, id: b.id });
      }

      case 'remember_many': {
        const b = body as RememberManyBody;
        if (!Array.isArray(b.points) || !b.points.length) {
          return NextResponse.json({ error: 'points[] est requis et non vide' }, { status: 400 });
        }
        await rememberMany(
          collection,
          b.points.map(p => ({ id: p.id, text: p.text, payload: p.payload ?? {} })),
        );
        return NextResponse.json({ ok: true, count: b.points.length });
      }

      case 'recall': {
        const b = body as RecallBody;
        if (!b.query) {
          return NextResponse.json({ error: 'query est requise' }, { status: 400 });
        }
        const results = await recall(collection, b.query, {
          limit:    b.limit,
          minScore: b.min_score,
          filter:   b.filter,
        });
        return NextResponse.json({ results });
      }

      case 'forget': {
        const b = body as ForgetBody;
        if (!b.id) {
          return NextResponse.json({ error: 'id est requis' }, { status: 400 });
        }
        await forget(collection, b.id);
        return NextResponse.json({ ok: true, id: b.id });
      }

      case 'get': {
        const b = body as GetBody;
        if (!b.id) {
          return NextResponse.json({ error: 'id est requis' }, { status: 400 });
        }
        const point = await getMemory(collection, b.id);
        if (!point) {
          return NextResponse.json({ error: 'Point non trouvé' }, { status: 404 });
        }
        return NextResponse.json({ point });
      }

      default:
        return NextResponse.json({
          error: `action inconnue. Valeurs : remember, remember_many, recall, forget, get`,
        }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── GET — collections disponibles ─────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  return NextResponse.json({
    collections: Object.entries(COLLECTIONS).map(([key, name]) => ({ key, name })),
    actions: ['remember', 'remember_many', 'recall', 'forget', 'get'],
  });
}

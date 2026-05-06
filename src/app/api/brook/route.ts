import { NextRequest, NextResponse } from 'next/server';
import {
  addDocument, searchKnowledge, getDocument, listDocuments,
  type KnowledgeCategory,
} from '@/lib/agents/brook/knowledge-manager';
import {
  savePromptVersion, getPromptHistory, getActivePrompt, rollback,
} from '@/lib/agents/brook/prompt-archiver';
import {
  getTemplate, saveTemplate, listTemplates,
  type TemplateType,
} from '@/lib/agents/brook/template-manager';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const action = (body['action'] as string) ?? '';

  try {
    switch (action) {

      case 'add_document': {
        const content  = body['content']  as string | undefined;
        const category = body['category'] as KnowledgeCategory | undefined;
        const title    = body['title']    as string | undefined;
        const tags     = (body['tags']    as string[] | undefined) ?? [];

        if (!content || !category || !title) {
          return NextResponse.json({ error: 'content, category et title requis' }, { status: 400 });
        }

        const doc = await addDocument(content, category, title, tags);
        return NextResponse.json({ agent_name: 'BROOK', document: doc });
      }

      case 'search_knowledge': {
        const query    = body['query']    as string | undefined;
        const limit    = (body['limit']   as number | undefined) ?? 5;
        const category = body['category'] as KnowledgeCategory | undefined;

        if (!query) return NextResponse.json({ error: 'query requis' }, { status: 400 });

        const results = await searchKnowledge(query, limit, category);
        return NextResponse.json({ agent_name: 'BROOK', results, count: results.length });
      }

      case 'get_document': {
        const id = body['id'] as string | undefined;
        if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

        const doc = await getDocument(id);
        if (!doc) return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });
        return NextResponse.json({ agent_name: 'BROOK', document: doc });
      }

      case 'list_documents': {
        const category = body['category'] as KnowledgeCategory | undefined;
        const limit    = (body['limit']   as number | undefined) ?? 20;
        const documents = await listDocuments(category, limit);
        return NextResponse.json({ agent_name: 'BROOK', documents, count: documents.length });
      }

      case 'get_template': {
        const type = body['type'] as TemplateType | undefined;
        if (!type) return NextResponse.json({ error: 'type requis' }, { status: 400 });

        const template = await getTemplate(type);
        if (!template) return NextResponse.json({ error: `Template ${type} introuvable` }, { status: 404 });
        return NextResponse.json({ agent_name: 'BROOK', template });
      }

      case 'save_template': {
        const type    = body['type']    as TemplateType | undefined;
        const content = body['content'] as string | undefined;
        const title   = body['title']   as string | undefined;

        if (!type || !content) {
          return NextResponse.json({ error: 'type et content requis' }, { status: 400 });
        }

        const template = await saveTemplate(type, content, title);
        return NextResponse.json({ agent_name: 'BROOK', template });
      }

      case 'list_templates': {
        const templates = await listTemplates();
        return NextResponse.json({ agent_name: 'BROOK', templates, count: templates.length });
      }

      case 'archive_prompt': {
        const agent  = body['agent']  as string | undefined;
        const prompt = body['prompt'] as string | undefined;
        const score  = (body['score'] as number | undefined) ?? 0;

        if (!agent || !prompt) {
          return NextResponse.json({ error: 'agent et prompt requis' }, { status: 400 });
        }

        const pv = await savePromptVersion(agent, prompt, score);
        return NextResponse.json({ agent_name: 'BROOK', prompt_version: pv });
      }

      case 'get_prompt_history': {
        const agent = body['agent'] as string | undefined;
        const limit = (body['limit'] as number | undefined) ?? 10;

        if (!agent) return NextResponse.json({ error: 'agent requis' }, { status: 400 });

        const [history, active] = await Promise.all([
          getPromptHistory(agent, limit),
          getActivePrompt(agent),
        ]);
        return NextResponse.json({ agent_name: 'BROOK', history, active, count: history.length });
      }

      case 'rollback_prompt': {
        const agent   = body['agent']   as string | undefined;
        const version = body['version'] as number | undefined;

        if (!agent || version === undefined) {
          return NextResponse.json({ error: 'agent et version requis' }, { status: 400 });
        }

        const pv = await rollback(agent, version);
        return NextResponse.json({ agent_name: 'BROOK', prompt_version: pv });
      }

      default:
        return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur BROOK inconnue';
    void supabase.from('alerts').insert({
      agent_name: 'BROOK',
      level:      'WARNING',
      message:    `API error action=${action} : ${message.slice(0, 200)}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') ?? 'documents';

  try {
    if (type === 'templates') {
      const templates = await listTemplates();
      return NextResponse.json({ agent_name: 'BROOK', templates, count: templates.length });
    }

    if (type === 'prompts') {
      const agent = searchParams.get('agent');
      if (!agent) return NextResponse.json({ error: 'agent requis' }, { status: 400 });
      const [history, active] = await Promise.all([getPromptHistory(agent), getActivePrompt(agent)]);
      return NextResponse.json({ agent_name: 'BROOK', history, active });
    }

    const category = searchParams.get('category') as KnowledgeCategory | null;
    const limit    = parseInt(searchParams.get('limit') ?? '20', 10);
    const documents = await listDocuments(category ?? undefined, limit);
    return NextResponse.json({ agent_name: 'BROOK', documents, count: documents.length });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur lecture';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

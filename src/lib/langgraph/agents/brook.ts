import { createClient }         from '@supabase/supabase-js';
import {
  addDocument, searchKnowledge, getDocument, listDocuments, ragContext,
  type KnowledgeCategory,
} from '@/lib/agents/brook/knowledge-manager';
import {
  savePromptVersion, getPromptHistory, getActivePrompt, rollback,
} from '@/lib/agents/brook/prompt-archiver';
import {
  getTemplate, saveTemplate, listTemplates,
  type TemplateType,
} from '@/lib/agents/brook/template-manager';
import { brookChain }            from '@/lib/langchain/chains/brook-chain';
import type { KRGlobalStateType } from '../state';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function log(level: string, message: string): Promise<void> {
  await supabase.from('alerts').insert({ agent_name: 'BROOK', level, message });
}

export async function brookNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = state.task_input['action'] as string;

  try {

    // ── search_knowledge ───────────────────────────────────────────────────────
    if (action === 'search_knowledge') {
      const query    = state.task_input['query']    as string | undefined;
      const limit    = (state.task_input['limit']   as number | undefined) ?? 5;
      const category = state.task_input['category'] as KnowledgeCategory | undefined;

      if (!query) throw new Error('query requis pour search_knowledge');

      const results = await searchKnowledge(query, limit, category);
      await log('INFO', `search_knowledge "${query}" → ${results.length} résultats`);

      return {
        agent_name:  'BROOK',
        status:      'completed',
        task_result: { results, count: results.length },
        error:       null,
      };
    }

    // ── add_document ───────────────────────────────────────────────────────────
    if (action === 'add_document') {
      const content  = state.task_input['content']  as string | undefined;
      const category = state.task_input['category'] as KnowledgeCategory | undefined;
      const title    = state.task_input['title']    as string | undefined;
      const tags     = (state.task_input['tags']    as string[] | undefined) ?? [];

      if (!content || !category || !title) throw new Error('content, category et title requis');

      const doc = await addDocument(content, category, title, tags);
      await log('INFO', `add_document : [${category}] "${title}"`);

      return {
        agent_name:  'BROOK',
        status:      'completed',
        task_result: { id: doc.id, title: doc.title, category: doc.category, qdrant_id: doc.qdrant_id },
        error:       null,
      };
    }

    // ── get_document ───────────────────────────────────────────────────────────
    if (action === 'get_document') {
      const id = state.task_input['id'] as string | undefined;
      if (!id) throw new Error('id requis pour get_document');

      const doc = await getDocument(id);
      if (!doc) throw new Error(`Document introuvable : ${id}`);

      return {
        agent_name:  'BROOK',
        status:      'completed',
        task_result: { document: doc },
        error:       null,
      };
    }

    // ── list_documents ─────────────────────────────────────────────────────────
    if (action === 'list_documents') {
      const category = state.task_input['category'] as KnowledgeCategory | undefined;
      const limit    = (state.task_input['limit']   as number | undefined) ?? 20;

      const documents = await listDocuments(category, limit);
      await log('INFO', `list_documents category=${category ?? 'all'} → ${documents.length}`);

      return {
        agent_name:  'BROOK',
        status:      'completed',
        task_result: { documents, count: documents.length },
        error:       null,
      };
    }

    // ── get_template ───────────────────────────────────────────────────────────
    if (action === 'get_template') {
      const type = state.task_input['type'] as TemplateType | undefined;
      if (!type) throw new Error('type requis pour get_template');

      const template = await getTemplate(type);
      if (!template) throw new Error(`Template introuvable : ${type}`);

      return {
        agent_name:  'BROOK',
        status:      'completed',
        task_result: { template },
        error:       null,
      };
    }

    // ── save_template ──────────────────────────────────────────────────────────
    if (action === 'save_template') {
      const type    = state.task_input['type']    as TemplateType | undefined;
      const content = state.task_input['content'] as string | undefined;
      const title   = state.task_input['title']   as string | undefined;

      if (!type || !content) throw new Error('type et content requis pour save_template');

      const template = await saveTemplate(type, content, title);
      await log('INFO', `save_template : ${type} v${template.version}`);

      return {
        agent_name:  'BROOK',
        status:      'completed',
        task_result: { id: template.id, type, version: template.version },
        error:       null,
      };
    }

    // ── list_templates ─────────────────────────────────────────────────────────
    if (action === 'list_templates') {
      const templates = await listTemplates();

      return {
        agent_name:  'BROOK',
        status:      'completed',
        task_result: { templates, count: templates.length },
        error:       null,
      };
    }

    // ── archive_prompt ─────────────────────────────────────────────────────────
    if (action === 'archive_prompt') {
      const agent  = state.task_input['agent']  as string | undefined;
      const prompt = state.task_input['prompt'] as string | undefined;
      const score  = (state.task_input['score'] as number | undefined) ?? 0;

      if (!agent || !prompt) throw new Error('agent et prompt requis pour archive_prompt');

      const pv = await savePromptVersion(agent, prompt, score);
      await log('INFO', `archive_prompt : ${agent} v${pv.version}`);

      return {
        agent_name:  'BROOK',
        status:      'completed',
        task_result: { id: pv.id, agent, version: pv.version, score: pv.performance_score },
        error:       null,
      };
    }

    // ── get_prompt_history ─────────────────────────────────────────────────────
    if (action === 'get_prompt_history') {
      const agent = state.task_input['agent'] as string | undefined;
      const limit = (state.task_input['limit'] as number | undefined) ?? 10;

      if (!agent) throw new Error('agent requis pour get_prompt_history');

      const history = await getPromptHistory(agent, limit);
      const active  = await getActivePrompt(agent);

      return {
        agent_name:  'BROOK',
        status:      'completed',
        task_result: { history, active, count: history.length },
        error:       null,
      };
    }

    // ── rollback_prompt ────────────────────────────────────────────────────────
    if (action === 'rollback_prompt') {
      const agent   = state.task_input['agent']   as string | undefined;
      const version = state.task_input['version'] as number | undefined;

      if (!agent || version === undefined) throw new Error('agent et version requis pour rollback_prompt');

      const pv = await rollback(agent, version);
      await log('INFO', `rollback_prompt : ${agent} → v${version}`);

      return {
        agent_name:  'BROOK',
        status:      'completed',
        task_result: { id: pv.id, agent, version: pv.version, is_active: pv.is_active },
        error:       null,
      };
    }

    // ── answer_question ────────────────────────────────────────────────────────
    if (action === 'answer_question') {
      const question = state.task_input['question'] as string | undefined;
      if (!question) throw new Error('question requise pour answer_question');

      const context = await ragContext(question, 4);

      const answer = await brookChain.invoke({
        input:   question,
        context: context ? `Contexte base de connaissance KR Global :\n\n${context}` : '',
      });

      await log('INFO', `answer_question : "${question.slice(0, 80)}" → ${context ? 'RAG' : 'no context'}`);

      return {
        agent_name:  'BROOK',
        status:      'completed',
        task_result: { question, answer, sources_found: context.length > 0 },
        error:       null,
      };
    }

    // ── weekly_index ───────────────────────────────────────────────────────────
    if (action === 'weekly_index') {
      const docs = await listDocuments(undefined, 100);
      await log('INFO', `weekly_index : ${docs.length} documents indexés dans Qdrant kr_knowledge`);

      return {
        agent_name:  'BROOK',
        status:      'completed',
        task_result: { indexed: docs.length, message: 'Index hebdomadaire complété' },
        error:       null,
      };
    }

    throw new Error(`Action inconnue : ${action}`);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log('WARNING', `Erreur BROOK action=${action} : ${message}`);

    return {
      agent_name: 'BROOK',
      status:     'failed',
      error:      message,
    };
  }
}

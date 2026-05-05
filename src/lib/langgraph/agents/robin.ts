import { createClient }        from '@supabase/supabase-js';
import { researchTopic, scrapeReddit, researchAITrends } from '@/lib/agents/robin/web-researcher';
import { trackCompetitors, compareWithKRGlobal }         from '@/lib/agents/robin/competitor-tracker';
import { addKnowledge, searchKnowledge, indexResearchResults } from '@/lib/agents/robin/knowledge-builder';
import { generateIntelReport }  from '@/lib/agents/robin/report-generator';
import type { KRGlobalStateType } from '../state';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function log(level: string, message: string): Promise<void> {
  await supabase.from('alerts').insert({ agent_name: 'ROBIN', level, message });
}

export async function robinNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = state.task_input['action'] as string;

  try {
    // ── research_topic ─────────────────────────────────────────────────────────
    if (action === 'research_topic') {
      const query      = (state.task_input['query']      as string | undefined) ?? 'AI agency UK 2025';
      const subreddit  = state.task_input['subreddit']   as string | undefined;
      const indexKnow  = state.task_input['index']       !== false;

      const results = subreddit
        ? await scrapeReddit(subreddit)
        : await researchTopic(query);

      if (indexKnow && results.length > 0) {
        await indexResearchResults(
          results.map(r => ({ title: r.title, snippet: r.snippet, url: r.url, source: r.source })),
          query,
        );
      }

      await log('INFO', `research_topic "${query}" : ${results.length} résultats`);

      return {
        agent_name:  'ROBIN',
        status:      'completed',
        task_result: { results: results.slice(0, 10), count: results.length },
        error:       null,
      };
    }

    // ── track_competitors ──────────────────────────────────────────────────────
    if (action === 'track_competitors') {
      const intel    = await trackCompetitors();
      const analysis = compareWithKRGlobal(intel);

      return {
        agent_name:  'ROBIN',
        status:      'completed',
        task_result: {
          competitors: intel.map(c => ({
            name:        c.competitor.name,
            website:     c.competitor.website,
            pages_found: c.pages_found,
            offers:      c.key_offers.slice(0, 3),
          })),
          analysis,
        },
        error: null,
      };
    }

    // ── build_knowledge ────────────────────────────────────────────────────────
    if (action === 'build_knowledge') {
      const content = state.task_input['content'] as string | undefined;
      const source  = (state.task_input['source']  as string | undefined) ?? 'manual';
      const topic   = (state.task_input['topic']   as string | undefined) ?? 'general';
      const tags    = (state.task_input['tags']    as string[] | undefined) ?? [];

      if (!content) throw new Error('content requis pour build_knowledge');

      const id = await addKnowledge(content, source, topic, tags);
      await log('INFO', `build_knowledge : entrée indexée id=${id} source=${source}`);

      return {
        agent_name:  'ROBIN',
        status:      'completed',
        task_result: { id, source, topic },
        error:       null,
      };
    }

    // ── search_knowledge ───────────────────────────────────────────────────────
    if (action === 'search_knowledge') {
      const query = state.task_input['query'] as string | undefined;
      const limit = (state.task_input['limit'] as number | undefined) ?? 5;

      if (!query) throw new Error('query requis pour search_knowledge');

      const results = await searchKnowledge(query, limit);
      await log('INFO', `search_knowledge "${query}" : ${results.length} résultats Qdrant`);

      return {
        agent_name:  'ROBIN',
        status:      'completed',
        task_result: { results, count: results.length },
        error:       null,
      };
    }

    // ── generate_report ────────────────────────────────────────────────────────
    if (action === 'generate_report') {
      const report = await generateIntelReport();

      return {
        agent_name:  'ROBIN',
        status:      'completed',
        task_result: {
          week:                 report.week,
          trends_count:         report.trends_count,
          competitors_analyzed: report.competitors_analyzed,
          knowledge_indexed:    report.knowledge_indexed,
          narrative:            report.narrative,
          slack_sent:           report.slack_sent,
        },
        error: null,
      };
    }

    // ── research_ai_trends ─────────────────────────────────────────────────────
    if (action === 'research_ai_trends') {
      const results  = await researchAITrends();
      const indexed  = await indexResearchResults(
        results.map(r => ({ title: r.title, snippet: r.snippet, url: r.url, source: r.source })),
        'ai_trends',
      );

      return {
        agent_name:  'ROBIN',
        status:      'completed',
        task_result: { count: results.length, indexed, sources: [...new Set(results.map(r => r.source.split('/')[0]))] },
        error:       null,
      };
    }

    throw new Error(`Action inconnue : ${action}`);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log('WARNING', `Erreur ROBIN action=${action} : ${message}`);

    return {
      agent_name: 'ROBIN',
      status:     'failed',
      error:      message,
    };
  }
}

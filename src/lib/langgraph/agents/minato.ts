import { createClient }            from '@supabase/supabase-js';
import {
  analyzeAgent, analyzeAllAgents, getFailurePatterns,
  generateRecommendations, type Period,
} from '@/lib/agents/minato/performance-analyzer';
import {
  optimizePrompt, generateVariants, getOptimizations, applyOptimization,
} from '@/lib/agents/minato/prompt-optimizer';
import { runABTest, getABTests } from '@/lib/agents/minato/ab-tester';
import { minatoChain }            from '@/lib/langchain/chains/minato-chain';
import type { KRGlobalStateType }  from '../state';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function log(level: string, message: string): Promise<void> {
  await supabase.from('alerts').insert({ agent_name: 'MINATO', level, message });
}

export async function minatoNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = state.task_input['action'] as string;

  try {

    // ── analyze_performance ────────────────────────────────────────────────────
    if (action === 'analyze_performance') {
      const agentName = state.task_input['agent_name'] as string | undefined;
      const period    = (state.task_input['period'] as Period | undefined) ?? 'week';

      if (agentName) {
        const metrics = await analyzeAgent(agentName, period);
        const recs    = generateRecommendations([metrics]);
        await log('INFO', `analyze_performance : ${agentName} — taux succès ${Math.round(metrics.success_rate * 100)}%`);

        return {
          agent_name:  'MINATO',
          status:      'completed',
          task_result: { metrics, recommendations: recs },
          error:       null,
        };
      }

      // Analyse tous les agents
      const allMetrics = await analyzeAllAgents(period);
      const allRecs    = generateRecommendations(allMetrics);
      await log('INFO', `analyze_performance : ${allMetrics.length} agents analysés — ${allRecs.length} recommandations`);

      return {
        agent_name:  'MINATO',
        status:      'completed',
        task_result: {
          agents:          allMetrics.length,
          metrics:         allMetrics,
          recommendations: allRecs,
          high_priority:   allRecs.filter(r => r.priority === 'high').length,
        },
        error: null,
      };
    }

    // ── get_recommendations ────────────────────────────────────────────────────
    if (action === 'get_recommendations') {
      const period = (state.task_input['period'] as Period | undefined) ?? 'week';

      const allMetrics = await analyzeAllAgents(period);
      const recs       = generateRecommendations(allMetrics);

      return {
        agent_name:  'MINATO',
        status:      'completed',
        task_result: { recommendations: recs, count: recs.length },
        error:       null,
      };
    }

    // ── optimize_prompt ────────────────────────────────────────────────────────
    if (action === 'optimize_prompt') {
      const agentName    = state.task_input['agent_name']    as string | undefined;
      const currentPrompt = state.task_input['current_prompt'] as string | undefined;

      if (!agentName || !currentPrompt) throw new Error('agent_name et current_prompt requis');

      const failures = await getFailurePatterns(agentName);
      const result   = await optimizePrompt(agentName, currentPrompt, failures);

      // Archive dans BROOK via Supabase directement (pas de fetch interne)
      await supabase.from('knowledge_documents').insert({
        agent_name: 'BROOK',
        title:      `Prompt optimisé ${agentName} — ${new Date().toISOString().slice(0, 10)}`,
        content:    result.optimized_prompt,
        category:   'prompts',
        tags:       [agentName.toLowerCase(), 'optimisation', 'minato'],
      });

      await log('INFO', `optimize_prompt : ${agentName} — score ${result.improvement_score}`);

      return {
        agent_name:  'MINATO',
        status:      'completed',
        task_result: {
          optimization_id:   result.id,
          agent_name:        agentName,
          improvement_score: result.improvement_score,
          failure_patterns:  failures.length,
          brook_archived:    true,
        },
        error: null,
      };
    }

    // ── run_ab_test ────────────────────────────────────────────────────────────
    if (action === 'run_ab_test') {
      const agentName = state.task_input['agent_name'] as string | undefined;
      const promptA   = state.task_input['prompt_a']   as string | undefined;
      const promptB   = state.task_input['prompt_b']   as string | undefined;
      const testInputs = state.task_input['test_inputs'] as string[] | undefined;

      if (!agentName || !promptA || !promptB) throw new Error('agent_name, prompt_a et prompt_b requis');

      const result = await runABTest(agentName, promptA, promptB, testInputs);
      await log('INFO', `run_ab_test : ${agentName} — gagnant Prompt ${result.winner ?? '(ex-aequo)'}`);

      return {
        agent_name:  'MINATO',
        status:      'completed',
        task_result: {
          test_id:    result.id,
          agent_name: agentName,
          winner:     result.winner,
          score_a:    result.score_a,
          score_b:    result.score_b,
        },
        error: null,
      };
    }

    // ── apply_optimization ─────────────────────────────────────────────────────
    if (action === 'apply_optimization') {
      const optimizationId = state.task_input['optimization_id'] as string | undefined;
      if (!optimizationId) throw new Error('optimization_id requis');

      await applyOptimization(optimizationId);
      await log('INFO', `apply_optimization : ${optimizationId}`);

      return {
        agent_name:  'MINATO',
        status:      'completed',
        task_result: { applied: true, optimization_id: optimizationId },
        error:       null,
      };
    }

    // ── generate_variants ──────────────────────────────────────────────────────
    if (action === 'generate_variants') {
      const agentName = state.task_input['agent_name'] as string | undefined;
      const prompt    = state.task_input['prompt']     as string | undefined;
      const count     = (state.task_input['count']     as number | undefined) ?? 3;

      if (!agentName || !prompt) throw new Error('agent_name et prompt requis');

      const variants = await generateVariants(prompt, count, agentName);
      await log('INFO', `generate_variants : ${agentName} — ${variants.length} variante(s)`);

      return {
        agent_name:  'MINATO',
        status:      'completed',
        task_result: { agent_name: agentName, variants, count: variants.length },
        error:       null,
      };
    }

    // ── get_optimizations ──────────────────────────────────────────────────────
    if (action === 'get_optimizations') {
      const agentName  = state.task_input['agent_name'] as string | undefined;
      const onlyApplied = (state.task_input['applied'] as boolean | undefined) ?? false;

      const optimizations = await getOptimizations(agentName, onlyApplied);
      const tests         = await getABTests(agentName, true);

      return {
        agent_name:  'MINATO',
        status:      'completed',
        task_result: {
          optimizations,
          ab_tests: tests,
          count: optimizations.length,
        },
        error: null,
      };
    }

    // ── ask_minato ─────────────────────────────────────────────────────────────
    if (action === 'ask_minato') {
      const question = state.task_input['question'] as string | undefined;
      if (!question) throw new Error('question requise');

      const answer = await minatoChain.invoke({ input: question, context: '' });

      return {
        agent_name:  'MINATO',
        status:      'completed',
        task_result: { question, answer },
        error:       null,
      };
    }

    throw new Error(`Action inconnue : ${action}`);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log('WARNING', `Erreur MINATO action=${action} : ${message}`);

    return {
      agent_name: 'MINATO',
      status:     'failed',
      error:      message,
    };
  }
}

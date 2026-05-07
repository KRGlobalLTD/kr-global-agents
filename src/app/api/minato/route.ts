import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeAgent, analyzeAllAgents, generateRecommendations,
  type Period,
} from '@/lib/agents/minato/performance-analyzer';
import {
  optimizePrompt, generateVariants, getOptimizations, applyOptimization,
} from '@/lib/agents/minato/prompt-optimizer';
import { runABTest, getABTests } from '@/lib/agents/minato/ab-tester';
import { getFailurePatterns }     from '@/lib/agents/minato/performance-analyzer';
import { createClient }           from '@supabase/supabase-js';

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

      case 'analyze_performance': {
        const agentName = body['agent_name'] as string | undefined;
        const period    = (body['period'] as Period | undefined) ?? 'week';

        if (agentName) {
          const metrics = await analyzeAgent(agentName, period);
          const recs    = generateRecommendations([metrics]);
          return NextResponse.json({ agent_name: 'MINATO', metrics, recommendations: recs });
        }

        const all  = await analyzeAllAgents(period);
        const recs = generateRecommendations(all);
        return NextResponse.json({ agent_name: 'MINATO', metrics: all, recommendations: recs, count: all.length });
      }

      case 'get_recommendations': {
        const period = (body['period'] as Period | undefined) ?? 'week';
        const all    = await analyzeAllAgents(period);
        const recs   = generateRecommendations(all);
        return NextResponse.json({ agent_name: 'MINATO', recommendations: recs, count: recs.length });
      }

      case 'optimize_prompt': {
        const agentName     = body['agent_name']     as string | undefined;
        const currentPrompt = body['current_prompt'] as string | undefined;
        if (!agentName || !currentPrompt) {
          return NextResponse.json({ error: 'agent_name et current_prompt requis' }, { status: 400 });
        }
        const failures = await getFailurePatterns(agentName);
        const result   = await optimizePrompt(agentName, currentPrompt, failures);

        // Archive dans BROOK
        await supabase.from('knowledge_documents').insert({
          agent_name: 'BROOK',
          title:      `Prompt optimisé ${agentName} — ${new Date().toISOString().slice(0, 10)}`,
          content:    result.optimized_prompt,
          category:   'prompts',
          tags:       [agentName.toLowerCase(), 'optimisation', 'minato'],
        });

        return NextResponse.json({ agent_name: 'MINATO', optimization: result, brook_archived: true });
      }

      case 'generate_variants': {
        const agentName = body['agent_name'] as string | undefined;
        const prompt    = body['prompt']     as string | undefined;
        const count     = (body['count']     as number | undefined) ?? 3;
        if (!agentName || !prompt) {
          return NextResponse.json({ error: 'agent_name et prompt requis' }, { status: 400 });
        }
        const variants = await generateVariants(prompt, count, agentName);
        return NextResponse.json({ agent_name: 'MINATO', variants, count: variants.length });
      }

      case 'run_ab_test': {
        const agentName  = body['agent_name']  as string | undefined;
        const promptA    = body['prompt_a']    as string | undefined;
        const promptB    = body['prompt_b']    as string | undefined;
        const testInputs = body['test_inputs'] as string[] | undefined;
        if (!agentName || !promptA || !promptB) {
          return NextResponse.json({ error: 'agent_name, prompt_a et prompt_b requis' }, { status: 400 });
        }
        const result = await runABTest(agentName, promptA, promptB, testInputs);
        return NextResponse.json({ agent_name: 'MINATO', ab_test: result });
      }

      case 'apply_optimization': {
        const optimizationId = body['optimization_id'] as string | undefined;
        if (!optimizationId) {
          return NextResponse.json({ error: 'optimization_id requis' }, { status: 400 });
        }
        await applyOptimization(optimizationId);
        return NextResponse.json({ agent_name: 'MINATO', applied: true, optimization_id: optimizationId });
      }

      case 'get_optimizations': {
        const agentName   = body['agent_name'] as string | undefined;
        const onlyApplied = (body['applied']   as boolean | undefined) ?? false;
        const [opts, tests] = await Promise.all([
          getOptimizations(agentName, onlyApplied),
          getABTests(agentName, true),
        ]);
        return NextResponse.json({ agent_name: 'MINATO', optimizations: opts, ab_tests: tests });
      }

      default:
        return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur MINATO inconnue';
    void supabase.from('alerts').insert({
      agent_name: 'MINATO',
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
  const type      = searchParams.get('type') ?? 'recommendations';
  const agentName = searchParams.get('agent') ?? undefined;
  const period    = (searchParams.get('period') as Period | null) ?? 'week';

  try {
    if (type === 'optimizations') {
      const [opts, tests] = await Promise.all([
        getOptimizations(agentName),
        getABTests(agentName, true),
      ]);
      return NextResponse.json({ agent_name: 'MINATO', optimizations: opts, ab_tests: tests });
    }

    if (type === 'metrics') {
      const metrics = agentName
        ? [await analyzeAgent(agentName, period)]
        : await analyzeAllAgents(period);
      return NextResponse.json({ agent_name: 'MINATO', metrics, count: metrics.length });
    }

    const all  = await analyzeAllAgents(period);
    const recs = generateRecommendations(all);
    return NextResponse.json({ agent_name: 'MINATO', recommendations: recs, count: recs.length });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur lecture';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runGraph, type TaskType } from '@/lib/langgraph/supervisor';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

interface AgentRequestBody {
  task_type:  TaskType;
  task_input: Record<string, unknown>;
  metadata?:  Record<string, unknown>;
}

const VALID_TASK_TYPES = new Set<TaskType>([
  'accounting', 'marketing', 'email', 'prospecting', 'onboarding', 'finance', 'supervisor', 'reporting', 'infrastructure', 'social', 'research', 'support',
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: AgentRequestBody;
  try {
    body = (await req.json()) as AgentRequestBody;
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });
  }

  const { task_type, task_input = {}, metadata = {} } = body;

  if (!task_type || !VALID_TASK_TYPES.has(task_type)) {
    return NextResponse.json(
      { error: `task_type invalide. Valeurs acceptées : ${[...VALID_TASK_TYPES].join(', ')}` },
      { status: 400 },
    );
  }

  // Pré-log dans agent_tasks (status = running)
  const startedAt = new Date().toISOString();
  const { data: taskRow } = await supabase
    .from('agent_tasks')
    .insert({
      task_type,
      task_input,
      metadata,
      status:     'running',
      started_at: startedAt,
    })
    .select('id')
    .single();

  const taskId = (taskRow as { id: string } | null)?.id ?? null;

  try {
    const result = await runGraph(task_type, task_input, metadata);

    // Post-log : mise à jour avec le résultat
    if (taskId) {
      await supabase
        .from('agent_tasks')
        .update({
          agent_name:   result.agent_name,
          status:       result.status,
          task_result:  result.task_result,
          error:        result.error,
          completed_at: new Date().toISOString(),
        })
        .eq('id', taskId);
    }

    return NextResponse.json({
      task_id:    taskId,
      agent_name: result.agent_name,
      status:     result.status,
      task_result: result.task_result,
      error:      result.error ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';

    if (taskId) {
      await supabase
        .from('agent_tasks')
        .update({
          status:       'failed',
          error:        message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', taskId);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — liste les dernières tâches exécutées
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit     = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
  const taskType  = searchParams.get('task_type') as TaskType | null;
  const agentName = searchParams.get('agent_name');

  let query = supabase
    .from('agent_tasks')
    .select('id, task_type, agent_name, status, task_result, error, started_at, completed_at')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (taskType)  query = query.eq('task_type',  taskType);
  if (agentName) query = query.eq('agent_name', agentName);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tasks: data ?? [] });
}

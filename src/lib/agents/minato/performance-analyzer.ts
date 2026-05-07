import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type Period = 'day' | 'week' | 'month';

export interface AgentMetrics {
  agent_name:      string;
  period:          Period;
  total_tasks:     number;
  completed:       number;
  failed:          number;
  success_rate:    number;
  avg_duration_ms: number;
  failure_patterns: FailurePattern[];
}

export interface FailurePattern {
  action:    string;
  count:     number;
  sample_error: string;
}

export interface Recommendation {
  agent_name:  string;
  priority:    'high' | 'medium' | 'low';
  issue:       string;
  suggestion:  string;
}

// ── Analyse les performances d'un agent sur une période ───────────────────────

export async function analyzeAgent(
  agentName: string,
  period:    Period = 'week',
): Promise<AgentMetrics> {
  const since = periodToDate(period);

  const { data, error } = await supabase
    .from('agent_tasks')
    .select('status, task_input, error, created_at, completed_at')
    .eq('agent_name', agentName.toUpperCase())
    .gte('created_at', since.toISOString());

  if (error) throw new Error(`agent_tasks query: ${error.message}`);

  const tasks = data ?? [];
  const completed = tasks.filter(t => t.status === 'completed').length;
  const failed    = tasks.filter(t => t.status === 'failed').length;
  const total     = tasks.length;

  const durations = tasks
    .filter(t => t.completed_at && t.created_at)
    .map(t => new Date(t.completed_at as string).getTime() - new Date(t.created_at as string).getTime())
    .filter(d => d > 0);

  const avg_duration_ms = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  const failure_patterns = getFailurePatternsFromTasks(
    tasks.filter(t => t.status === 'failed'),
  );

  return {
    agent_name:      agentName.toUpperCase(),
    period,
    total_tasks:     total,
    completed,
    failed,
    success_rate:    total ? Math.round((completed / total) * 100) / 100 : 1,
    avg_duration_ms,
    failure_patterns,
  };
}

// ── Récupère les patterns d'échec pour un agent ───────────────────────────────

export async function getFailurePatterns(
  agentName: string,
  limit = 20,
): Promise<FailurePattern[]> {
  const since = periodToDate('month');

  const { data, error } = await supabase
    .from('agent_tasks')
    .select('task_input, error')
    .eq('agent_name', agentName.toUpperCase())
    .eq('status', 'failed')
    .gte('created_at', since.toISOString())
    .limit(limit);

  if (error) throw new Error(`getFailurePatterns: ${error.message}`);

  return getFailurePatternsFromTasks(data ?? []);
}

// ── Analyse tous les agents et génère des recommandations ─────────────────────

export async function analyzeAllAgents(period: Period = 'week'): Promise<AgentMetrics[]> {
  const { data } = await supabase
    .from('agent_tasks')
    .select('agent_name')
    .gte('created_at', periodToDate(period).toISOString());

  const agents = [...new Set((data ?? []).map(r => r.agent_name as string))].filter(Boolean);

  const results = await Promise.allSettled(
    agents.map(name => analyzeAgent(name, period)),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<AgentMetrics> => r.status === 'fulfilled')
    .map(r => r.value);
}

// ── Génère des recommandations d'amélioration ─────────────────────────────────

export function generateRecommendations(metrics: AgentMetrics[]): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const m of metrics) {
    if (m.success_rate < 0.7 && m.total_tasks >= 5) {
      recs.push({
        agent_name: m.agent_name,
        priority:   'high',
        issue:      `Taux d'échec élevé : ${Math.round((1 - m.success_rate) * 100)}% sur ${m.total_tasks} tâches`,
        suggestion: `Optimiser le prompt ${m.agent_name} — ${m.failure_patterns.length} pattern(s) d'échec identifiés`,
      });
    } else if (m.success_rate < 0.85 && m.total_tasks >= 5) {
      recs.push({
        agent_name: m.agent_name,
        priority:   'medium',
        issue:      `Performance sous-optimale : ${Math.round(m.success_rate * 100)}% de succès`,
        suggestion: `Test A/B recommandé pour ${m.agent_name}`,
      });
    }

    if (m.avg_duration_ms > 30_000 && m.total_tasks >= 3) {
      recs.push({
        agent_name: m.agent_name,
        priority:   'low',
        issue:      `Latence élevée : ${Math.round(m.avg_duration_ms / 1000)}s en moyenne`,
        suggestion: `Simplifier les instructions ou réduire le contexte du prompt ${m.agent_name}`,
      });
    }
  }

  return recs.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function periodToDate(period: Period): Date {
  const now = new Date();
  switch (period) {
    case 'day':   return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case 'week':  return new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
    case 'month': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}

function getFailurePatternsFromTasks(
  tasks: Array<{ task_input?: unknown; error?: unknown }>,
): FailurePattern[] {
  const map = new Map<string, { count: number; sample_error: string }>();

  for (const t of tasks) {
    const input  = t.task_input as Record<string, unknown> | null;
    const action = (input?.['action'] as string) ?? 'unknown';
    const err    = String(t.error ?? '').slice(0, 200);

    const existing = map.get(action);
    if (existing) {
      existing.count++;
    } else {
      map.set(action, { count: 1, sample_error: err });
    }
  }

  return Array.from(map.entries())
    .map(([action, v]) => ({ action, count: v.count, sample_error: v.sample_error }))
    .sort((a, b) => b.count - a.count);
}

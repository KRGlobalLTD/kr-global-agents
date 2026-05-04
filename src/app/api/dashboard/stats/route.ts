import { NextResponse } from 'next/server';
import { createClient }  from '@supabase/supabase-js';
import { qdrant }        from '@/lib/qdrant/client';
import { COLLECTIONS }   from '@/lib/qdrant/collections';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentStat {
  name:        string;
  lastRun:     string | null;
  taskCount:   number;
  successCount: number;
  successRate: number;
  lastError:   string | null;
  status:      'active' | 'idle' | 'error';
}

export interface RecentTask {
  id:           string;
  agent_name:   string;
  task_type:    string;
  status:       string;
  error:        string | null;
  started_at:   string;
  completed_at: string | null;
  duration_ms:  number | null;
}

export interface N8nWorkflow {
  id:        string;
  name:      string;
  active:    boolean;
  updatedAt: string;
}

export interface QdrantCollection {
  name:        string;
  vectorCount: number;
}

export interface DashboardStats {
  agents:      Record<string, AgentStat>;
  metrics: {
    totalTasksToday: number;
    successRate:     number;
    aiCostToday:     number;
    activeAgents:    number;
    totalAgents:     number;
  };
  recentTasks:  RecentTask[];
  n8n:          N8nWorkflow[];
  qdrant:       QdrantCollection[];
  generatedAt:  string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchAgentStats(): Promise<Record<string, AgentStat>> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from('agent_tasks')
    .select('agent_name, status, error, started_at, completed_at')
    .gte('started_at', todayStart.toISOString())
    .order('started_at', { ascending: false });

  const rows = (data ?? []) as {
    agent_name:   string;
    status:       string;
    error:        string | null;
    started_at:   string;
    completed_at: string | null;
  }[];

  const byAgent = new Map<string, {
    tasks:   typeof rows;
    lastRun: string | null;
  }>();

  for (const row of rows) {
    const name = row.agent_name;
    if (!byAgent.has(name)) byAgent.set(name, { tasks: [], lastRun: null });
    const entry = byAgent.get(name)!;
    entry.tasks.push(row);
    if (!entry.lastRun || row.started_at > entry.lastRun) entry.lastRun = row.started_at;
  }

  const result: Record<string, AgentStat> = {};
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  for (const [name, entry] of byAgent) {
    const total    = entry.tasks.length;
    const success  = entry.tasks.filter(t => t.status === 'completed').length;
    const lastErr  = entry.tasks.find(t => t.status === 'failed')?.error ?? null;
    const hasRunning = entry.tasks.some(t => t.status === 'running');
    const hasRecent  = entry.lastRun ? entry.lastRun > fiveMinutesAgo : false;

    result[name] = {
      name,
      lastRun:      entry.lastRun,
      taskCount:    total,
      successCount: success,
      successRate:  total > 0 ? Math.round((success / total) * 100) : 100,
      lastError:    lastErr,
      status:       hasRunning || hasRecent ? 'active'
                  : lastErr                 ? 'error'
                  :                          'idle',
    };
  }

  return result;
}

async function fetchRecentTasks(): Promise<RecentTask[]> {
  const { data } = await supabase
    .from('agent_tasks')
    .select('id, agent_name, task_type, status, error, started_at, completed_at')
    .order('started_at', { ascending: false })
    .limit(20);

  return ((data ?? []) as Array<{
    id: string; agent_name: string; task_type: string; status: string;
    error: string | null; started_at: string; completed_at: string | null;
  }>).map(row => ({
    ...row,
    duration_ms: row.completed_at
      ? new Date(row.completed_at).getTime() - new Date(row.started_at).getTime()
      : null,
  }));
}

async function fetchAiCostToday(): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from('couts_par_entite')
    .select('montant_eur')
    .gte('created_at', todayStart.toISOString());

  return ((data ?? []) as { montant_eur: number }[])
    .reduce((sum, r) => sum + (r.montant_eur ?? 0), 0);
}

async function fetchN8nWorkflows(): Promise<N8nWorkflow[]> {
  const N8N_URL = (process.env.N8N_URL ?? 'https://primary-production-fbc07.up.railway.app').replace(/\/$/, '');
  const N8N_API_KEY = process.env.N8N_API_KEY ?? '';

  if (!N8N_API_KEY) return [];

  try {
    const res = await fetch(`${N8N_URL}/api/v1/workflows?limit=50`, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY },
      next:    { revalidate: 60 },
    });

    if (!res.ok) return [];

    const json = (await res.json()) as {
      data: Array<{ id: string; name: string; active: boolean; updatedAt: string }>;
    };

    return (json.data ?? []).map(w => ({
      id:        w.id,
      name:      w.name,
      active:    w.active,
      updatedAt: w.updatedAt,
    }));
  } catch {
    return [];
  }
}

interface QdrantCollectionResponse {
  result: { vectors_count?: number };
}

async function fetchQdrantStats(): Promise<QdrantCollection[]> {
  const names = Object.values(COLLECTIONS);
  const results: QdrantCollection[] = [];

  for (const name of names) {
    try {
      const res = await qdrant<QdrantCollectionResponse>('GET', `/collections/${name}`);
      results.push({ name, vectorCount: res.result.vectors_count ?? 0 });
    } catch {
      results.push({ name, vectorCount: -1 });
    }
  }

  return results;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  try {
    const [agents, recentTasks, aiCostToday, n8n, qdrantStats] = await Promise.all([
      fetchAgentStats(),
      fetchRecentTasks(),
      fetchAiCostToday(),
      fetchN8nWorkflows(),
      fetchQdrantStats(),
    ]);

    const totalTasks   = Object.values(agents).reduce((s, a) => s + a.taskCount, 0);
    const totalSuccess = Object.values(agents).reduce((s, a) => s + a.successCount, 0);
    const activeAgents = Object.values(agents).filter(a => a.status === 'active').length;

    const stats: DashboardStats = {
      agents,
      metrics: {
        totalTasksToday: totalTasks,
        successRate:     totalTasks > 0 ? Math.round((totalSuccess / totalTasks) * 100) : 100,
        aiCostToday:     Math.round(aiCostToday * 10000) / 10000,
        activeAgents,
        totalAgents:     Object.keys(agents).length,
      },
      recentTasks,
      n8n,
      qdrant: qdrantStats,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur stats';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

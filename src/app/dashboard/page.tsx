'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentCard }    from './components/AgentCard';
import { MetricsBar }   from './components/MetricsBar';
import { ActivityFeed } from './components/ActivityFeed';
import { QdrantStatus } from './components/QdrantStatus';
import { N8nStatus }    from './components/N8nStatus';
import type { DashboardStats } from '@/app/api/dashboard/stats/route';

const REFRESH_INTERVAL = 30_000;

function GlobalStatus({ stats }: { stats: DashboardStats }) {
  const { activeAgents, totalAgents, successRate } = stats.metrics;
  const health = successRate >= 90 && activeAgents >= 0
    ? 'OPERATIONAL'
    : successRate >= 70
    ? 'DEGRADED'
    : 'INCIDENT';

  const config = {
    OPERATIONAL: { color: '#34d399', bg: 'rgba(52,211,153,0.1)',  label: 'Opérationnel' },
    DEGRADED:    { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  label: 'Dégradé'      },
    INCIDENT:    { color: '#f87171', bg: 'rgba(248,113,113,0.1)', label: 'Incident'     },
  }[health];

  return (
    <span
      className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
      style={{ color: config.color, background: config.bg }}
    >
      <span className="relative flex h-1.5 w-1.5">
        {health === 'OPERATIONAL' && (
          <span className="absolute inline-flex h-full w-full rounded-full animate-ping"
            style={{ background: config.color, opacity: 0.6 }} />
        )}
        <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: config.color }} />
      </span>
      {config.label}
    </span>
  );
}

function Countdown({ next }: { next: number }) {
  const [secs, setSecs] = useState(Math.round((next - Date.now()) / 1000));

  useEffect(() => {
    const id = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [next]);

  return (
    <span className="text-[10px] text-slate-600 font-mono tabular-nums">
      Refresh {secs}s
    </span>
  );
}

export default function DashboardPage() {
  const [stats, setStats]       = useState<DashboardStats | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [nextRefresh, setNextRefresh] = useState(Date.now() + REFRESH_INTERVAL);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/stats', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DashboardStats;
      setStats(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();

    timerRef.current = setInterval(() => {
      setNextRefresh(Date.now() + REFRESH_INTERVAL);
      void fetchStats();
    }, REFRESH_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchStats]);

  const agents = stats ? Object.values(stats.agents) : [];

  return (
    <div className="px-6 py-6 flex flex-col gap-8 max-w-7xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Mission Control</h1>
          <p className="text-sm text-slate-500 mt-0.5">KR Global Solutions Ltd — Dashboard temps réel</p>
        </div>
        <div className="flex items-center gap-3">
          {stats && <Countdown next={nextRefresh} />}
          {stats && <GlobalStatus stats={stats} />}
          <button
            onClick={() => void fetchStats()}
            className="text-xs px-3 py-1.5 rounded-lg border font-medium transition-all hover:border-[#7c3aed]/50 hover:text-white"
            style={{ borderColor: 'rgba(255,255,255,0.1)', color: '#64748b' }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Loading / Error ── */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-3">
            <div
              className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: '#7c3aed', borderTopColor: 'transparent' }}
            />
            <span className="text-sm text-slate-500">Chargement des données…</span>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border px-5 py-4 text-sm"
          style={{ borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.06)', color: '#f87171' }}>
          ❌ {error}
        </div>
      )}

      {stats && !loading && (
        <>
          {/* ── Métriques ── */}
          <MetricsBar metrics={stats.metrics} generatedAt={stats.generatedAt} />

          {/* ── Agents grid ── */}
          <section id="agents">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Agents — {agents.length} détectés
              </h2>
              {agents.length === 0 && (
                <span className="text-[11px] text-slate-600">Aucune tâche aujourd'hui</span>
              )}
            </div>

            {agents.length === 0 ? (
              <div
                className="rounded-xl border py-10 text-center text-sm text-slate-600"
                style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
              >
                Les agents apparaîtront ici une fois leurs premières tâches exécutées via{' '}
                <span className="font-mono text-slate-500">POST /api/agent</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {agents
                  .sort((a, b) => {
                    const order = { active: 0, error: 1, idle: 2 };
                    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
                  })
                  .map(agent => (
                    <AgentCard key={agent.name} agent={agent} />
                  ))}
              </div>
            )}
          </section>

          {/* ── Activity + Qdrant + n8n ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

            {/* Activity feed */}
            <section
              id="activity"
              className="rounded-xl border p-5"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
            >
              <ActivityFeed initialTasks={stats.recentTasks} />
            </section>

            {/* Right column */}
            <div className="flex flex-col gap-6">

              {/* Qdrant */}
              <section
                id="qdrant"
                className="rounded-xl border p-5"
                style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
              >
                <QdrantStatus collections={stats.qdrant} />
              </section>

              {/* n8n */}
              <section
                id="n8n"
                className="rounded-xl border p-5"
                style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
              >
                <N8nStatus workflows={stats.n8n} />
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

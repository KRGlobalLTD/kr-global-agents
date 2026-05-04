'use client';

import type { DashboardStats } from '@/app/api/dashboard/stats/route';

interface MetricTileProps {
  label:    string;
  value:    string | number;
  sub?:     string;
  accent?:  boolean;
  warning?: boolean;
}

function MetricTile({ label, value, sub, accent, warning }: MetricTileProps) {
  const valueColor = warning ? '#fbbf24' : accent ? '#a78bfa' : '#ffffff';

  return (
    <div
      className="flex-1 min-w-0 flex flex-col gap-1 px-5 py-4 rounded-xl border"
      style={{
        background:  'rgba(255,255,255,0.03)',
        borderColor: accent ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.08)',
      }}
    >
      <span className="text-[10px] uppercase tracking-widest text-slate-500 truncate">{label}</span>
      <span className="text-2xl font-bold tabular-nums leading-none truncate" style={{ color: valueColor }}>
        {value}
      </span>
      {sub && <span className="text-[11px] text-slate-500 truncate">{sub}</span>}
    </div>
  );
}

interface MetricsBarProps {
  metrics: DashboardStats['metrics'];
  generatedAt: string;
}

export function MetricsBar({ metrics, generatedAt }: MetricsBarProps) {
  const updated = new Date(generatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Métriques — Aujourd&apos;hui</h2>
        <span className="text-[11px] text-slate-600">Mis à jour {updated}</span>
      </div>
      <div className="flex gap-3 flex-wrap">
        <MetricTile
          label="Tâches totales"
          value={metrics.totalTasksToday}
          sub="depuis minuit"
          accent
        />
        <MetricTile
          label="Taux de succès"
          value={`${metrics.successRate}%`}
          warning={metrics.successRate < 80}
        />
        <MetricTile
          label="Coût IA"
          value={`${metrics.aiCostToday.toFixed(4)} €`}
          sub="couts_par_entite"
        />
        <MetricTile
          label="Agents actifs"
          value={`${metrics.activeAgents} / ${metrics.totalAgents}`}
          sub={metrics.totalAgents === 0 ? 'Aucune tâche aujourd\'hui' : `${metrics.totalAgents} détectés`}
          accent={metrics.activeAgents > 0}
        />
      </div>
    </div>
  );
}

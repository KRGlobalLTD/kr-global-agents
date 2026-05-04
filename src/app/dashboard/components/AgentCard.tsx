'use client';

import type { AgentStat } from '@/app/api/dashboard/stats/route';

const AGENT_EMOJI: Record<string, string> = {
  ZORO:       '⚔️',
  NAMI:       '🗺️',
  LUFFY:      '📬',
  KILLUA:     '🎯',
  ITACHI:     '🎨',
  HASHIRAMA:  '🌳',
  TSUNADE:    '💰',
  ROBIN:      '📚',
  SANJI:      '📱',
  CHOPPER:    '🔧',
  OROCHIMARU: '🛡️',
};

function StatusDot({ status }: { status: AgentStat['status'] }) {
  const config = {
    active: { color: 'bg-emerald-400', ring: 'ring-emerald-400/30', label: 'Active', pulse: true },
    idle:   { color: 'bg-slate-500',   ring: 'ring-slate-500/30',   label: 'Idle',   pulse: false },
    error:  { color: 'bg-red-400',     ring: 'ring-red-400/30',     label: 'Error',  pulse: false },
  }[status];

  return (
    <span className="flex items-center gap-1.5">
      <span className={`relative flex h-2 w-2`}>
        {config.pulse && (
          <span className={`absolute inline-flex h-full w-full rounded-full ${config.color} opacity-75 animate-ping`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${config.color}`} />
      </span>
      <span className="text-xs font-medium" style={{ color: status === 'active' ? '#34d399' : status === 'error' ? '#f87171' : '#64748b' }}>
        {config.label}
      </span>
    </span>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const now  = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'À l\'instant';
  if (mins < 60) return `Il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24) return `Il y a ${hrs}h`;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

interface AgentCardProps {
  agent: AgentStat;
}

export function AgentCard({ agent }: AgentCardProps) {
  const emoji = AGENT_EMOJI[agent.name] ?? '🤖';

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3 transition-all duration-200 hover:border-[#7c3aed]/50"
      style={{
        background:   'rgba(255,255,255,0.03)',
        borderColor:  agent.status === 'error' ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.08)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">{emoji}</span>
          <span className="font-semibold text-white text-sm tracking-wide">{agent.name}</span>
        </div>
        <StatusDot status={agent.status} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-0.5">Tâches</span>
          <span className="text-lg font-bold text-white tabular-nums">{agent.taskCount}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-0.5">Succès</span>
          <span
            className="text-lg font-bold tabular-nums"
            style={{ color: agent.successRate >= 90 ? '#34d399' : agent.successRate >= 70 ? '#fbbf24' : '#f87171' }}
          >
            {agent.successRate}%
          </span>
        </div>
      </div>

      {/* Last run */}
      <div className="flex items-center justify-between border-t pt-2" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <span className="text-[10px] uppercase tracking-widest text-slate-500">Dernière exec</span>
        <span className="text-xs text-slate-400">{formatTime(agent.lastRun)}</span>
      </div>

      {/* Last error */}
      {agent.lastError && (
        <div className="rounded-md px-2.5 py-1.5 text-xs text-red-300 leading-relaxed line-clamp-2"
          style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
          {agent.lastError.slice(0, 100)}
        </div>
      )}
    </div>
  );
}

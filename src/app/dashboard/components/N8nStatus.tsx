'use client';

import type { N8nWorkflow } from '@/app/api/dashboard/stats/route';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

interface N8nStatusProps {
  workflows: N8nWorkflow[];
}

export function N8nStatus({ workflows }: N8nStatusProps) {
  const activeCount = workflows.filter(w => w.active).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Workflows n8n
        </h2>
        <span className="text-[11px]" style={{ color: activeCount > 0 ? '#34d399' : '#64748b' }}>
          {activeCount} / {workflows.length} actifs
        </span>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
      >
        {workflows.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-slate-600">
            N8N_API_KEY non configurée ou aucun workflow
          </div>
        )}

        {workflows.map((wf, i) => {
          const isLast = i === workflows.length - 1;
          return (
            <div
              key={wf.id}
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)' }}
            >
              {/* Active indicator */}
              <span className="relative flex h-2 w-2 flex-shrink-0">
                {wf.active && (
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                )}
                <span
                  className="relative inline-flex rounded-full h-2 w-2"
                  style={{ background: wf.active ? '#34d399' : '#475569' }}
                />
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-200 truncate">{wf.name}</p>
                <p className="text-[10px] text-slate-500">Modifié {formatDate(wf.updatedAt)}</p>
              </div>

              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded flex-shrink-0"
                style={{
                  color:      wf.active ? '#34d399' : '#64748b',
                  background: wf.active ? 'rgba(52,211,153,0.1)' : 'rgba(100,116,139,0.1)',
                }}
              >
                {wf.active ? 'Actif' : 'Inactif'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

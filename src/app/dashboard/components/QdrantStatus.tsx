'use client';

import type { QdrantCollection } from '@/app/api/dashboard/stats/route';

const COLLECTION_LABEL: Record<string, { label: string; emoji: string }> = {
  kr_clients:   { label: 'Clients',    emoji: '👤' },
  kr_prospects: { label: 'Prospects',  emoji: '🎯' },
  kr_content:   { label: 'Contenus',   emoji: '📝' },
  kr_knowledge: { label: 'Knowledge',  emoji: '🧠' },
  kr_emails:    { label: 'Emails',     emoji: '📬' },
};

interface QdrantStatusProps {
  collections: QdrantCollection[];
}

export function QdrantStatus({ collections }: QdrantStatusProps) {
  const totalVectors = collections.reduce((s, c) => s + Math.max(0, c.vectorCount), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Mémoire Qdrant
        </h2>
        <span className="text-[11px] text-slate-600">{totalVectors} vecteurs total</span>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
      >
        {collections.map((col, i) => {
          const meta    = COLLECTION_LABEL[col.name] ?? { label: col.name, emoji: '📦' };
          const isLast  = i === collections.length - 1;
          const hasData = col.vectorCount > 0;
          const pct     = totalVectors > 0 ? (col.vectorCount / totalVectors) * 100 : 0;

          return (
            <div
              key={col.name}
              className="flex items-center gap-3 px-4 py-3"
              style={{
                borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <span className="text-base leading-none flex-shrink-0">{meta.emoji}</span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-300">{meta.label}</span>
                  <span className="text-xs font-mono tabular-nums" style={{ color: hasData ? '#a78bfa' : '#475569' }}>
                    {col.vectorCount === -1 ? 'Erreur' : col.vectorCount.toLocaleString()}
                  </span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width:      `${pct}%`,
                      background: hasData ? 'linear-gradient(90deg, #7c3aed, #a78bfa)' : 'transparent',
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}

        {collections.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-slate-600">
            Collections non disponibles
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient }                from '@supabase/supabase-js';
import type { RecentTask }             from '@/app/api/dashboard/stats/route';

const AGENT_EMOJI: Record<string, string> = {
  ZORO: '⚔️', NAMI: '🗺️', LUFFY: '📬', KILLUA: '🎯', ITACHI: '🎨',
  HASHIRAMA: '🌳', TSUNADE: '💰', ROBIN: '📚', SANJI: '📱', CHOPPER: '🔧', OROCHIMARU: '🛡️',
};

const STATUS_CONFIG = {
  completed: { label: 'OK',       color: '#34d399', bg: 'rgba(52,211,153,0.1)'  },
  failed:    { label: 'Erreur',   color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
  running:   { label: 'En cours', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)'  },
  pending:   { label: 'Attente',  color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000)   return `${ms}ms`;
  if (ms < 60000)  return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}min`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface ActivityFeedProps {
  initialTasks: RecentTask[];
}

interface RawTask {
  id:           string;
  agent_name:   string;
  task_type:    string;
  status:       string;
  error:        string | null;
  started_at:   string;
  completed_at: string | null;
}

export function ActivityFeed({ initialTasks }: ActivityFeedProps) {
  const [tasks, setTasks] = useState<RecentTask[]>(initialTasks);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;

    const client = createClient(url, key);

    const channel = client
      .channel('agent_tasks_feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_tasks' },
        (payload) => {
          const raw = payload.new as RawTask;
          if (!raw?.id) return;

          const task: RecentTask = {
            id:           raw.id,
            agent_name:   raw.agent_name ?? '',
            task_type:    raw.task_type  ?? '',
            status:       raw.status     ?? 'pending',
            error:        raw.error      ?? null,
            started_at:   raw.started_at ?? new Date().toISOString(),
            completed_at: raw.completed_at ?? null,
            duration_ms:  raw.completed_at
              ? new Date(raw.completed_at).getTime() - new Date(raw.started_at).getTime()
              : null,
          };

          setTasks(prev => {
            const filtered = prev.filter(t => t.id !== task.id);
            return [task, ...filtered].slice(0, 20);
          });
        },
      )
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
        Activité temps réel
      </h2>

      <div
        ref={feedRef}
        className="flex flex-col gap-1 max-h-[420px] overflow-y-auto pr-1"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' }}
      >
        {tasks.length === 0 && (
          <div className="text-center py-8 text-slate-600 text-sm">
            Aucune tâche aujourd&apos;hui
          </div>
        )}

        {tasks.map((task, i) => {
          const cfg = STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
          const emoji = AGENT_EMOJI[task.agent_name] ?? '🤖';

          return (
            <div
              key={task.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg border transition-all duration-300"
              style={{
                background:   i === 0 ? 'rgba(124,58,237,0.06)' : 'rgba(255,255,255,0.02)',
                borderColor:  i === 0 ? 'rgba(124,58,237,0.2)'  : 'rgba(255,255,255,0.05)',
                animation:    i === 0 ? 'fadeIn 0.3s ease' : undefined,
              }}
            >
              <span className="text-base leading-none flex-shrink-0">{emoji}</span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">{task.agent_name}</span>
                  <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded font-mono">
                    {task.task_type}
                  </span>
                </div>
                {task.error && (
                  <p className="text-[10px] text-red-400 truncate mt-0.5">{task.error}</p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ color: cfg.color, background: cfg.bg }}
                >
                  {cfg.label}
                </span>
                <span className="text-[10px] text-slate-500 font-mono w-12 text-right">
                  {formatDuration(task.duration_ms)}
                </span>
                <span className="text-[10px] text-slate-600 font-mono w-16 text-right">
                  {formatTime(task.started_at)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runHealthCheck, getLatestToolStatuses } from '@/lib/agents/orochimaru/health-checker';
import { runBackup, getLastBackup } from '@/lib/agents/orochimaru/backup-orchestrator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyInternalToken(request: NextRequest): boolean {
  return request.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

// ---- Payload types ----

type ActionPayload =
  | { action: 'health_check' }
  | { action: 'backup' };

// ---- POST ----

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: ActionPayload;
  try {
    body = (await request.json()) as ActionPayload;
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'health_check': {
        const report = await runHealthCheck();
        return NextResponse.json({ success: true, report });
      }

      case 'backup': {
        const result = await runBackup();
        return NextResponse.json({
          success: result.success,
          result,
        }, { status: result.success ? 200 : 500 });
      }

      default: {
        return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';

    try {
      await supabase.from('alerts').insert({
        agent_name: 'OROCHIMARU',
        level:      'URGENT',
        message:    `Erreur API OROCHIMARU : action=${body.action}`,
      });
    } catch {
      // silencieux si Supabase down
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---- GET — statut de tous les outils ----

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view'); // 'history' | 'backups'

  // Historique des checks (dernières 48h)
  if (view === 'history') {
    const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const { data, error } = await supabase
      .from('tool_status')
      .select('tool_name, status, response_time_ms, error_message, checked_at')
      .gte('checked_at', since)
      .order('checked_at', { ascending: false })
      .limit(500);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, history: data ?? [] });
  }

  // Historique des backups
  if (view === 'backups') {
    const { data, error } = await supabase
      .from('backups')
      .select('id, type, status, r2_key, size_bytes, duration_ms, rows_exported, tables_backed, error_message, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, backups: data ?? [] });
  }

  // Vue par défaut : dernier statut de chaque outil + dernier backup
  const [latestStatuses, lastBackup] = await Promise.all([
    getLatestToolStatuses(),
    getLastBackup(),
  ]);

  // Résumé global
  const statusValues = Object.values(latestStatuses);
  const summary = {
    total:    statusValues.length,
    up:       statusValues.filter(s => s?.status === 'up').length,
    degraded: statusValues.filter(s => s?.status === 'degraded').length,
    down:     statusValues.filter(s => s?.status === 'down').length,
    unknown:  statusValues.filter(s => s === null || s.status === 'unknown').length,
  };

  return NextResponse.json({
    agent:          'OROCHIMARU',
    status:         'ACTIF',
    tools:          latestStatuses,
    summary,
    last_backup:    lastBackup,
  });
}

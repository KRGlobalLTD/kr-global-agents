import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { updateAgentStatus, checkAllAgents, type AgentStatus } from '@/lib/agents/hashirama/supervisor';
import { generateDailyReport } from '@/lib/agents/hashirama/daily-report';
import { runMonitorCycle, reactivateAgent } from '@/lib/agents/hashirama/agent-monitor';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyInternalToken(request: NextRequest): boolean {
  return request.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

// ---- Payload types ----

type ActionPayload =
  | { action: 'daily_report' }
  | { action: 'check_agents' }
  | { action: 'monitor_agents' }
  | { action: 'agent_update'; agentName: string; status: AgentStatus; errors?: string }
  | { action: 'reactivate_agent'; agentName: string };

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
      case 'daily_report': {
        await generateDailyReport();
        return NextResponse.json({ success: true, message: 'Rapport quotidien généré et envoyé' });
      }

      case 'check_agents': {
        await checkAllAgents();
        return NextResponse.json({ success: true, message: 'Vérification des agents effectuée' });
      }

      case 'monitor_agents': {
        const result = await runMonitorCycle();
        return NextResponse.json({ success: true, result });
      }

      case 'agent_update': {
        await updateAgentStatus({
          agentName: body.agentName,
          status: body.status,
          errors: body.errors,
        });
        await supabase.from('alerts').insert({
          agent_name: 'HASHIRAMA',
          level: 'INFO',
          message: `Mise à jour reçue : ${body.agentName} → ${body.status}`,
        });
        return NextResponse.json({
          success: true,
          message: `Statut de ${body.agentName} mis à jour`,
        });
      }

      case 'reactivate_agent': {
        await reactivateAgent(body.agentName);
        return NextResponse.json({
          success: true,
          message: `Agent ${body.agentName} réactivé`,
        });
      }

      default: {
        return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';

    try {
      await supabase.from('alerts').insert({
        agent_name: 'HASHIRAMA',
        level: 'URGENT',
        message: `Erreur API HASHIRAMA : action=${body.action}`,
      });
    } catch {
      // log silencieux
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---- GET ----

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const [{ data: agents }, { data: unresolvedAlerts }] = await Promise.all([
    supabase
      .from('agents_status')
      .select('agent_name, status, last_run, errors')
      .order('agent_name'),
    supabase
      .from('alerts')
      .select('agent_name, level, message, created_at')
      .is('resolved_at', null)
      .in('level', ['WARNING', 'URGENT'])
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return NextResponse.json({
    supervisor: 'HASHIRAMA',
    status: 'ACTIF',
    agents: agents ?? [],
    activeAlerts: unresolvedAlerts ?? [],
  });
}

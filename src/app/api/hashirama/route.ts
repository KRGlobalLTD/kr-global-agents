import { NextRequest, NextResponse } from 'next/server';
import { updateAgentStatus, checkAllAgents, AgentStatus } from '@/lib/agents/hashirama/supervisor';
import { generateAndSendDailyReport } from '@/lib/agents/hashirama/report-generator';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyInternalToken(request: NextRequest): boolean {
  const token = request.headers.get('x-internal-token');
  return token === process.env.INTERNAL_API_TOKEN;
}

type ActionPayload =
  | { action: 'agent_update'; agentName: string; status: AgentStatus; errors?: string }
  | { action: 'daily_report' }
  | { action: 'check_agents' }
  | { action: 'slack_webhook'; payload: Record<string, unknown> };

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
      case 'agent_update': {
        await updateAgentStatus({
          agentName: body.agentName,
          status: body.status,
          errors: body.errors,
        });
        await supabase.from('alerts').insert({
          agent_name: 'HASHIRAMA',
          level: 'INFO',
          message: `Mise à jour reçue de l'agent : ${body.agentName} → ${body.status}`,
        });
        return NextResponse.json({ success: true, message: `Statut de ${body.agentName} mis à jour` });
      }

      case 'daily_report': {
        await generateAndSendDailyReport();
        return NextResponse.json({ success: true, message: 'Rapport quotidien généré et envoyé' });
      }

      case 'check_agents': {
        await checkAllAgents();
        return NextResponse.json({ success: true, message: 'Vérification des agents effectuée' });
      }

      case 'slack_webhook': {
        await supabase.from('alerts').insert({
          agent_name: 'HASHIRAMA',
          level: 'INFO',
          message: 'Webhook Slack reçu',
        });
        return NextResponse.json({ success: true, message: 'Webhook Slack traité' });
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
        message: `Erreur API hashirama : action=${body.action}`,
      });
    } catch {
      // log silencieux — ne pas masquer l'erreur principale
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: agents } = await supabase
    .from('agents_status')
    .select('agent_name, status, last_run, errors')
    .order('agent_name');

  const { data: unresolvedAlerts } = await supabase
    .from('alerts')
    .select('agent_name, level, message, created_at')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(10);

  return NextResponse.json({
    supervisor: 'HASHIRAMA',
    status: 'ACTIF',
    agents: agents ?? [],
    activeAlerts: unresolvedAlerts ?? [],
  });
}

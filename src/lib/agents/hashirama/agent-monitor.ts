import { createClient } from '@supabase/supabase-js';
import { updateAgentStatus } from './supervisor';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ERROR_THRESHOLD = 3; // erreurs en 1h avant coupure

// ---- Types ----

interface ErrorCount {
  agentName: string;
  count: number;
  lastMessage: string;
}

interface MonitorResult {
  checked: number;
  shutDown: string[];
  healthy: string[];
}

// ---- Slack #erreurs ----

async function alertErreurs(agentName: string, errorCount: number, lastMsg: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_ERREURS!;

  const text =
    `<!channel> 🔴 *HASHIRAMA — Agent coupé automatiquement*\n` +
    `Agent : *${agentName}*\n` +
    `Erreurs en 1h : *${errorCount}* (seuil : ${ERROR_THRESHOLD})\n` +
    `Dernière erreur : ${lastMsg}\n` +
    `Action : agent passé en INACTIF. Intervention manuelle requise.`;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      username: 'HASHIRAMA',
      icon_emoji: ':no_entry:',
    }),
  });

  if (!response.ok) {
    // Log sans throw pour ne pas bloquer le cycle de monitoring
    await supabase.from('alerts').insert({
      agent_name: 'HASHIRAMA',
      level: 'URGENT',
      message: `Échec envoi alerte #erreurs pour ${agentName} (HTTP ${response.status})`,
    });
  }
}

// ---- Comptage des erreurs récentes ----

async function countRecentErrors(): Promise<ErrorCount[]> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('alerts')
    .select('agent_name, level, message')
    .in('level', ['WARNING', 'URGENT'])
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Erreur lecture alertes récentes : ${error.message}`);

  // Agrégation par agent en mémoire
  const byAgent = new Map<string, { count: number; lastMessage: string }>();

  for (const row of data ?? []) {
    const name = row.agent_name as string;
    const existing = byAgent.get(name);
    if (existing) {
      existing.count++;
      // La première entrée trouvée est déjà la plus récente (tri DESC)
    } else {
      byAgent.set(name, { count: 1, lastMessage: row.message as string });
    }
  }

  return Array.from(byAgent.entries())
    .filter(([, v]) => v.count > ERROR_THRESHOLD)
    .map(([agentName, v]) => ({
      agentName,
      count: v.count,
      lastMessage: v.lastMessage,
    }));
}

// ---- Coupure d'un agent ----

async function shutDownAgent(agentName: string, errorCount: number, lastMsg: string): Promise<void> {
  // Passe le statut à INACTIF dans Supabase
  await updateAgentStatus({
    agentName,
    status: 'INACTIF',
    errors: `Coupé automatiquement après ${errorCount} erreurs en 1h`,
  });

  // Alerte #erreurs
  await alertErreurs(agentName, errorCount, lastMsg);

  await supabase.from('alerts').insert({
    agent_name: 'HASHIRAMA',
    level: 'URGENT',
    message: `Agent ${agentName} coupé automatiquement : ${errorCount} erreurs en 1h`,
  });
}

// ---- Point d'entrée principal ----

export async function runMonitorCycle(): Promise<MonitorResult> {
  // Récupère tous les agents actifs (non déjà INACTIF)
  const { data: agents, error: agentsError } = await supabase
    .from('agents_status')
    .select('agent_name, status')
    .neq('status', 'INACTIF');

  if (agentsError) throw new Error(`Erreur lecture agents : ${agentsError.message}`);

  const activeAgents = (agents ?? []) as { agent_name: string; status: string }[];

  // Agents avec trop d'erreurs récentes
  const overThreshold = await countRecentErrors();
  const shutDownNames = new Set(overThreshold.map((e) => e.agentName));

  const shutDown: string[] = [];
  const healthy: string[] = [];

  for (const agent of activeAgents) {
    const errInfo = overThreshold.find((e) => e.agentName === agent.agent_name);

    if (shutDownNames.has(agent.agent_name) && errInfo) {
      try {
        await shutDownAgent(agent.agent_name, errInfo.count, errInfo.lastMessage);
        shutDown.push(agent.agent_name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur inconnue';
        await supabase.from('alerts').insert({
          agent_name: 'HASHIRAMA',
          level: 'URGENT',
          message: `Échec coupure ${agent.agent_name} : ${msg.slice(0, 120)}`,
        });
      }
    } else {
      healthy.push(agent.agent_name);
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'HASHIRAMA',
    level: 'INFO',
    message:
      `Cycle monitoring : ${activeAgents.length} agent(s) surveillé(s), ` +
      `${shutDown.length} coupé(s), ${healthy.length} sain(s)`,
  });

  return {
    checked: activeAgents.length,
    shutDown,
    healthy,
  };
}

// ---- Réactivation manuelle d'un agent ----

export async function reactivateAgent(agentName: string): Promise<void> {
  await updateAgentStatus({ agentName, status: 'OK' });

  await supabase.from('alerts').insert({
    agent_name: 'HASHIRAMA',
    level: 'INFO',
    message: `Agent ${agentName} réactivé manuellement`,
  });
}

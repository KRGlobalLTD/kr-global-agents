import { createClient } from '@supabase/supabase-js';
import { sendAlert, sendValidationRequest } from './slack-notifier';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type AgentStatus = 'OK' | 'ERREUR' | 'EN_COURS' | 'INACTIF';

export interface AgentUpdate {
  agentName: string;
  status: AgentStatus;
  errors?: string;
}

export interface SpendingDecision {
  action: 'EXECUTE' | 'PENDING_VALIDATION' | 'BLOCKED';
  reason: string;
}

/**
 * Évalue une dépense selon les seuils définis et retourne la décision.
 * < 50€   → agent agit seul
 * 50-200€ → notifie Slack et attend validation
 * > 200€  → bloque et alerte immédiate
 */
export async function evaluateSpending(
  agentName: string,
  action: string,
  amount: number
): Promise<SpendingDecision> {
  await supabase.from('alerts').insert({
    agent_name: agentName,
    level: 'INFO',
    message: `Évaluation dépense : action="${action}", montant=${amount.toFixed(2)}€`,
  });

  if (amount < 50) {
    return { action: 'EXECUTE', reason: `Montant ${amount.toFixed(2)}€ sous le seuil d'autorisation` };
  }

  if (amount <= 200) {
    await sendValidationRequest(agentName, action, amount);
    return {
      action: 'PENDING_VALIDATION',
      reason: `Montant ${amount.toFixed(2)}€ — validation Slack requise`,
    };
  }

  await sendAlert(agentName, `Dépense bloquée : ${action} — ${amount.toFixed(2)}€ dépasse le seuil de 200€`, true);
  return {
    action: 'BLOCKED',
    reason: `Montant ${amount.toFixed(2)}€ dépasse le seuil maximum de 200€`,
  };
}

/**
 * Met à jour le statut d'un agent dans Supabase.
 */
export async function updateAgentStatus(update: AgentUpdate): Promise<void> {
  const { error } = await supabase
    .from('agents_status')
    .upsert(
      {
        agent_name: update.agentName,
        status: update.status,
        last_run: new Date().toISOString(),
        errors: update.errors ?? null,
      },
      { onConflict: 'agent_name' }
    );

  if (error) {
    throw new Error(`Impossible de mettre à jour le statut de ${update.agentName} : ${error.message}`);
  }

  if (update.status === 'ERREUR') {
    await sendAlert(
      update.agentName,
      `L'agent est en erreur${update.errors ? ` : ${update.errors}` : ''}`,
      false
    );
  }
}

/**
 * Vérifie le statut de tous les agents et alerte si l'un d'eux est inactif
 * depuis plus d'une heure ou en erreur.
 */
export async function checkAllAgents(): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: agents, error } = await supabase
    .from('agents_status')
    .select('agent_name, status, last_run, errors');

  if (error) {
    throw new Error(`Impossible de récupérer les statuts agents : ${error.message}`);
  }

  if (!agents) return;

  for (const agent of agents) {
    const isStale = agent.last_run < oneHourAgo;
    const isError = agent.status === 'ERREUR';

    if (isStale && agent.status !== 'INACTIF') {
      await sendAlert(
        agent.agent_name,
        `Aucune activité depuis plus d'une heure (dernière exécution : ${agent.last_run})`,
        false
      );
      await updateAgentStatus({ agentName: agent.agent_name, status: 'INACTIF' });
    } else if (isError) {
      await sendAlert(
        agent.agent_name,
        `Statut ERREUR détecté lors de la vérification horaire${agent.errors ? ` : ${agent.errors}` : ''}`,
        false
      );
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'HASHIRAMA',
    level: 'INFO',
    message: `Vérification horaire terminée — ${agents.length} agent(s) contrôlé(s)`,
  });
}

/**
 * Récupère le statut courant de tous les agents.
 */
export async function getAllAgentStatuses(): Promise<
  { agent_name: string; status: AgentStatus; last_run: string; errors: string | null }[]
> {
  const { data, error } = await supabase
    .from('agents_status')
    .select('agent_name, status, last_run, errors')
    .order('agent_name');

  if (error) {
    throw new Error(`Impossible de récupérer les statuts : ${error.message}`);
  }

  return (data ?? []) as { agent_name: string; status: AgentStatus; last_run: string; errors: string | null }[];
}

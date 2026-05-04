import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { type KRGlobalStateType } from '../state';
import { hashiramaChain, hashiramaChainJson } from '@/lib/langchain/chains/hashirama-chain';
import { evaluateSpending, updateAgentStatus, checkAllAgents, getAllAgentStatuses, type AgentUpdate } from '@/lib/agents/hashirama/supervisor';
import { runMonitorCycle, reactivateAgent } from '@/lib/agents/hashirama/agent-monitor';
import { generateAndSendDailyReport }       from '@/lib/agents/hashirama/report-generator';

type HashiramaAction =
  | 'daily_report'
  | 'check_agents'
  | 'monitor_agents'
  | 'evaluate_spending'
  | 'agent_update'
  | 'reactivate_agent'
  | 'analyze_status';

export async function hashiramaNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as HashiramaAction) ?? 'check_agents';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`HASHIRAMA action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case 'daily_report': {
        await generateAndSendDailyReport();

        const statuses = await getAllAgentStatuses();
        const insight  = await hashiramaChain.invoke({
          context: '',
          input:   `Le rapport quotidien vient d'être généré et envoyé sur Slack. Voici les statuts agents : ${JSON.stringify(statuses)}. Génère un commentaire de 2-3 phrases sur la santé globale du système.`,
        });

        result = { sent: true, agents_count: statuses.length, insight };
        break;
      }

      case 'check_agents': {
        await checkAllAgents();
        const statuses = await getAllAgentStatuses();

        const analysis = await hashiramaChainJson.invoke({
          context: '',
          input:   `Analyse ces statuts agents et identifie les problèmes : ${JSON.stringify(statuses)}. JSON : {"healthy": [], "errors": [], "inactive": [], "action_required": false, "summary": "..."}`,
        });

        result = { statuses, analysis };
        break;
      }

      case 'monitor_agents': {
        const monitorResult = await runMonitorCycle();

        const insight = await hashiramaChain.invoke({
          context: '',
          input:   `Cycle de monitoring terminé : ${JSON.stringify(monitorResult)}. Génère un résumé de situation et des recommandations si des agents ont été coupés.`,
        });

        result = { monitor: monitorResult, insight };
        break;
      }

      case 'evaluate_spending': {
        const agentName = (input['agent_name'] as string) ?? 'SYSTEM';
        const spendAction = (input['spend_action'] as string) ?? '';
        const amount    = (input['amount']      as number) ?? 0;

        if (!spendAction) throw new Error('spend_action requis');

        const decision = await evaluateSpending(agentName, spendAction, amount);

        const justification = await hashiramaChainJson.invoke({
          context: '',
          input:   `Décision de dépense HASHIRAMA : ${JSON.stringify({ agentName, spendAction, amount, decision })}. Justifie la décision en JSON : {"decision": "...", "reason": "...", "next_steps": "..."}`,
        });

        result = { decision, justification };
        break;
      }

      case 'agent_update': {
        const update: AgentUpdate = {
          agentName: (input['agent_name'] as string) ?? '',
          status:    (input['status']     as AgentUpdate['status']) ?? 'OK',
          errors:    (input['errors']     as string | undefined),
        };

        if (!update.agentName) throw new Error('agent_name requis');

        await updateAgentStatus(update);
        result = { updated: true, agent: update.agentName, status: update.status };
        break;
      }

      case 'reactivate_agent': {
        const agentName = (input['agent_name'] as string) ?? '';
        if (!agentName) throw new Error('agent_name requis');

        await reactivateAgent(agentName);

        const comment = await hashiramaChain.invoke({
          context: '',
          input:   `L'agent ${agentName} vient d'être réactivé manuellement. Génère un message de confirmation court (1 phrase) pour le log.`,
        });

        result = { reactivated: true, agent: agentName, comment };
        break;
      }

      case 'analyze_status': {
        const statuses = await getAllAgentStatuses();
        const analysis = await hashiramaChainJson.invoke({
          context: '',
          input:   `Analyse approfondie de l'état du système KR Global : ${JSON.stringify(statuses)}. JSON : {"global_health": "good|degraded|critical", "active_agents": 0, "inactive_agents": 0, "error_agents": 0, "recommendations": [], "priority_actions": []}`,
        });

        result = { statuses, analysis };
        break;
      }

      default: {
        const reasoning = await hashiramaChain.invoke({
          context: '',
          input:   `Tâche HASHIRAMA : ${JSON.stringify(input)}`,
        });
        result = { reasoning };
      }
    }

    return {
      agent_name:  'HASHIRAMA',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, new AIMessage(`HASHIRAMA completed action=${action}`)],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur HASHIRAMA inconnue';
    return {
      agent_name: 'HASHIRAMA',
      status:     'failed',
      error:      message,
      messages:   [userMsg, new AIMessage(`HASHIRAMA error: ${message}`)],
    };
  }
}

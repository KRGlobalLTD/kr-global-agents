import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { type KRGlobalStateType } from '../state';
import { luffyChain, luffyChainJson } from '@/lib/langchain/chains/luffy-chain';
import { getEmailHistory, saveEmailMemory } from '@/lib/langchain/memory';
import { classifyEmail, type IncomingEmail } from '@/lib/agents/luffy/email-classifier';
import { respondToEmail }                    from '@/lib/agents/luffy/email-responder';

type LuffyAction = 'process_email' | 'classify_email' | 'route_to_agent';

export async function luffyNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as LuffyAction) ?? 'classify_email';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`LUFFY action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    function buildEmail(): IncomingEmail {
      return {
        messageId:  (input['message_id']  as string) ?? '',
        fromEmail:  (input['from_email']  as string) ?? (input['from'] as string) ?? '',
        fromName:   (input['from_name']   as string) ?? '',
        subject:    (input['subject']     as string) ?? '',
        body:       (input['body']        as string) ?? '',
        receivedAt: new Date((input['received_at'] as string) ?? Date.now()),
      };
    }

    switch (action) {
      case 'classify_email': {
        const classification = await classifyEmail(buildEmail());
        result = { classification };
        break;
      }

      case 'process_email': {
        const email          = buildEmail();
        const emailHistory   = await getEmailHistory(email.fromEmail);
        const classification = await classifyEmail(email);
        const response       = await respondToEmail(email, classification);
        await saveEmailMemory(email.fromEmail, email.subject, email.body);
        result = { classification, response, context_used: emailHistory.length > 0 };
        break;
      }

      case 'route_to_agent': {
        const fromEmail = (input['from_email'] as string) ?? '';
        const history   = await getEmailHistory(fromEmail);
        const raw = await luffyChainJson.invoke({
          context: history,
          input:   `Analyse cet email et détermine à quel agent le router parmi [ZORO, NAMI, KILLUA, ITACHI] :\n${JSON.stringify(input)}\n\nRetourne un JSON : {"agent": "...", "reason": "..."}`,
        });
        result = { routing: JSON.parse(raw) };
        break;
      }

      default: {
        const reasoning = await luffyChain.invoke({
          context: '',
          input:   `Tâche : ${JSON.stringify(input)}`,
        });
        result = { reasoning };
      }
    }

    return {
      agent_name:  'LUFFY',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, new AIMessage(`LUFFY completed action=${action}`)],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur LUFFY inconnue';
    return {
      agent_name: 'LUFFY',
      status:     'failed',
      error:      message,
      messages:   [userMsg, new AIMessage(`LUFFY error: ${message}`)],
    };
  }
}

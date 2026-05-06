import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { type KRGlobalStateType }  from '../state';
import { chopperChain }            from '@/lib/langchain/chains/chopper-chain';
import {
  createTicket,
  updateTicket,
  getOpenTickets,
  getTicketById,
  type TicketPriority,
} from '@/lib/agents/chopper/ticket-manager';
import { findAnswer, addToFAQ, getClientContext } from '@/lib/agents/chopper/faq-engine';
import { escalateById }                           from '@/lib/agents/chopper/escalation-manager';

type ChopperAction =
  | 'answer_question'
  | 'create_ticket'
  | 'resolve_ticket'
  | 'escalate'
  | 'get_open_tickets';

export async function chopperNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as ChopperAction) ?? 'answer_question';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`CHOPPER action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case 'answer_question': {
        const question    = (input['question'] as string) ?? '';
        const clientEmail = (input['client_email'] as string) ?? '';
        if (!question) throw new Error('question requise');

        const [context, answer] = await Promise.all([
          getClientContext(clientEmail),
          findAnswer(question),
        ]);

        if (answer) {
          await addToFAQ(question, answer);
          result = { answer, source: 'knowledge_base', context_used: context.length > 0 };
        } else {
          const prompt   = context ? `Contexte client :\n${context}\n\nQuestion : ${question}` : question;
          const fallback = await chopperChain.invoke({ input: prompt });
          result = { answer: fallback, source: 'llm', context_used: context.length > 0 };
        }
        break;
      }

      case 'create_ticket': {
        const ticket = await createTicket({
          clientEmail: input['client_email'] as string | undefined,
          subject:     (input['subject']      as string) ?? 'Sans objet',
          description: (input['description']  as string) ?? '',
          priority:    input['priority']      as TicketPriority | undefined,
        });
        result = { ticket };
        break;
      }

      case 'resolve_ticket': {
        const ticketId = input['ticket_id'] as string;
        if (!ticketId) throw new Error('ticket_id requis');

        const ticket = await getTicketById(ticketId);
        if (!ticket) throw new Error(`Ticket ${ticketId} introuvable`);

        await updateTicket(ticketId, {
          status:            'resolved',
          resolution:        (input['resolution']         as string)  ?? '',
          satisfactionScore: input['satisfaction_score']  as number | undefined,
        });

        result = { resolved: true, ticket_id: ticketId };
        break;
      }

      case 'escalate': {
        const ticketId = input['ticket_id'] as string;
        if (!ticketId) throw new Error('ticket_id requis');

        const reason = (input['reason'] as string) ?? 'Problème complexe nécessitant intervention humaine';
        await escalateById(ticketId, reason);

        result = { escalated: true, ticket_id: ticketId, escalated_to: 'Karim Hammouche' };
        break;
      }

      case 'get_open_tickets': {
        const tickets = await getOpenTickets();
        result = { tickets, count: tickets.length };
        break;
      }

      default: {
        const response = await chopperChain.invoke({ input: JSON.stringify(input) });
        result = { response };
      }
    }

    return {
      agent_name:  'CHOPPER',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, new AIMessage(`CHOPPER completed action=${action}`)],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur CHOPPER inconnue';
    return {
      agent_name: 'CHOPPER',
      status:     'failed',
      error:      message,
      messages:   [userMsg, new AIMessage(`CHOPPER error: ${message}`)],
    };
  }
}

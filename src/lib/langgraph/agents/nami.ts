import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { type KRGlobalStateType } from '../state';
import { callOpenRouter, systemPrompt } from '../openrouter';
import { triggerOnboarding }   from '@/lib/agents/nami/onboarding-flow';
import { runRetentionCycle }   from '@/lib/agents/nami/retention-sequence';

type NamiAction = 'send_welcome_email' | 'generate_contract' | 'payment_confirmed' | 'retention_cycle';

export async function namiNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as NamiAction) ?? 'send_welcome_email';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`NAMI action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case 'send_welcome_email':
      case 'payment_confirmed': {
        // triggerOnboarding démarre le flux complet (email + Supabase + Slack)
        const paymentIntentId = (input['payment_intent_id'] as string) ?? '';
        if (!paymentIntentId) throw new Error('payment_intent_id requis');
        await triggerOnboarding(paymentIntentId);
        result = { triggered: true, payment_intent_id: paymentIntentId };
        break;
      }

      case 'generate_contract': {
        // OpenRouter génère le contrat en markdown selon le brief
        const contract = await callOpenRouter([
          systemPrompt('NAMI', 'agent onboarding et gestion client'),
          {
            role:    'user',
            content: `Génère un contrat de prestation de services pour :\n${JSON.stringify(input, null, 2)}\n\nInclure : parties, scope, tarif, conditions de paiement, clause de confidentialité, droit applicable (droit anglais).`,
          },
        ]);
        result = { contract };
        break;
      }

      case 'retention_cycle': {
        const retention = await runRetentionCycle();
        result = { retention };
        break;
      }

      default: {
        const reasoning = await callOpenRouter([
          systemPrompt('NAMI', 'agent onboarding et gestion client'),
          { role: 'user', content: `Tâche : ${JSON.stringify(input)}` },
        ]);
        result = { reasoning };
      }
    }

    const aiMsg = new AIMessage(`NAMI completed action=${action}`);

    return {
      agent_name:  'NAMI',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, aiMsg],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur NAMI inconnue';
    return {
      agent_name: 'NAMI',
      status:     'failed',
      error:      message,
      messages:   [userMsg, new AIMessage(`NAMI error: ${message}`)],
    };
  }
}

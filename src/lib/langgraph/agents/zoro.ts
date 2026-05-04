import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { type KRGlobalStateType } from '../state';
import { callOpenRouter, systemPrompt } from '../openrouter';
import { trackExpense, getCurrentMonthCosts, type Entity, type TransactionCategory } from '@/lib/agents/zoro/cost-tracker';
import { generateInvoice, type InvoiceData }   from '@/lib/agents/zoro/invoice-generator';
import { generateMonthlyReport }               from '@/lib/agents/zoro/report-generator';

type ZoroAction = 'track_cost' | 'generate_report' | 'sync_stripe' | 'generate_invoice';

const VALID_ENTITIES   = new Set<Entity>(['KR_GLOBAL_UK', 'MAROC', 'FRANCE']);
const VALID_CATEGORIES = new Set<TransactionCategory>(['SAAS', 'IA', 'PUBLICITE', 'FREELANCE', 'REVENU_STRIPE', 'REVENU_GUMROAD', 'REVENU_AUTRE', 'FRAIS_STRIPE', 'REMBOURSEMENT']);

function toEntity(v: unknown): Entity {
  return VALID_ENTITIES.has(v as Entity) ? (v as Entity) : 'KR_GLOBAL_UK';
}

function toCategory(v: unknown): TransactionCategory {
  return VALID_CATEGORIES.has(v as TransactionCategory) ? (v as TransactionCategory) : 'SAAS';
}

export async function zoroNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as ZoroAction) ?? 'track_cost';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`ZORO action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case 'track_cost': {
        await trackExpense({
          date:        new Date((input['date'] as string) ?? Date.now()),
          entity:      toEntity(input['entity']),
          category:    toCategory(input['category']),
          amount:      (input['amount']      as number) ?? 0,
          currency:    (input['currency']    as string) ?? 'GBP',
          source:      (input['source']      as string) ?? 'manual',
          description: (input['description'] as string | undefined),
          stripeId:    (input['stripe_id']   as string | undefined),
        });
        result = { tracked: true, entity: input['entity'], amount: input['amount'] };
        break;
      }

      case 'generate_report': {
        const now   = new Date();
        const month = (input['month'] as number) ?? (now.getMonth() + 1);
        const year  = (input['year']  as number) ?? now.getFullYear();
        const report = await generateMonthlyReport(month, year);
        result = { report };
        break;
      }

      case 'generate_invoice': {
        const data: InvoiceData = {
          client:            input['client']             as InvoiceData['client'],
          items:             input['items']              as InvoiceData['items'],
          currency:          (input['currency']          as string)  ?? 'GBP',
          issuedAt:          new Date((input['issued_at'] as string) ?? Date.now()),
          dueDays:           (input['due_days']          as number)  ?? 30,
          includesIpClause:  (input['includes_ip_clause'] as boolean) ?? false,
          vatReverseCharge:  (input['vat_reverse_charge'] as boolean) ?? false,
        };
        const invoice = await generateInvoice(data);
        result = { number: invoice.number, r2_url: invoice.r2Url, due_at: invoice.dueAt };
        break;
      }

      case 'sync_stripe': {
        const costs = await getCurrentMonthCosts(toEntity(input['entity']) ?? undefined);
        const analysis = await callOpenRouter([
          systemPrompt('ZORO', 'agent finance et comptabilité'),
          { role: 'user', content: `Analyse ces coûts et identifie les écarts Stripe potentiels : ${JSON.stringify(costs)}` },
        ], undefined, true);
        result = { costs, analysis };
        break;
      }

      default: {
        const reasoning = await callOpenRouter([
          systemPrompt('ZORO', 'agent finance et comptabilité'),
          { role: 'user', content: `Tâche : ${JSON.stringify(input)}` },
        ], undefined, true);
        result = { reasoning };
      }
    }

    return {
      agent_name:  'ZORO',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, new AIMessage(`ZORO completed action=${action}`)],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur ZORO inconnue';
    return {
      agent_name: 'ZORO',
      status:     'failed',
      error:      message,
      messages:   [userMsg, new AIMessage(`ZORO error: ${message}`)],
    };
  }
}

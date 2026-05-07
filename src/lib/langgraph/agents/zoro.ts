import { HumanMessage, AIMessage }    from '@langchain/core/messages';
import { createClient }               from '@supabase/supabase-js';
import { type KRGlobalStateType }     from '../state';
import { zoroChain, zoroChainText }   from '@/lib/langchain/chains/zoro-chain';

// ── Existing modules ─────────────────────────────────────────────────────────
import { trackExpense, getCurrentMonthCosts, type Entity, type TransactionCategory } from '@/lib/agents/zoro/cost-tracker';
import { generateInvoice, type InvoiceData }  from '@/lib/agents/zoro/invoice-generator';
import { generateMonthlyReport }              from '@/lib/agents/zoro/report-generator';
import { syncStripeTransactions }             from '@/lib/agents/zoro/stripe-sync';
import { checkDeadlines, getUpcomingDeadlines } from '@/lib/agents/zoro/uk-deadlines';
import { processPaymentReminders }            from '@/lib/agents/zoro/payment-reminder';

// ── New finance-ops modules ───────────────────────────────────────────────────
import { runEmailMonitor }                    from '@/lib/agents/zoro/email-monitor';
import { extractInvoiceFromText }             from '@/lib/agents/zoro/invoice-extractor';
import { getProviders, getTopProvidersBySpend } from '@/lib/agents/zoro/provider-registry';
import { upsertSubscription, getActiveSubscriptions,
         checkUpcomingRenewals, getMonthlySubscriptionTotal } from '@/lib/agents/zoro/subscription-tracker';
import { getRates, convertToGBP, getMonthlySpendInGBP }      from '@/lib/agents/zoro/currency-manager';
import { getAICostsByAgent, generateAICostReport, recordAICost } from '@/lib/agents/zoro/ai-cost-tracker';
import { exportXeroCSV, getXeroReadinessReport }              from '@/lib/agents/zoro/xero-exporter';
import { runFullDashboardUpdate }                             from '@/lib/agents/zoro/sheets-dashboard';
import { ensureFinanceFolderStructure }                       from '@/lib/agents/zoro/drive-organizer';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type ZoroAction =
  | 'track_cost' | 'generate_report' | 'sync_stripe' | 'generate_invoice'
  | 'check_deadlines' | 'process_reminders'
  | 'monitor_emails' | 'extract_invoice'
  | 'get_providers' | 'get_top_providers'
  | 'add_subscription' | 'get_subscriptions' | 'check_renewals'
  | 'get_rates' | 'get_monthly_spend' | 'convert_currency'
  | 'record_ai_cost' | 'get_ai_costs' | 'ai_cost_report'
  | 'export_xero' | 'xero_readiness'
  | 'update_sheets' | 'setup_drive'
  | 'get_finance_invoices' | 'finance_analysis';

const VALID_ENTITIES   = new Set<Entity>(['KR_GLOBAL_UK', 'MAROC', 'FRANCE']);
const VALID_CATEGORIES = new Set<TransactionCategory>([
  'SAAS', 'IA', 'PUBLICITE', 'FREELANCE',
  'REVENU_STRIPE', 'REVENU_GUMROAD', 'REVENU_AUTRE', 'FRAIS_STRIPE', 'REMBOURSEMENT',
]);

function toEntity(v: unknown): Entity {
  return VALID_ENTITIES.has(v as Entity) ? (v as Entity) : 'KR_GLOBAL_UK';
}

function toCategory(v: unknown): TransactionCategory {
  return VALID_CATEGORIES.has(v as TransactionCategory) ? (v as TransactionCategory) : 'SAAS';
}

export async function zoroNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as ZoroAction) ?? 'generate_report';
  const input  = state.task_input;
  const userMsg = new HumanMessage(`ZORO action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      // ── Legacy actions ────────────────────────────────────────────────────
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
        const now    = new Date();
        const month  = (input['month'] as number) ?? (now.getMonth() + 1);
        const year   = (input['year']  as number) ?? now.getFullYear();
        const report = await generateMonthlyReport(month, year);
        result = { report };
        break;
      }

      case 'generate_invoice': {
        const data: InvoiceData = {
          client:           input['client']             as InvoiceData['client'],
          items:            input['items']              as InvoiceData['items'],
          currency:         (input['currency']          as string) ?? 'GBP',
          issuedAt:         new Date((input['issued_at'] as string) ?? Date.now()),
          dueDays:          (input['due_days']          as number) ?? 30,
          includesIpClause: (input['includes_ip_clause'] as boolean) ?? false,
          vatReverseCharge: (input['vat_reverse_charge'] as boolean) ?? false,
        };
        const invoice = await generateInvoice(data);
        result = { number: invoice.number, r2_url: invoice.r2Url, due_at: invoice.dueAt };
        break;
      }

      case 'sync_stripe': {
        const since  = (input['since'] as string) ? new Date(input['since'] as string) : undefined;
        const synced = await syncStripeTransactions(since);
        result = { synced };
        break;
      }

      case 'check_deadlines': {
        await checkDeadlines();
        const upcoming = await getUpcomingDeadlines((input['days_ahead'] as number) ?? 60);
        result = { upcoming, count: upcoming.length };
        break;
      }

      case 'process_reminders': {
        await processPaymentReminders();
        result = { done: true };
        break;
      }

      // ── Email monitoring ──────────────────────────────────────────────────
      case 'monitor_emails': {
        const monitor = await runEmailMonitor();
        result = { monitor };
        break;
      }

      // ── Invoice extraction ────────────────────────────────────────────────
      case 'extract_invoice': {
        const text      = (input['text'] as string) ?? '';
        const extracted = await extractInvoiceFromText(text);
        result = { extracted };
        break;
      }

      // ── Providers ─────────────────────────────────────────────────────────
      case 'get_providers': {
        const providers = await getProviders(input['category'] as string | undefined);
        result = { providers, count: providers.length };
        break;
      }

      case 'get_top_providers': {
        const top = await getTopProvidersBySpend((input['limit'] as number) ?? 10);
        result = { providers: top };
        break;
      }

      // ── Subscriptions ─────────────────────────────────────────────────────
      case 'add_subscription': {
        const sub = await upsertSubscription({
          provider_name:     input['provider_name']     as string,
          plan_name:         input['plan_name']         as string | undefined,
          amount:            input['amount']            as number,
          currency:          (input['currency']         as string) ?? 'USD',
          billing_frequency: (input['billing_frequency'] as string) ?? 'monthly',
          next_renewal_date: input['next_renewal_date'] as string | undefined,
          category:          (input['category']         as string) ?? 'SaaS',
          notes:             input['notes']             as string | undefined,
        });
        result = { subscription: sub };
        break;
      }

      case 'get_subscriptions': {
        const subs     = await getActiveSubscriptions();
        const monthly  = await getMonthlySubscriptionTotal();
        result = { subscriptions: subs, count: subs.length, monthly_total_gbp: monthly };
        break;
      }

      case 'check_renewals': {
        const upcoming = await checkUpcomingRenewals((input['days_ahead'] as number) ?? 14);
        result = { upcoming, count: upcoming.length };
        break;
      }

      // ── Currency ──────────────────────────────────────────────────────────
      case 'get_rates': {
        const rates = await getRates('GBP');
        result = { base: 'GBP', rates };
        break;
      }

      case 'get_monthly_spend': {
        const spend = await getMonthlySpendInGBP();
        result = { spend };
        break;
      }

      case 'convert_currency': {
        const amount   = (input['amount']   as number) ?? 0;
        const from     = (input['from']     as string) ?? 'USD';
        const gbp      = await convertToGBP(amount, from);
        result = { original: `${amount} ${from}`, gbp };
        break;
      }

      // ── AI costs ──────────────────────────────────────────────────────────
      case 'record_ai_cost': {
        await recordAICost({
          agent_name:    input['agent_name']    as string,
          provider:      (input['provider']     as string) ?? 'openrouter',
          model:         input['model']         as string | undefined,
          tokens_input:  input['tokens_input']  as number | undefined,
          tokens_output: input['tokens_output'] as number | undefined,
          cost_usd:      input['cost_usd']      as number,
          request_count: input['request_count'] as number | undefined,
        });
        result = { recorded: true };
        break;
      }

      case 'get_ai_costs': {
        const by_agent    = await getAICostsByAgent(input['start_date'] as string, input['end_date'] as string);
        result = { by_agent };
        break;
      }

      case 'ai_cost_report': {
        const report = await generateAICostReport(input['month'] as number, input['year'] as number);
        result = { report };
        break;
      }

      // ── Xero ──────────────────────────────────────────────────────────────
      case 'export_xero': {
        const now   = new Date();
        const month = (input['month'] as number) ?? now.getMonth() + 1;
        const year  = (input['year']  as number) ?? now.getFullYear();
        const csv   = await exportXeroCSV(month, year);
        const ready = await getXeroReadinessReport();
        result = { csv: csv.slice(0, 5000), readiness: ready };
        break;
      }

      case 'xero_readiness': {
        const readiness = await getXeroReadinessReport();
        result = { readiness };
        break;
      }

      // ── Sheets & Drive ────────────────────────────────────────────────────
      case 'update_sheets': {
        await runFullDashboardUpdate();
        result = { sheets_updated: true };
        break;
      }

      case 'setup_drive': {
        const folders = await ensureFinanceFolderStructure();
        result = { folders };
        break;
      }

      // ── Finance invoices ──────────────────────────────────────────────────
      case 'get_finance_invoices': {
        const { data, error } = await supabase
          .from('finance_invoices')
          .select('*')
          .order('invoice_date', { ascending: false })
          .limit((input['limit'] as number) ?? 50);
        if (error) throw new Error(error.message);
        result = { invoices: data, count: (data ?? []).length };
        break;
      }

      // ── LLM-powered analysis ──────────────────────────────────────────────
      case 'finance_analysis': {
        const [costs, subs, aiCosts] = await Promise.all([
          getCurrentMonthCosts(),
          getActiveSubscriptions(),
          getAICostsByAgent(),
        ]);
        const context = JSON.stringify({ costs, subscriptions: subs.slice(0, 10), ai_costs: aiCosts });
        const analysis = await zoroChain.invoke({
          context,
          input: (input['question'] as string) ?? 'Analyse les finances de KR Global ce mois et identifie les points d\'attention.',
        });
        result = { analysis, costs, subscriptions_count: subs.length };
        break;
      }

      default: {
        const reasoning = await zoroChainText.invoke({
          context: '',
          input:   `Tâche ZORO : ${JSON.stringify(input)}`,
        });
        result = { reasoning };
      }
    }

    await supabase.from('alerts').insert({
      agent_name: 'ZORO',
      level: 'INFO',
      message: `Action ${action} complétée`,
    });

    return {
      agent_name:  'ZORO',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, new AIMessage(`ZORO completed action=${action}`)],
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur ZORO inconnue';
    void supabase.from('alerts').insert({ agent_name: 'ZORO', level: 'WARNING', message: message.slice(0, 200) });
    return {
      agent_name: 'ZORO',
      status:     'failed',
      error:      message,
      messages:   [userMsg, new AIMessage(`ZORO error: ${message}`)],
    };
  }
}

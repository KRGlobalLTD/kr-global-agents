import { HumanMessage, AIMessage }  from '@langchain/core/messages';
import { createClient }              from '@supabase/supabase-js';
import { type KRGlobalStateType }    from '../state';
import { nagatoChain }               from '@/lib/langchain/chains/nagato-chain';
import { provisionTenant,
         getTenant,
         upgradePlan,
         listTenants }               from '@/lib/agents/nagato/tenant-provisioner';
import { recordUsage,
         getTenantUsage,
         checkUsageLimits }          from '@/lib/agents/nagato/usage-tracker';
import { getPlatformRevenue,
         activateTenant,
         churnTenant }               from '@/lib/agents/nagato/billing-manager';
import { buildPlatformDashboard,
         getChurnRiskTenants }       from '@/lib/agents/nagato/platform-analytics';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type NagatoAction =
  | 'provision_tenant'
  | 'get_tenant'
  | 'upgrade_plan'
  | 'list_tenants'
  | 'activate_tenant'
  | 'churn_tenant'
  | 'record_usage'
  | 'get_usage'
  | 'check_limits'
  | 'get_revenue'
  | 'get_dashboard'
  | 'churn_risk'
  | 'advice';

export async function nagatoNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as NagatoAction) ?? 'get_dashboard';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`NAGATO action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'provision_tenant': {
        const tenant = await provisionTenant({
          company_name:       (input['company_name'] as string),
          owner_email:        (input['owner_email']  as string),
          plan:               (input['plan'] as 'starter' | 'growth' | 'enterprise') ?? 'starter',
          stripe_customer_id: input['stripe_customer_id'] as string | undefined,
        });
        result = { tenant };
        break;
      }

      case 'get_tenant': {
        const tenant = await getTenant(input['tenant_id'] as string);
        result = { tenant };
        break;
      }

      case 'upgrade_plan': {
        await upgradePlan(
          input['tenant_id'] as string,
          (input['plan'] as 'starter' | 'growth' | 'enterprise'),
        );
        result = { upgraded: true };
        break;
      }

      case 'list_tenants': {
        const tenants = await listTenants(input['status'] as string | undefined);
        result = { tenants, count: tenants.length };
        break;
      }

      case 'activate_tenant': {
        await activateTenant(input['tenant_id'] as string);
        result = { activated: true };
        break;
      }

      case 'churn_tenant': {
        await churnTenant(
          input['tenant_id'] as string,
          (input['reason'] as string) ?? 'non renseigne',
        );
        result = { churned: true };
        break;
      }

      case 'record_usage': {
        await recordUsage(
          input['tenant_id']   as string,
          (input['api_calls']   as number) ?? 0,
          (input['agents_used'] as number) ?? 0,
          (input['storage_mb']  as number) ?? 0,
        );
        result = { recorded: true };
        break;
      }

      case 'get_usage': {
        const records = await getTenantUsage(
          input['tenant_id'] as string,
          (input['days'] as number) ?? 30,
        );
        result = { records, count: records.length };
        break;
      }

      case 'check_limits': {
        const limits = await checkUsageLimits(
          input['tenant_id'] as string,
          input['plan']      as string,
        );
        result = limits;
        break;
      }

      case 'get_revenue': {
        const revenue = await getPlatformRevenue();
        result = { revenue };
        break;
      }

      case 'get_dashboard': {
        const dashboard = await buildPlatformDashboard();
        result = { dashboard };
        break;
      }

      case 'churn_risk': {
        const atRisk = await getChurnRiskTenants();
        result = { at_risk: atRisk, count: atRisk.length };
        break;
      }

      case 'advice': {
        const question = (input['question'] as string | undefined) ?? 'Comment accelerer notre croissance SaaS vers 5 000 GBP/mois ?';
        const advice   = await nagatoChain.invoke({ input: question });
        result = { advice };
        break;
      }

      default:
        throw new Error(`Action inconnue : ${action}`);
    }

    void supabase.from('alerts').insert({ agent_name: 'NAGATO', level: 'INFO', message: `${action} OK` });

    return {
      agent_name:  'NAGATO',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [...state.messages, userMsg, new AIMessage(JSON.stringify(result))],
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void supabase.from('alerts').insert({ agent_name: 'NAGATO', level: 'WARNING', message });
    return {
      agent_name: 'NAGATO',
      status:     'failed',
      error:      message,
      messages:   [...state.messages, userMsg],
    };
  }
}

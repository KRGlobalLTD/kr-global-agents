import { HumanMessage, AIMessage }       from '@langchain/core/messages';
import { createClient }                   from '@supabase/supabase-js';
import { type KRGlobalStateType }         from '../state';
import { kabutoChain }                    from '@/lib/langchain/chains/kabuto-chain';
import { setupBrand, activateConfig,
         getConfig, getConfigByPartner,
         listConfigs }                    from '@/lib/agents/kabuto/whitelabel-configurator';
import { provisionClient,
         getClientsByConfig,
         updateClientStatus,
         getWhitelabelStats }             from '@/lib/agents/kabuto/client-provisioner';
import { generateWelcomeEmail,
         generateMonthlyReport }          from '@/lib/agents/kabuto/branding-generator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type KabutoAction =
  | 'setup_brand'
  | 'activate_config'
  | 'get_config'
  | 'list_configs'
  | 'provision_client'
  | 'update_client'
  | 'get_clients'
  | 'generate_welcome'
  | 'generate_report'
  | 'get_stats'
  | 'advice';

export async function kabutoNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as KabutoAction) ?? 'get_stats';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`KABUTO action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'setup_brand': {
        const config = await setupBrand({
          partner_id:    (input['partner_id']    as string),
          brand_name:    (input['brand_name']    as string),
          primary_color: (input['primary_color'] as string | undefined),
          logo_url:      (input['logo_url']      as string | undefined),
          domain:        (input['domain']        as string | undefined),
          email_from:    (input['email_from']    as string | undefined),
        });
        result = { config };
        break;
      }

      case 'activate_config': {
        const configId = input['config_id'] as string | undefined;
        if (!configId) throw new Error('config_id requis');
        await activateConfig(configId);
        result = { activated: true, config_id: configId };
        break;
      }

      case 'get_config': {
        const configId  = input['config_id']  as string | undefined;
        const partnerId = input['partner_id'] as string | undefined;
        if (configId) {
          const config = await getConfig(configId);
          result = { config };
        } else if (partnerId) {
          const configs = await getConfigByPartner(partnerId);
          result = { configs, count: configs.length };
        } else {
          throw new Error('config_id ou partner_id requis');
        }
        break;
      }

      case 'list_configs': {
        const status  = input['status'] as string | undefined;
        const configs = await listConfigs(status);
        result = { configs, count: configs.length };
        break;
      }

      case 'provision_client': {
        const configId    = input['config_id']    as string | undefined;
        const clientName  = input['client_name']  as string | undefined;
        const clientEmail = input['client_email'] as string | undefined;
        const plan        = (input['plan'] as 'starter' | 'growth' | 'enterprise' | undefined) ?? 'starter';
        if (!configId || !clientName || !clientEmail) throw new Error('config_id, client_name et client_email requis');
        const client = await provisionClient({ config_id: configId, client_name: clientName, client_email: clientEmail, plan });
        result = { client };
        break;
      }

      case 'update_client': {
        const clientId = input['client_id'] as string | undefined;
        const status   = input['status']    as 'active' | 'paused' | 'churned' | undefined;
        if (!clientId || !status) throw new Error('client_id et status requis');
        await updateClientStatus(clientId, status);
        result = { updated: true, client_id: clientId, status };
        break;
      }

      case 'get_clients': {
        const configId = input['config_id'] as string | undefined;
        if (!configId) throw new Error('config_id requis');
        const clients = await getClientsByConfig(configId);
        result = { clients, count: clients.length };
        break;
      }

      case 'generate_welcome': {
        const configId    = input['config_id']    as string | undefined;
        const clientName  = input['client_name']  as string | undefined;
        const plan        = (input['plan'] as string | undefined) ?? 'starter';
        if (!configId || !clientName) throw new Error('config_id et client_name requis');
        const config = await getConfig(configId);
        if (!config) throw new Error(`Config ${configId} introuvable`);
        const email = await generateWelcomeEmail(config, clientName, plan);
        result = { email };
        break;
      }

      case 'generate_report': {
        const configId   = input['config_id']   as string | undefined;
        const clientName = input['client_name'] as string | undefined;
        const plan       = (input['plan']       as string | undefined) ?? 'starter';
        const month      = (input['month']      as string | undefined) ?? new Date().toISOString().slice(0, 7);
        const metrics    = (input['metrics']    as Record<string, unknown> | undefined) ?? {};
        if (!configId || !clientName) throw new Error('config_id et client_name requis');
        const config = await getConfig(configId);
        if (!config) throw new Error(`Config ${configId} introuvable`);
        const report = await generateMonthlyReport(config, clientName, plan, month, metrics);
        result = { report };
        break;
      }

      case 'get_stats': {
        const stats = await getWhitelabelStats();
        result = { stats };
        break;
      }

      case 'advice': {
        const question = (input['question'] as string | undefined) ?? "Comment développer notre programme white label ?";
        const advice   = await kabutoChain.invoke({ context: '', input: question });
        result = { advice };
        break;
      }

      default:
        throw new Error(`Action inconnue : ${action}`);
    }

    void supabase.from('alerts').insert({ agent_name: 'KABUTO', level: 'INFO', message: `${action} OK` });

    return {
      agent_name:  'KABUTO',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [...state.messages, userMsg, new AIMessage(JSON.stringify(result))],
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void supabase.from('alerts').insert({ agent_name: 'KABUTO', level: 'WARNING', message });
    return {
      agent_name: 'KABUTO',
      status:     'failed',
      error:      message,
      messages:   [...state.messages, userMsg],
    };
  }
}

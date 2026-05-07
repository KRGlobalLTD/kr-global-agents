import { NextRequest, NextResponse }     from 'next/server';
import { setupBrand, activateConfig,
         getConfig, getConfigByPartner,
         listConfigs }                   from '@/lib/agents/kabuto/whitelabel-configurator';
import { provisionClient,
         getClientsByConfig,
         updateClientStatus,
         getWhitelabelStats }            from '@/lib/agents/kabuto/client-provisioner';
import { generateWelcomeEmail,
         generateMonthlyReport }         from '@/lib/agents/kabuto/branding-generator';

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const action = (body['action'] as string) ?? '';

  try {
    switch (action) {

      case 'setup_brand': {
        const partnerId = body['partner_id'] as string | undefined;
        const brandName = body['brand_name'] as string | undefined;
        if (!brandName) return NextResponse.json({ error: 'brand_name requis' }, { status: 400 });
        const config = await setupBrand({
          partner_id:    partnerId ?? '',
          brand_name:    brandName,
          primary_color: body['primary_color'] as string | undefined,
          logo_url:      body['logo_url']      as string | undefined,
          domain:        body['domain']        as string | undefined,
          email_from:    body['email_from']    as string | undefined,
        });
        return NextResponse.json({ agent_name: 'KABUTO', config });
      }

      case 'activate_config': {
        const configId = body['config_id'] as string | undefined;
        if (!configId) return NextResponse.json({ error: 'config_id requis' }, { status: 400 });
        await activateConfig(configId);
        return NextResponse.json({ agent_name: 'KABUTO', activated: true, config_id: configId });
      }

      case 'get_config': {
        const configId  = body['config_id']  as string | undefined;
        const partnerId = body['partner_id'] as string | undefined;
        if (configId) {
          const config = await getConfig(configId);
          return NextResponse.json({ agent_name: 'KABUTO', config });
        }
        if (partnerId) {
          const configs = await getConfigByPartner(partnerId);
          return NextResponse.json({ agent_name: 'KABUTO', configs, count: configs.length });
        }
        return NextResponse.json({ error: 'config_id ou partner_id requis' }, { status: 400 });
      }

      case 'provision_client': {
        const configId    = body['config_id']    as string | undefined;
        const clientName  = body['client_name']  as string | undefined;
        const clientEmail = body['client_email'] as string | undefined;
        const plan        = (body['plan'] as 'starter' | 'growth' | 'enterprise' | undefined) ?? 'starter';
        if (!configId || !clientName || !clientEmail) return NextResponse.json({ error: 'config_id, client_name et client_email requis' }, { status: 400 });
        const client = await provisionClient({ config_id: configId, client_name: clientName, client_email: clientEmail, plan });
        return NextResponse.json({ agent_name: 'KABUTO', client });
      }

      case 'update_client': {
        const clientId = body['client_id'] as string | undefined;
        const status   = body['status']    as 'active' | 'paused' | 'churned' | undefined;
        if (!clientId || !status) return NextResponse.json({ error: 'client_id et status requis' }, { status: 400 });
        await updateClientStatus(clientId, status);
        return NextResponse.json({ agent_name: 'KABUTO', updated: true });
      }

      case 'get_clients': {
        const configId = body['config_id'] as string | undefined;
        if (!configId) return NextResponse.json({ error: 'config_id requis' }, { status: 400 });
        const clients = await getClientsByConfig(configId);
        return NextResponse.json({ agent_name: 'KABUTO', clients, count: clients.length });
      }

      case 'generate_welcome': {
        const configId   = body['config_id']   as string | undefined;
        const clientName = body['client_name'] as string | undefined;
        const plan       = (body['plan']       as string | undefined) ?? 'starter';
        if (!configId || !clientName) return NextResponse.json({ error: 'config_id et client_name requis' }, { status: 400 });
        const config = await getConfig(configId);
        if (!config) return NextResponse.json({ error: `Config ${configId} introuvable` }, { status: 404 });
        const email = await generateWelcomeEmail(config, clientName, plan);
        return NextResponse.json({ agent_name: 'KABUTO', email });
      }

      case 'generate_report': {
        const configId   = body['config_id']   as string | undefined;
        const clientName = body['client_name'] as string | undefined;
        const plan       = (body['plan']       as string | undefined) ?? 'starter';
        const month      = (body['month']      as string | undefined) ?? new Date().toISOString().slice(0, 7);
        const metrics    = (body['metrics']    as Record<string, unknown> | undefined) ?? {};
        if (!configId || !clientName) return NextResponse.json({ error: 'config_id et client_name requis' }, { status: 400 });
        const config = await getConfig(configId);
        if (!config) return NextResponse.json({ error: `Config ${configId} introuvable` }, { status: 404 });
        const report = await generateMonthlyReport(config, clientName, plan, month, metrics);
        return NextResponse.json({ agent_name: 'KABUTO', report });
      }

      case 'get_stats': {
        const stats = await getWhitelabelStats();
        return NextResponse.json({ agent_name: 'KABUTO', stats });
      }

      default:
        return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });
    }

  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const url    = new URL(req.url);
  const type   = url.searchParams.get('type') ?? 'stats';
  const status = url.searchParams.get('status') ?? undefined;

  try {
    if (type === 'stats') {
      const stats = await getWhitelabelStats();
      return NextResponse.json({ agent_name: 'KABUTO', stats });
    }
    if (type === 'configs') {
      const configs = await listConfigs(status);
      return NextResponse.json({ agent_name: 'KABUTO', configs, count: configs.length });
    }
    return NextResponse.json({ error: `Type inconnu : ${type}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

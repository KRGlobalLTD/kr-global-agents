import { NextRequest, NextResponse } from 'next/server';
import { provisionTenant,
         getTenant,
         upgradePlan,
         listTenants }              from '@/lib/agents/nagato/tenant-provisioner';
import { recordUsage,
         getTenantUsage,
         checkUsageLimits }         from '@/lib/agents/nagato/usage-tracker';
import { getPlatformRevenue,
         activateTenant,
         churnTenant }              from '@/lib/agents/nagato/billing-manager';
import { buildPlatformDashboard,
         getChurnRiskTenants }      from '@/lib/agents/nagato/platform-analytics';

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const action = (body['action'] as string) ?? '';

  try {
    switch (action) {

      case 'provision_tenant': {
        if (!body['company_name'] || !body['owner_email']) {
          return NextResponse.json({ error: 'company_name et owner_email requis' }, { status: 400 });
        }
        const tenant = await provisionTenant({
          company_name:       body['company_name'] as string,
          owner_email:        body['owner_email']  as string,
          plan:               (body['plan'] as 'starter' | 'growth' | 'enterprise') ?? 'starter',
          stripe_customer_id: body['stripe_customer_id'] as string | undefined,
        });
        return NextResponse.json({ agent_name: 'NAGATO', tenant });
      }

      case 'get_tenant': {
        const tenant = await getTenant(body['tenant_id'] as string);
        return NextResponse.json({ agent_name: 'NAGATO', tenant });
      }

      case 'upgrade_plan': {
        await upgradePlan(
          body['tenant_id'] as string,
          body['plan'] as 'starter' | 'growth' | 'enterprise',
        );
        return NextResponse.json({ agent_name: 'NAGATO', upgraded: true });
      }

      case 'list_tenants': {
        const tenants = await listTenants(body['status'] as string | undefined);
        return NextResponse.json({ agent_name: 'NAGATO', tenants, count: tenants.length });
      }

      case 'activate_tenant': {
        await activateTenant(body['tenant_id'] as string);
        return NextResponse.json({ agent_name: 'NAGATO', activated: true });
      }

      case 'churn_tenant': {
        await churnTenant(
          body['tenant_id'] as string,
          (body['reason'] as string) ?? 'non renseigne',
        );
        return NextResponse.json({ agent_name: 'NAGATO', churned: true });
      }

      case 'record_usage': {
        await recordUsage(
          body['tenant_id']   as string,
          (body['api_calls']   as number) ?? 0,
          (body['agents_used'] as number) ?? 0,
          (body['storage_mb']  as number) ?? 0,
        );
        return NextResponse.json({ agent_name: 'NAGATO', recorded: true });
      }

      case 'get_usage': {
        const records = await getTenantUsage(
          body['tenant_id'] as string,
          (body['days'] as number) ?? 30,
        );
        return NextResponse.json({ agent_name: 'NAGATO', records, count: records.length });
      }

      case 'check_limits': {
        const limits = await checkUsageLimits(
          body['tenant_id'] as string,
          body['plan']      as string,
        );
        return NextResponse.json({ agent_name: 'NAGATO', ...limits });
      }

      case 'get_revenue': {
        const revenue = await getPlatformRevenue();
        return NextResponse.json({ agent_name: 'NAGATO', revenue });
      }

      case 'get_dashboard': {
        const dashboard = await buildPlatformDashboard();
        return NextResponse.json({ agent_name: 'NAGATO', dashboard });
      }

      case 'churn_risk': {
        const atRisk = await getChurnRiskTenants();
        return NextResponse.json({ agent_name: 'NAGATO', at_risk: atRisk, count: atRisk.length });
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
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 });
  }

  const url  = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'dashboard';

  try {
    if (type === 'dashboard') {
      const dashboard = await buildPlatformDashboard();
      return NextResponse.json({ agent_name: 'NAGATO', dashboard });
    }
    if (type === 'revenue') {
      const revenue = await getPlatformRevenue();
      return NextResponse.json({ agent_name: 'NAGATO', revenue });
    }
    if (type === 'tenants') {
      const tenants = await listTenants(url.searchParams.get('status') ?? undefined);
      return NextResponse.json({ agent_name: 'NAGATO', tenants, count: tenants.length });
    }
    if (type === 'churn_risk') {
      const atRisk = await getChurnRiskTenants();
      return NextResponse.json({ agent_name: 'NAGATO', at_risk: atRisk, count: atRisk.length });
    }
    return NextResponse.json({ error: `Type inconnu : ${type}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

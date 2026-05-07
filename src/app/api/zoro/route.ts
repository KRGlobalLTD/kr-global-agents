import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ── Existing modules ─────────────────────────────────────────────────────────
import { syncStripeTransactions, handleStripeWebhookEvent } from '@/lib/agents/zoro/stripe-sync';
import type { StripeChargeEvent }                           from '@/lib/agents/zoro/stripe-sync';
import { sendMonthlyReport, generateMonthlyReport }        from '@/lib/agents/zoro/report-generator';
import { getCurrentMonthCosts }                            from '@/lib/agents/zoro/cost-tracker';
import type { Entity }                                     from '@/lib/agents/zoro/cost-tracker';
import { processPaymentReminders, markInvoicePaid }        from '@/lib/agents/zoro/payment-reminder';
import { checkDeadlines, getUpcomingDeadlines }            from '@/lib/agents/zoro/uk-deadlines';

// ── New finance-ops modules ───────────────────────────────────────────────────
import { runEmailMonitor }                              from '@/lib/agents/zoro/email-monitor';
import { extractInvoiceFromText }                       from '@/lib/agents/zoro/invoice-extractor';
import { getProviders, getTopProvidersBySpend }         from '@/lib/agents/zoro/provider-registry';
import { upsertSubscription, getActiveSubscriptions,
         checkUpcomingRenewals, cancelSubscription,
         getMonthlySubscriptionTotal }                  from '@/lib/agents/zoro/subscription-tracker';
import { getRates, convertToGBP, getMonthlySpendInGBP } from '@/lib/agents/zoro/currency-manager';
import { getAICostsByAgent, generateAICostReport,
         getAICostsByProvider, recordAICost }           from '@/lib/agents/zoro/ai-cost-tracker';
import { exportXeroCSV, getXeroReadinessReport }        from '@/lib/agents/zoro/xero-exporter';
import { runFullDashboardUpdate }                       from '@/lib/agents/zoro/sheets-dashboard';
import { ensureFinanceFolderStructure }                 from '@/lib/agents/zoro/drive-organizer';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Auth ──────────────────────────────────────────────────────────────────────

function verifyInternalToken(request: NextRequest): boolean {
  return request.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

function verifyStripeSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return false;
  const tPart  = signature.split(',').find(p => p.startsWith('t='));
  const v1Part = signature.split(',').find(p => p.startsWith('v1='));
  if (!tPart || !v1Part) return false;
  const timestamp   = tPart.slice(2);
  const received    = v1Part.slice(3);
  const expected    = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex')); }
  catch { return false; }
}

function isValidEntity(v: string | undefined): v is Entity {
  return v === 'KR_GLOBAL_UK' || v === 'MAROC' || v === 'FRANCE';
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Stripe webhook
  const stripeSig = request.headers.get('stripe-signature');
  if (stripeSig) {
    const raw = await request.text();
    if (!verifyStripeSignature(raw, stripeSig)) {
      return NextResponse.json({ error: 'Signature Stripe invalide' }, { status: 400 });
    }
    let event: StripeChargeEvent;
    try { event = JSON.parse(raw) as StripeChargeEvent; }
    catch { return NextResponse.json({ error: 'Webhook invalide' }, { status: 400 }); }
    try {
      await handleStripeWebhookEvent(event);
      void supabase.from('alerts').insert({ agent_name: 'ZORO', level: 'INFO', message: `Webhook Stripe : ${event.type}` });
      return NextResponse.json({ received: true });
    } catch (err) {
      void supabase.from('alerts').insert({ agent_name: 'ZORO', level: 'WARNING', message: `Webhook Stripe erreur : ${event.type}` });
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const action = (body['action'] as string) ?? '';

  try {
    switch (action) {

      // ── Legacy actions ────────────────────────────────────────────────────
      case 'sync_stripe': {
        const since  = body['since'] ? new Date(body['since'] as string) : undefined;
        const result = await syncStripeTransactions(since);
        return NextResponse.json({ agent_name: 'ZORO', result });
      }

      case 'generate_report': {
        const now   = new Date();
        const month = typeof body['month'] === 'number' ? body['month'] : now.getMonth() + 1;
        const year  = typeof body['year']  === 'number' ? body['year']  : now.getFullYear();
        await sendMonthlyReport();
        const report = await generateMonthlyReport(month, year);
        return NextResponse.json({ agent_name: 'ZORO', report });
      }

      case 'get_costs': {
        const entity = isValidEntity(body['entity'] as string | undefined) ? (body['entity'] as Entity) : undefined;
        const costs  = await getCurrentMonthCosts(entity);
        return NextResponse.json({ agent_name: 'ZORO', costs });
      }

      case 'process_reminders': {
        await processPaymentReminders();
        return NextResponse.json({ agent_name: 'ZORO', done: true });
      }

      case 'mark_paid': {
        const number = body['invoice_number'] as string | undefined;
        if (!number) return NextResponse.json({ error: 'invoice_number requis' }, { status: 400 });
        await markInvoicePaid(number);
        return NextResponse.json({ agent_name: 'ZORO', marked_paid: number });
      }

      case 'check_deadlines': {
        await checkDeadlines();
        const upcoming = await getUpcomingDeadlines((body['days_ahead'] as number) ?? 60);
        return NextResponse.json({ agent_name: 'ZORO', upcoming });
      }

      // ── Email monitoring ──────────────────────────────────────────────────
      case 'monitor_emails': {
        const result = await runEmailMonitor();
        return NextResponse.json({ agent_name: 'ZORO', monitor: result });
      }

      // ── Manual invoice extraction ─────────────────────────────────────────
      case 'extract_invoice': {
        const text = body['text'] as string | undefined;
        if (!text) return NextResponse.json({ error: 'text requis' }, { status: 400 });
        const extracted = await extractInvoiceFromText(text);
        return NextResponse.json({ agent_name: 'ZORO', extracted });
      }

      // ── Provider management ───────────────────────────────────────────────
      case 'get_providers': {
        const category  = body['category'] as string | undefined;
        const providers = await getProviders(category);
        return NextResponse.json({ agent_name: 'ZORO', providers, count: providers.length });
      }

      case 'get_top_providers': {
        const limit = (body['limit'] as number) ?? 10;
        const top   = await getTopProvidersBySpend(limit);
        return NextResponse.json({ agent_name: 'ZORO', providers: top });
      }

      // ── Subscriptions ─────────────────────────────────────────────────────
      case 'add_subscription': {
        const sub = await upsertSubscription({
          provider_name:     body['provider_name'] as string,
          plan_name:         body['plan_name']     as string | undefined,
          amount:            body['amount']        as number,
          currency:          (body['currency']     as string) ?? 'USD',
          billing_frequency: (body['billing_frequency'] as string) ?? 'monthly',
          next_renewal_date: body['next_renewal_date'] as string | undefined,
          category:          (body['category']     as string) ?? 'SaaS',
          notes:             body['notes']         as string | undefined,
        });
        return NextResponse.json({ agent_name: 'ZORO', subscription: sub });
      }

      case 'get_subscriptions': {
        const subs  = await getActiveSubscriptions();
        const total = await getMonthlySubscriptionTotal();
        const upcoming = await checkUpcomingRenewals(14);
        return NextResponse.json({ agent_name: 'ZORO', subscriptions: subs, monthly_total_gbp: total, upcoming_renewals: upcoming });
      }

      case 'cancel_subscription': {
        const id = body['id'] as string | undefined;
        if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });
        await cancelSubscription(id);
        return NextResponse.json({ agent_name: 'ZORO', cancelled: id });
      }

      // ── Currency ──────────────────────────────────────────────────────────
      case 'get_rates': {
        const rates = await getRates('GBP');
        return NextResponse.json({ agent_name: 'ZORO', base: 'GBP', rates });
      }

      case 'get_monthly_spend': {
        const spend = await getMonthlySpendInGBP();
        return NextResponse.json({ agent_name: 'ZORO', spend });
      }

      // ── AI cost tracking ──────────────────────────────────────────────────
      case 'record_ai_cost': {
        await recordAICost({
          agent_name:    body['agent_name']    as string,
          provider:      (body['provider']     as string) ?? 'openrouter',
          model:         body['model']         as string | undefined,
          tokens_input:  body['tokens_input']  as number | undefined,
          tokens_output: body['tokens_output'] as number | undefined,
          cost_usd:      body['cost_usd']      as number,
          request_count: body['request_count'] as number | undefined,
        });
        return NextResponse.json({ agent_name: 'ZORO', recorded: true });
      }

      case 'get_ai_costs': {
        const summary = await getAICostsByAgent(body['start_date'] as string, body['end_date'] as string);
        const byProvider = await getAICostsByProvider(body['start_date'] as string);
        return NextResponse.json({ agent_name: 'ZORO', by_agent: summary, by_provider: byProvider });
      }

      case 'ai_cost_report': {
        const report = await generateAICostReport(body['month'] as number, body['year'] as number);
        return NextResponse.json({ agent_name: 'ZORO', report });
      }

      // ── Xero export ───────────────────────────────────────────────────────
      case 'export_xero': {
        const now   = new Date();
        const month = (body['month'] as number) ?? now.getMonth() + 1;
        const year  = (body['year']  as number) ?? now.getFullYear();
        const csv       = await exportXeroCSV(month, year);
        const readiness = await getXeroReadinessReport();
        return NextResponse.json({ agent_name: 'ZORO', csv, readiness, month, year });
      }

      case 'xero_readiness': {
        const readiness = await getXeroReadinessReport();
        return NextResponse.json({ agent_name: 'ZORO', readiness });
      }

      // ── Google Sheets ─────────────────────────────────────────────────────
      case 'update_sheets': {
        await runFullDashboardUpdate();
        return NextResponse.json({ agent_name: 'ZORO', sheets_updated: true });
      }

      // ── Google Drive ──────────────────────────────────────────────────────
      case 'setup_drive': {
        const folders = await ensureFinanceFolderStructure();
        return NextResponse.json({ agent_name: 'ZORO', folders });
      }

      // ── Finance invoices list ─────────────────────────────────────────────
      case 'get_finance_invoices': {
        const limit    = (body['limit']    as number)  ?? 50;
        const category = body['category'] as string | undefined;
        let q = supabase.from('finance_invoices').select('*').order('invoice_date', { ascending: false }).limit(limit);
        if (category) q = q.eq('category', category);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return NextResponse.json({ agent_name: 'ZORO', invoices: data, count: (data ?? []).length });
      }

      default:
        return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur ZORO inconnue';
    void supabase.from('alerts').insert({ agent_name: 'ZORO', level: 'URGENT', message: `API error action=${action} : ${message.slice(0, 200)}` });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') ?? 'costs';

  try {
    if (type === 'subscriptions') {
      const subs  = await getActiveSubscriptions();
      const total = await getMonthlySubscriptionTotal();
      return NextResponse.json({ agent_name: 'ZORO', subscriptions: subs, monthly_total_gbp: total });
    }

    if (type === 'ai_costs') {
      const costs = await getAICostsByAgent();
      return NextResponse.json({ agent_name: 'ZORO', ai_costs: costs });
    }

    if (type === 'providers') {
      const providers = await getProviders();
      return NextResponse.json({ agent_name: 'ZORO', providers });
    }

    if (type === 'renewals') {
      const upcoming = await checkUpcomingRenewals(30);
      return NextResponse.json({ agent_name: 'ZORO', upcoming_renewals: upcoming });
    }

    if (type === 'xero_ready') {
      const readiness = await getXeroReadinessReport();
      return NextResponse.json({ agent_name: 'ZORO', readiness });
    }

    // Default: current month costs
    const costs = await getCurrentMonthCosts();
    const spend = await getMonthlySpendInGBP();
    return NextResponse.json({ agent_name: 'ZORO', costs, monthly_spend_gbp: spend });

  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

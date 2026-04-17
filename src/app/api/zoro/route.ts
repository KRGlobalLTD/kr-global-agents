import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncStripeTransactions, handleStripeWebhookEvent } from '@/lib/agents/zoro/stripe-sync';
import type { StripeChargeEvent } from '@/lib/agents/zoro/stripe-sync';
import { sendMonthlyReport, generateMonthlyReport } from '@/lib/agents/zoro/report-generator';
import { getCurrentMonthCosts } from '@/lib/agents/zoro/cost-tracker';
import type { Entity } from '@/lib/agents/zoro/cost-tracker';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Auth ----

function verifyInternalToken(request: NextRequest): boolean {
  return request.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

function verifyStripeSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return false;

  const tPart  = signature.split(',').find((p) => p.startsWith('t='));
  const v1Part = signature.split(',').find((p) => p.startsWith('v1='));
  if (!tPart || !v1Part) return false;

  const timestamp    = tPart.slice(2);
  const receivedSig  = v1Part.slice(3);
  const expectedSig  = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSig, 'hex'),
      Buffer.from(receivedSig, 'hex')
    );
  } catch {
    return false;
  }
}

// ---- Payload types ----

type ActionPayload =
  | { action: 'sync_stripe'; since?: string }
  | { action: 'generate_report'; month?: number; year?: number }
  | { action: 'get_costs'; entity?: string };

function isValidEntity(value: string | undefined): value is Entity {
  return value === 'KR_GLOBAL_UK' || value === 'MAROC' || value === 'FRANCE';
}

// ---- Route ----

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Stripe webhook (identifié par l'en-tête stripe-signature)
  const stripeSignature = request.headers.get('stripe-signature');

  if (stripeSignature) {
    const rawBody = await request.text();

    if (!verifyStripeSignature(rawBody, stripeSignature)) {
      return NextResponse.json({ error: 'Signature Stripe invalide' }, { status: 400 });
    }

    let event: StripeChargeEvent;
    try {
      event = JSON.parse(rawBody) as StripeChargeEvent;
    } catch {
      return NextResponse.json({ error: 'Corps de webhook invalide' }, { status: 400 });
    }

    try {
      await handleStripeWebhookEvent(event);
      await supabase.from('alerts').insert({
        agent_name: 'ZORO',
        level: 'INFO',
        message: `Webhook Stripe reçu : ${event.type}`,
      });
      return NextResponse.json({ received: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur interne';
      await supabase.from('alerts').insert({
        agent_name: 'ZORO',
        level: 'WARNING',
        message: `Erreur traitement webhook Stripe : ${event.type}`,
      });
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Requête interne standard
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: ActionPayload;
  try {
    body = (await request.json()) as ActionPayload;
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'sync_stripe': {
        const since = body.since ? new Date(body.since) : undefined;
        const result = await syncStripeTransactions(since);
        await supabase.from('alerts').insert({
          agent_name: 'ZORO',
          level: 'INFO',
          message: 'Sync Stripe manuel déclenché',
        });
        return NextResponse.json({ success: true, result });
      }

      case 'generate_report': {
        const now   = new Date();
        const month = typeof body.month === 'number' ? body.month : now.getMonth() + 1;
        const year  = typeof body.year  === 'number' ? body.year  : now.getFullYear();
        await sendMonthlyReport();
        const report = await generateMonthlyReport(month, year);
        return NextResponse.json({ success: true, report });
      }

      case 'get_costs': {
        const entity = isValidEntity(body.entity) ? body.entity : undefined;
        const costs  = await getCurrentMonthCosts(entity);
        return NextResponse.json({ success: true, costs });
      }

      default: {
        return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';

    try {
      await supabase.from('alerts').insert({
        agent_name: 'ZORO',
        level: 'URGENT',
        message: `Erreur API ZORO : action=${body.action}`,
      });
    } catch {
      // log silencieux — ne pas masquer l'erreur principale
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

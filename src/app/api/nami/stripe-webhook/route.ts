import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { triggerOnboarding } from '@/lib/agents/nami/onboarding-flow';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Vérification signature Stripe (HMAC-SHA256) ----

function verifyStripeSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.NAMI_STRIPE_WEBHOOK_SECRET;
  if (!secret) return false;

  const tPart  = signature.split(',').find((p) => p.startsWith('t='));
  const v1Part = signature.split(',').find((p) => p.startsWith('v1='));
  if (!tPart || !v1Part) return false;

  const timestamp   = tPart.slice(2);
  const receivedSig = v1Part.slice(3);

  const expectedSig = crypto
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

// ---- Types Stripe Webhook ----

interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      [key: string]: unknown;
    };
  };
}

// ---- Handler ----

export async function POST(request: NextRequest): Promise<NextResponse> {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'En-tête stripe-signature manquant' }, { status: 400 });
  }

  const rawBody = await request.text();

  if (!verifyStripeSignature(rawBody, signature)) {
    await supabase.from('alerts').insert({
      agent_name: 'NAMI',
      level: 'WARNING',
      message: 'Webhook Stripe rejeté : signature invalide',
    });
    return NextResponse.json({ error: 'Signature invalide' }, { status: 400 });
  }

  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(rawBody) as StripeWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  // Seul payment_intent.succeeded déclenche l'onboarding
  if (event.type !== 'payment_intent.succeeded') {
    return NextResponse.json({ received: true, skipped: true });
  }

  const paymentIntentId = event.data.object.id;

  try {
    await triggerOnboarding(paymentIntentId);

    return NextResponse.json({
      received: true,
      paymentIntentId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';

    await supabase.from('alerts').insert({
      agent_name: 'NAMI',
      level: 'URGENT',
      message: `Erreur onboarding webhook ${paymentIntentId} : ${message.slice(0, 200)}`,
    });

    // Retourner 200 pour éviter les relivraisons Stripe en boucle
    // L'erreur est loggée et traitée en alerte
    return NextResponse.json({ received: true, error: message }, { status: 200 });
  }
}

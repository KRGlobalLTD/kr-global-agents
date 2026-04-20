import { createClient } from '@supabase/supabase-js';
import { sendWelcomeEmail, type NamiClient } from './email-templates';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types Stripe (API REST directe) ----

interface StripeAddress {
  country: string | null;
}

interface StripePaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  customer: string | null;
  receipt_email: string | null;
  description: string | null;
  metadata: Record<string, string>;
}

interface StripeCustomer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: StripeAddress | null;
  metadata: Record<string, string>;
}

// ---- Helper Stripe ----

async function stripeGet<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.STRIPE_SECRET_KEY}:`).toString('base64')}`,
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Stripe GET ${path} → ${response.status}: ${err}`);
  }

  return response.json() as Promise<T>;
}

// ---- Résolution des données client ----

interface ClientInsert {
  stripe_customer_id: string | null;
  stripe_payment_id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  country: string | null;
  product: string | null;
  amount_paid: number;
  currency: string;
}

async function resolveClientData(pi: StripePaymentIntent): Promise<ClientInsert> {
  let customer: StripeCustomer | null = null;

  if (pi.customer) {
    customer = await stripeGet<StripeCustomer>(`/customers/${pi.customer}`);
  }

  // Priorité : Customer > metadata > receipt_email
  const name =
    customer?.name ??
    pi.metadata['name'] ??
    pi.metadata['client_name'] ??
    'Client';

  const email =
    customer?.email ??
    pi.receipt_email ??
    pi.metadata['email'] ??
    '';

  if (!email) {
    throw new Error(`Aucun email trouvé pour le paiement ${pi.id}`);
  }

  return {
    stripe_customer_id: customer?.id ?? null,
    stripe_payment_id:  pi.id,
    name,
    email,
    phone:    customer?.phone ?? pi.metadata['phone'] ?? null,
    company:  customer?.metadata['company'] ?? pi.metadata['company'] ?? null,
    country:  customer?.address?.country ?? pi.metadata['country'] ?? null,
    product:  pi.description ?? pi.metadata['product'] ?? null,
    amount_paid: pi.amount / 100,
    currency:    pi.currency.toUpperCase(),
  };
}

// ---- Upsert client en base ----

async function upsertClient(
  data: ClientInsert
): Promise<{ client: NamiClient; isNew: boolean }> {
  // Vérification idempotente : déjà onboardé ?
  const { data: existing } = await supabase
    .from('clients')
    .select('id, name, email, company, product, amount_paid, currency, onboarded_at, email_welcome_sent')
    .eq('stripe_payment_id', data.stripe_payment_id)
    .maybeSingle();

  if (existing) {
    return {
      client: existing as NamiClient,
      isNew:  false,
    };
  }

  const now = new Date().toISOString();

  const { data: inserted, error } = await supabase
    .from('clients')
    .insert({
      ...data,
      onboarded_at:   now,
      last_active_at: now,
      status:         'ACTIVE',
    })
    .select('id, name, email, company, product, amount_paid, currency, onboarded_at')
    .single();

  if (error) throw new Error(`Erreur création client : ${error.message}`);

  return {
    client: inserted as NamiClient,
    isNew:  true,
  };
}

// ---- Point d'entrée principal ----

export async function triggerOnboarding(paymentIntentId: string): Promise<void> {
  // 1. Récupérer le PaymentIntent
  const pi = await stripeGet<StripePaymentIntent>(`/payment_intents/${paymentIntentId}`);

  if (pi.status !== 'succeeded') {
    await supabase.from('alerts').insert({
      agent_name: 'NAMI',
      level: 'INFO',
      message: `Onboarding ignoré : payment_intent ${paymentIntentId} status=${pi.status}`,
    });
    return;
  }

  // 2. Résoudre les données client
  const clientData = await resolveClientData(pi);

  // 3. Upsert en base
  const { client, isNew } = await upsertClient(clientData);

  if (!isNew && (client as unknown as Record<string, unknown>)['email_welcome_sent']) {
    // Webhook dupliqué, déjà traité
    await supabase.from('alerts').insert({
      agent_name: 'NAMI',
      level: 'INFO',
      message: `Onboarding ignoré (doublon) : payment_intent ${paymentIntentId}`,
    });
    return;
  }

  // 4. Email de bienvenue J+0
  await sendWelcomeEmail(client);

  await supabase.from('alerts').insert({
    agent_name: 'NAMI',
    level: 'INFO',
    message: `Onboarding déclenché : client=${client.email} produit=${client.product ?? 'N/A'} montant=${clientData.amount_paid.toFixed(2)} ${clientData.currency}`,
  });
}

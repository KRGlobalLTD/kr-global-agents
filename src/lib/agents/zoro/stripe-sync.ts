import { createClient } from '@supabase/supabase-js';
import { trackExpense } from './cost-tracker';
import type { Entity, TransactionCategory } from './cost-tracker';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- Types Stripe (API REST directe, sans SDK) ---

interface StripeBalanceTx {
  id: string;
  amount: number;
  currency: string;
  created: number;
  type: string;
  description: string | null;
  reporting_category: string;
  fee: number;
  net: number;
}

interface StripeListResponse {
  object: string;
  data: StripeBalanceTx[];
  has_more: boolean;
}

export interface StripeChargeEvent {
  type: string;
  data: {
    object: {
      id: string;
      amount: number;
      currency: string;
      created: number;
      description: string | null;
      balance_transaction: string | null;
    };
  };
}

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: number;
}

// ---- Helpers ----

function toEuros(amount: number, currency: string): number {
  const zeroDecimal = ['jpy', 'krw', 'vnd', 'bif', 'clp', 'gnf', 'mga', 'pyg', 'rwf', 'ugx', 'xaf', 'xof'];
  return zeroDecimal.includes(currency.toLowerCase()) ? amount : amount / 100;
}

function classifyTransaction(tx: StripeBalanceTx): { category: TransactionCategory; entity: Entity } {
  const entity: Entity = 'KR_GLOBAL_UK';

  switch (tx.reporting_category) {
    case 'charge':
    case 'payment':
      return { category: 'REVENU_STRIPE', entity };
    case 'refund':
      return { category: 'REMBOURSEMENT', entity };
    case 'stripe_fee':
    case 'fee':
      return { category: 'FRAIS_STRIPE', entity };
    default:
      return { category: 'REVENU_STRIPE', entity };
  }
}

async function fetchPage(sinceTimestamp: number, startingAfter?: string): Promise<StripeListResponse> {
  const params = new URLSearchParams({
    limit: '100',
    'created[gte]': String(sinceTimestamp),
  });

  if (startingAfter) params.set('starting_after', startingAfter);

  const response = await fetch(
    `https://api.stripe.com/v1/balance_transactions?${params.toString()}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.STRIPE_SECRET_KEY}:`).toString('base64')}`,
      },
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Stripe API ${response.status} : ${err}`);
  }

  return response.json() as Promise<StripeListResponse>;
}

// ---- Exports ----

export async function syncStripeTransactions(since?: Date): Promise<SyncResult> {
  const sinceTs = since
    ? Math.floor(since.getTime() / 1000)
    : Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60; // 30 derniers jours par défaut

  let synced = 0;
  let skipped = 0;
  let errors = 0;
  let startingAfter: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await fetchPage(sinceTs, startingAfter);

    for (const tx of page.data) {
      try {
        const { category, entity } = classifyTransaction(tx);
        const amount = toEuros(Math.abs(tx.amount), tx.currency);

        await trackExpense({
          date: new Date(tx.created * 1000),
          amount,
          currency: tx.currency.toUpperCase(),
          category,
          entity,
          source: 'STRIPE',
          description: tx.description ?? tx.type,
          stripeId: tx.id,
        });

        synced++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('23505') || msg.includes('déjà enregistrée')) {
          skipped++;
        } else {
          errors++;
          await supabase.from('alerts').insert({
            agent_name: 'ZORO',
            level: 'WARNING',
            message: `Erreur sync transaction Stripe (type=${tx.type})`,
          });
        }
      }
    }

    hasMore = page.has_more;
    if (hasMore && page.data.length > 0) {
      startingAfter = page.data[page.data.length - 1].id;
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Sync Stripe terminé : ${synced} enregistrées, ${skipped} ignorées, ${errors} erreurs`,
  });

  return { synced, skipped, errors };
}

export async function handleStripeWebhookEvent(event: StripeChargeEvent): Promise<void> {
  const supported = ['charge.succeeded', 'charge.refunded', 'payment_intent.succeeded'];
  if (!supported.includes(event.type)) return;

  const obj = event.data.object;
  const isRefund = event.type === 'charge.refunded';

  await trackExpense({
    date: new Date(obj.created * 1000),
    amount: toEuros(obj.amount, obj.currency),
    currency: obj.currency.toUpperCase(),
    category: isRefund ? 'REMBOURSEMENT' : 'REVENU_STRIPE',
    entity: 'KR_GLOBAL_UK',
    source: 'STRIPE_WEBHOOK',
    description: obj.description ?? event.type,
    stripeId: obj.id,
  });
}

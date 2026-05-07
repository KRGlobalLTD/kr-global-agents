import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface Subscription {
  id:                string;
  provider_name:     string;
  plan_name:         string | null;
  amount:            number;
  currency:          string;
  billing_frequency: string;
  next_renewal_date: string | null;
  last_billed_date:  string | null;
  status:            'active' | 'cancelled' | 'paused' | 'trial';
  category:          string;
  notes:             string | null;
}

export interface SubscriptionInput {
  provider_name:     string;
  plan_name?:        string;
  amount:            number;
  currency:          string;
  billing_frequency: string;
  next_renewal_date?: string;
  category:          string;
  notes?:            string;
}

export async function upsertSubscription(input: SubscriptionInput): Promise<Subscription> {
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('provider_name', input.provider_name)
    .eq('status', 'active')
    .maybeSingle();

  if (existing) {
    const prevAmount = existing.amount as number;
    const newAmount  = input.amount;

    // Alert on price increase > 10%
    if (newAmount > prevAmount * 1.10) {
      void supabase.from('alerts').insert({
        agent_name: 'ZORO',
        level: 'WARNING',
        message: `Hausse tarifaire détectée : ${input.provider_name} ${prevAmount}→${newAmount} ${input.currency} (+${(((newAmount-prevAmount)/prevAmount)*100).toFixed(1)}%)`,
      });

      const text = `⚠️ *ZORO — Hausse abonnement ${input.provider_name}*\n${prevAmount}→${newAmount} ${input.currency}/mois (+${(((newAmount-prevAmount)/prevAmount)*100).toFixed(1)}%)`;
      void fetch(process.env.SLACK_WEBHOOK_DEPENSES!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, username: 'ZORO', icon_emoji: ':credit_card:' }),
      });
    }

    const { data } = await supabase
      .from('subscriptions')
      .update({
        amount:            newAmount,
        last_billed_date:  new Date().toISOString().split('T')[0],
        next_renewal_date: input.next_renewal_date ?? existing.next_renewal_date,
        updated_at:        new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();
    return data as Subscription;
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .insert({
      provider_name:     input.provider_name,
      plan_name:         input.plan_name ?? null,
      amount:            input.amount,
      currency:          input.currency,
      billing_frequency: input.billing_frequency,
      next_renewal_date: input.next_renewal_date ?? null,
      last_billed_date:  new Date().toISOString().split('T')[0],
      status:            'active',
      category:          input.category,
      notes:             input.notes ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Erreur création abonnement : ${error.message}`);
  return data as Subscription;
}

export async function getActiveSubscriptions(): Promise<Subscription[]> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('status', 'active')
    .order('amount', { ascending: false });

  if (error) throw new Error(`Erreur lecture abonnements : ${error.message}`);
  return (data ?? []) as Subscription[];
}

export async function checkUpcomingRenewals(daysAhead = 14): Promise<Subscription[]> {
  const today  = new Date();
  const cutoff = new Date(today.getTime() + daysAhead * 86_400_000);

  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('status', 'active')
    .gte('next_renewal_date', today.toISOString().split('T')[0])
    .lte('next_renewal_date', cutoff.toISOString().split('T')[0])
    .order('next_renewal_date', { ascending: true });

  if (error) throw new Error(`Erreur lecture renouvellements : ${error.message}`);
  return (data ?? []) as Subscription[];
}

export async function getMonthlySubscriptionTotal(): Promise<{ total_gbp: number; by_category: Record<string, number> }> {
  const subs = await getActiveSubscriptions();
  const rates: Record<string, number> = { GBP: 1, USD: 0.79, EUR: 0.86 };

  let total_gbp = 0;
  const by_category: Record<string, number> = {};

  for (const s of subs) {
    const rate = rates[s.currency] ?? 0.79;
    const monthly = s.billing_frequency === 'annual'    ? s.amount / 12
                  : s.billing_frequency === 'quarterly' ? s.amount / 3
                  : s.amount;
    const gbp = monthly * rate;
    total_gbp += gbp;
    by_category[s.category] = (by_category[s.category] ?? 0) + gbp;
  }

  return { total_gbp: Math.round(total_gbp * 100) / 100, by_category };
}

export async function cancelSubscription(providerId: string): Promise<void> {
  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', providerId);

  if (error) throw new Error(`Erreur annulation : ${error.message}`);
}

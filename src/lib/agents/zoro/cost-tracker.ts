import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type Entity = 'KR_GLOBAL_UK' | 'MAROC' | 'FRANCE';

export type ExpenseCategory = 'SAAS' | 'IA' | 'PUBLICITE' | 'FREELANCE';

export type TransactionCategory =
  | ExpenseCategory
  | 'REVENU_STRIPE'
  | 'REVENU_GUMROAD'
  | 'REVENU_AUTRE'
  | 'FRAIS_STRIPE'
  | 'REMBOURSEMENT';

export interface ExpenseInput {
  date: Date;
  amount: number;
  currency: string;
  category: TransactionCategory;
  entity: Entity;
  source: string;
  description?: string;
  stripeId?: string;
}

export interface CostSummary {
  entity: Entity;
  month: number;
  year: number;
  byCategory: Record<ExpenseCategory, number>;
  total: number;
}

// Seuils d'anomalie par catégorie (en EUR)
const ANOMALY_THRESHOLDS: Record<ExpenseCategory, { perTransaction: number; perMonth: number }> = {
  SAAS:       { perTransaction: 500,  perMonth: 2_000  },
  IA:         { perTransaction: 300,  perMonth: 1_000  },
  PUBLICITE:  { perTransaction: 2000, perMonth: 5_000  },
  FREELANCE:  { perTransaction: 5000, perMonth: 10_000 },
};

const EXPENSE_CATEGORIES = new Set<TransactionCategory>(['SAAS', 'IA', 'PUBLICITE', 'FREELANCE']);

function isExpenseCategory(category: TransactionCategory): category is ExpenseCategory {
  return EXPENSE_CATEGORIES.has(category);
}

async function getMonthTotal(category: ExpenseCategory, entity: Entity): Promise<number> {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data, error } = await supabase
    .from('transactions')
    .select('amount')
    .eq('category', category)
    .eq('entity', entity)
    .gte('date', firstOfMonth);

  if (error) throw new Error(`Erreur lecture transactions mensuelles : ${error.message}`);

  return (data ?? []).reduce((sum, row) => sum + (row.amount as number), 0);
}

async function sendAnomalyAlert(expense: ExpenseInput, reason: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_ALERTES!;

  const text =
    `🚨 *ZORO — Dépense anormale détectée*\n` +
    `Entité : ${expense.entity}\n` +
    `Catégorie : ${expense.category}\n` +
    `Montant : ${expense.amount.toFixed(2)} ${expense.currency}\n` +
    `Source : ${expense.source}\n` +
    `Raison : ${reason}`;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, username: 'ZORO', icon_emoji: ':moneybag:' }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook alertes échoué : ${response.status}`);
  }
}

export async function trackExpense(expense: ExpenseInput): Promise<void> {
  const { error } = await supabase.from('transactions').insert({
    date: expense.date.toISOString(),
    amount: expense.amount,
    currency: expense.currency,
    category: expense.category,
    entity: expense.entity,
    source: expense.source,
    description: expense.description ?? null,
    stripe_id: expense.stripeId ?? null,
  });

  if (error) {
    // Contrainte d'unicité : transaction déjà enregistrée
    if (error.code === '23505') return;
    throw new Error(`Erreur insertion transaction : ${error.message}`);
  }

  await supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Transaction enregistrée : catégorie=${expense.category} entité=${expense.entity}`,
  });

  if (!isExpenseCategory(expense.category)) return;

  const thresholds = ANOMALY_THRESHOLDS[expense.category];

  if (expense.amount > thresholds.perTransaction) {
    const reason = `Transaction de ${expense.amount.toFixed(2)} ${expense.currency} dépasse le seuil de ${thresholds.perTransaction}€`;
    await sendAnomalyAlert(expense, reason);
    await supabase.from('alerts').insert({
      agent_name: 'ZORO',
      level: 'WARNING',
      message: `Dépense anormale (seuil/transaction) : catégorie=${expense.category} entité=${expense.entity}`,
    });
    return;
  }

  const monthTotal = await getMonthTotal(expense.category, expense.entity);
  if (monthTotal > thresholds.perMonth) {
    const reason = `Total mensuel de ${monthTotal.toFixed(2)}€ dépasse le seuil de ${thresholds.perMonth}€`;
    await sendAnomalyAlert(expense, reason);
    await supabase.from('alerts').insert({
      agent_name: 'ZORO',
      level: 'WARNING',
      message: `Dépense anormale (seuil/mois) : catégorie=${expense.category} entité=${expense.entity}`,
    });
  }
}

export async function getCurrentMonthCosts(entity?: Entity): Promise<CostSummary[]> {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const entities: Entity[] = entity ? [entity] : ['KR_GLOBAL_UK', 'MAROC', 'FRANCE'];
  const results: CostSummary[] = [];

  for (const ent of entities) {
    const { data, error } = await supabase
      .from('transactions')
      .select('amount, category')
      .eq('entity', ent)
      .in('category', ['SAAS', 'IA', 'PUBLICITE', 'FREELANCE'])
      .gte('date', firstOfMonth);

    if (error) throw new Error(`Erreur lecture coûts mensuels : ${error.message}`);

    const byCategory: Record<ExpenseCategory, number> = {
      SAAS: 0,
      IA: 0,
      PUBLICITE: 0,
      FREELANCE: 0,
    };

    for (const row of data ?? []) {
      const cat = row.category as ExpenseCategory;
      byCategory[cat] = (byCategory[cat] ?? 0) + (row.amount as number);
    }

    results.push({
      entity: ent,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      byCategory,
      total: Object.values(byCategory).reduce((s, v) => s + v, 0),
    });
  }

  return results;
}

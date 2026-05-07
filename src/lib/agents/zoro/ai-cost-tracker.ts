import { createClient } from '@supabase/supabase-js';
import { convertToGBP } from './currency-manager';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface AICostEntry {
  agent_name:    string;
  provider:      string;
  model?:        string;
  tokens_input?: number;
  tokens_output?: number;
  cost_usd:      number;
  request_count?: number;
}

export interface AICostSummary {
  agent_name:    string;
  total_usd:     number;
  total_gbp:     number;
  request_count: number;
  avg_per_request_usd: number;
}

// OpenRouter pricing reference (USD per 1M tokens) — approximate
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'google/gemini-2.0-flash-001': { input: 0.10,  output: 0.40  },
  'moonshotai/kimi-k2':          { input: 0.15,  output: 2.50  },
  'anthropic/claude-3-opus':     { input: 15.00, output: 75.00 },
  'anthropic/claude-3-sonnet':   { input: 3.00,  output: 15.00 },
  'openai/gpt-4o':               { input: 2.50,  output: 10.00 },
  'openai/gpt-4o-mini':          { input: 0.15,  output: 0.60  },
};

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['google/gemini-2.0-flash-001'];
  return ((tokensIn * pricing.input) + (tokensOut * pricing.output)) / 1_000_000;
}

export async function recordAICost(entry: AICostEntry): Promise<void> {
  const cost_gbp = await convertToGBP(entry.cost_usd, 'USD');

  await supabase.from('ai_agent_costs').insert({
    date:           new Date().toISOString().split('T')[0],
    agent_name:     entry.agent_name,
    provider:       entry.provider,
    model:          entry.model ?? process.env.OPENROUTER_MODEL ?? 'google/gemini-2.0-flash-001',
    tokens_input:   entry.tokens_input ?? 0,
    tokens_output:  entry.tokens_output ?? 0,
    cost_usd:       entry.cost_usd,
    cost_gbp,
    request_count:  entry.request_count ?? 1,
  });
}

export async function getAICostsByAgent(
  startDate?: string,
  endDate?: string,
): Promise<AICostSummary[]> {
  const from = startDate ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const to   = endDate   ?? new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('ai_agent_costs')
    .select('agent_name, cost_usd, cost_gbp, request_count')
    .gte('date', from)
    .lte('date', to);

  if (error) throw new Error(`Erreur lecture AI costs : ${error.message}`);

  const agg: Record<string, { usd: number; gbp: number; requests: number }> = {};
  for (const row of data ?? []) {
    const k = row.agent_name as string;
    if (!agg[k]) agg[k] = { usd: 0, gbp: 0, requests: 0 };
    agg[k].usd      += row.cost_usd as number;
    agg[k].gbp      += row.cost_gbp as number;
    agg[k].requests += row.request_count as number;
  }

  return Object.entries(agg).map(([agent_name, v]) => ({
    agent_name,
    total_usd:           Math.round(v.usd * 10000) / 10000,
    total_gbp:           Math.round(v.gbp * 10000) / 10000,
    request_count:       v.requests,
    avg_per_request_usd: v.requests > 0 ? Math.round((v.usd / v.requests) * 100000) / 100000 : 0,
  })).sort((a, b) => b.total_usd - a.total_usd);
}

export async function getAICostsByProvider(startDate?: string): Promise<Record<string, number>> {
  const from = startDate ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('ai_agent_costs')
    .select('provider, cost_usd')
    .gte('date', from);

  if (error) throw new Error(`Erreur lecture provider costs : ${error.message}`);

  const result: Record<string, number> = {};
  for (const row of data ?? []) {
    const p = row.provider as string;
    result[p] = (result[p] ?? 0) + (row.cost_usd as number);
  }
  return result;
}

export async function generateAICostReport(month?: number, year?: number): Promise<string> {
  const now = new Date();
  const m   = month ?? now.getMonth() + 1;
  const y   = year  ?? now.getFullYear();
  const from = `${y}-${String(m).padStart(2,'0')}-01`;
  const to   = new Date(y, m, 0).toISOString().split('T')[0];

  const [byAgent, byProvider] = await Promise.all([
    getAICostsByAgent(from, to),
    getAICostsByProvider(from),
  ]);

  const totalUsd = byAgent.reduce((s, a) => s + a.total_usd, 0);
  const totalGbp = byAgent.reduce((s, a) => s + a.total_gbp, 0);

  const lines = [
    `🤖 *ZORO — Rapport coûts IA ${m}/${y}*`,
    `💵 Total : $${totalUsd.toFixed(4)} (£${totalGbp.toFixed(4)})`,
    '',
    '*Par agent :*',
    ...byAgent.map(a => `  • ${a.agent_name}: $${a.total_usd.toFixed(4)} (${a.request_count} req)`),
    '',
    '*Par fournisseur :*',
    ...Object.entries(byProvider).map(([p, v]) => `  • ${p}: $${v.toFixed(4)}`),
  ];

  return lines.join('\n');
}

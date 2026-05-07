import { createClient } from '@supabase/supabase-js';
import { getLLM } from '@/lib/langchain/llm';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { scorePrompt } from './prompt-optimizer';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface ABTestResult {
  id:        string;
  agent_name: string;
  prompt_a:  string;
  prompt_b:  string;
  winner:    'A' | 'B' | null;
  score_a:   number;
  score_b:   number;
  completed: boolean;
  created_at: string;
}

export interface PromptTestResult {
  successes:       number;
  failures:        number;
  avg_duration_ms: number;
  sample_outputs:  string[];
}

// ── Lance un test A/B entre deux prompts ──────────────────────────────────────

export async function runABTest(
  agentName: string,
  promptA:   string,
  promptB:   string,
  testInputs?: string[],
): Promise<ABTestResult> {
  const inputs = testInputs ?? defaultTestInputs(agentName);

  const { data: record, error: insertError } = await supabase
    .from('ab_tests')
    .insert({
      agent_name: agentName.toUpperCase(),
      prompt_a:   promptA,
      prompt_b:   promptB,
      completed:  false,
    })
    .select()
    .single();

  if (insertError) throw new Error(`ab_tests insert: ${insertError.message}`);

  // Test les deux prompts en parallèle sur les inputs
  const [resultsA, resultsB] = await Promise.all([
    testPromptBatch(promptA, inputs),
    testPromptBatch(promptB, inputs),
  ]);

  const scoreA = scorePrompt(promptA, resultsA);
  const scoreB = scorePrompt(promptB, resultsB);
  const winner = selectWinner({ scoreA, scoreB });

  const { data, error } = await supabase
    .from('ab_tests')
    .update({
      score_a:   scoreA,
      score_b:   scoreB,
      winner:    winner,
      completed: true,
    })
    .eq('id', record.id)
    .select()
    .single();

  if (error) throw new Error(`ab_tests update: ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'MINATO',
    level:      'INFO',
    message:    `A/B test terminé : ${agentName} — gagnant : Prompt ${winner} (A=${scoreA}, B=${scoreB})`,
  });

  return data as ABTestResult;
}

// ── Sélectionne le gagnant ────────────────────────────────────────────────────

export function selectWinner(scores: { scoreA: number; scoreB: number }): 'A' | 'B' | null {
  const diff = Math.abs(scores.scoreA - scores.scoreB);
  if (diff < 0.05) return null; // pas de différence significative
  return scores.scoreA >= scores.scoreB ? 'A' : 'B';
}

// ── Récupère les tests A/B d'un agent ────────────────────────────────────────

export async function getABTests(
  agentName?: string,
  completedOnly = false,
): Promise<ABTestResult[]> {
  let q = supabase
    .from('ab_tests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (agentName)     q = q.eq('agent_name', agentName.toUpperCase());
  if (completedOnly) q = q.eq('completed', true);

  const { data, error } = await q;
  if (error) throw new Error(`getABTests: ${error.message}`);
  return (data ?? []) as ABTestResult[];
}

// ── Test un prompt sur un batch d'inputs via LLM ─────────────────────────────

async function testPromptBatch(
  systemPrompt: string,
  inputs:       string[],
): Promise<PromptTestResult> {
  const llm           = getLLM(false);
  let successes       = 0;
  let failures        = 0;
  const durations: number[] = [];
  const sample_outputs: string[] = [];

  for (const input of inputs.slice(0, 5)) {
    const start = Date.now();
    try {
      const res = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(input),
      ]);
      durations.push(Date.now() - start);
      const output = String(res.content).trim();
      if (output.length > 10) {
        successes++;
        if (sample_outputs.length < 2) sample_outputs.push(output.slice(0, 200));
      } else {
        failures++;
      }
    } catch {
      failures++;
      durations.push(Date.now() - start);
    }
  }

  return {
    successes,
    failures,
    avg_duration_ms: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0,
    sample_outputs,
  };
}

// ── Inputs de test par défaut selon l'agent ───────────────────────────────────

function defaultTestInputs(agentName: string): string[] {
  const defaults: Record<string, string[]> = {
    LUFFY:   ['Classe cet email : "Bonjour, je cherche une agence IA"', 'Spam : "Vous avez gagné un iPhone"'],
    KILLUA:  ['Rédige un email de prospection pour une PME tech', 'Résume les leads Apollo'],
    ITACHI:  ['Génère un post LinkedIn sur l\'IA pour les PME', 'Rédige un article SEO sur l\'automatisation'],
    HASHIRAMA: ['Rapport quotidien des agents', 'Statut de tous les agents'],
    DEFAULT: ['Quelle est votre procédure principale ?', 'Comment optimiser ce processus ?'],
  };

  const key = agentName.toUpperCase();
  return defaults[key] ?? defaults['DEFAULT']!;
}

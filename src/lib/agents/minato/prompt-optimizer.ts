import { createClient } from '@supabase/supabase-js';
import { getLLM } from '@/lib/langchain/llm';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { FailurePattern } from './performance-analyzer';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface OptimizationResult {
  id:                string;
  agent_name:        string;
  original_prompt:   string;
  optimized_prompt:  string;
  improvement_score: number;
  test_results:      Record<string, unknown>;
  applied:           boolean;
  created_at:        string;
}

// ── Génère un prompt optimisé à partir des logs d'échec ──────────────────────

export async function optimizePrompt(
  agentName:    string,
  currentPrompt: string,
  failureLogs:   FailurePattern[],
): Promise<OptimizationResult> {
  const failureSummary = failureLogs.length
    ? failureLogs.map(f => `- Action "${f.action}" : ${f.count} échec(s) — ${f.sample_error}`).join('\n')
    : 'Aucun échec spécifique identifié.';

  const llm = getLLM(false);

  const response = await llm.invoke([
    new SystemMessage(
      `Tu es un expert en prompt engineering pour agents LLM.
Tu dois améliorer le prompt système d'un agent IA basé sur ses logs d'échec.

Règles :
- Conserver l'identité et le rôle de l'agent
- Corriger les causes d'échec identifiées
- Rendre les instructions plus claires et précises
- Ne pas allonger inutilement
- Retourner UNIQUEMENT le prompt amélioré, sans commentaire`
    ),
    new HumanMessage(
      `Agent : ${agentName}

Prompt actuel :
${currentPrompt}

Patterns d'échec détectés :
${failureSummary}

Génère un prompt amélioré qui corrige ces problèmes.`
    ),
  ]);

  const optimizedPrompt = String(response.content).trim();

  const score = computeImprovementScore(currentPrompt, optimizedPrompt, failureLogs.length);

  const { data, error } = await supabase
    .from('prompt_optimizations')
    .insert({
      agent_name:        agentName.toUpperCase(),
      original_prompt:   currentPrompt,
      optimized_prompt:  optimizedPrompt,
      improvement_score: score,
      test_results:      { failure_patterns: failureLogs.length, method: 'llm_optimization' },
      applied:           false,
    })
    .select()
    .single();

  if (error) throw new Error(`Supabase insert prompt_optimizations: ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'MINATO',
    level:      'INFO',
    message:    `Prompt optimisé pour ${agentName} — score amélioration : ${score}`,
  });

  return data as OptimizationResult;
}

// ── Génère N variantes d'un prompt ───────────────────────────────────────────

export async function generateVariants(
  prompt:   string,
  count     = 3,
  agentName = 'AGENT',
): Promise<string[]> {
  const llm = getLLM(false);

  const response = await llm.invoke([
    new SystemMessage(
      `Tu es un expert en prompt engineering.
Génère ${count} variantes d'un prompt système d'agent IA.
Chaque variante doit être séparée par exactement "---VARIANT---".
Ne mets aucun commentaire, uniquement les prompts.`
    ),
    new HumanMessage(
      `Agent : ${agentName}

Prompt original :
${prompt}

Génère ${count} variantes distinctes.`
    ),
  ]);

  const raw       = String(response.content).trim();
  const variants  = raw.split('---VARIANT---').map(v => v.trim()).filter(v => v.length > 50);

  return variants.slice(0, count);
}

// ── Score un prompt selon les métriques de test ───────────────────────────────

export function scorePrompt(
  prompt:      string,
  testResults: { successes: number; failures: number; avg_duration_ms: number },
): number {
  const total       = testResults.successes + testResults.failures;
  if (total === 0) return 0;

  const successRate = testResults.successes / total;
  const lengthPenalty = Math.max(0, (prompt.length - 2000) / 10000);
  const speedBonus    = testResults.avg_duration_ms < 5000 ? 0.05 : 0;

  return Math.round(Math.max(0, Math.min(1, successRate - lengthPenalty + speedBonus)) * 100) / 100;
}

// ── Applique une optimisation (marque applied=true + archive dans BROOK) ──────

export async function applyOptimization(optimizationId: string): Promise<void> {
  const { error } = await supabase
    .from('prompt_optimizations')
    .update({ applied: true })
    .eq('id', optimizationId);

  if (error) throw new Error(`applyOptimization: ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'MINATO',
    level:      'INFO',
    message:    `Optimisation appliquée : ${optimizationId}`,
  });
}

// ── Liste les optimisations pour un agent ─────────────────────────────────────

export async function getOptimizations(
  agentName?: string,
  onlyApplied = false,
): Promise<OptimizationResult[]> {
  let q = supabase
    .from('prompt_optimizations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (agentName)   q = q.eq('agent_name', agentName.toUpperCase());
  if (onlyApplied) q = q.eq('applied', true);

  const { data, error } = await q;
  if (error) throw new Error(`getOptimizations: ${error.message}`);
  return (data ?? []) as OptimizationResult[];
}

// ── Score d'amélioration heuristique ─────────────────────────────────────────

function computeImprovementScore(
  original:    string,
  optimized:   string,
  failureCount: number,
): number {
  const lengthDiff    = (original.length - optimized.length) / original.length;
  const failureBonus  = Math.min(0.3, failureCount * 0.05);
  const baseScore     = 0.5 + failureBonus + Math.max(-0.2, Math.min(0.2, lengthDiff * 0.5));
  return Math.round(Math.min(1, Math.max(0, baseScore)) * 100) / 100;
}

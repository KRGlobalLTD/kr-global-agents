import { createClient } from '@supabase/supabase-js';
import { remember } from '@/lib/qdrant/memory';
import { ensureCollection, COLLECTIONS } from '@/lib/qdrant/collections';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface PromptVersion {
  id:                string;
  agent_name:        string;
  prompt_content:    string;
  version:           number;
  performance_score: number;
  is_active:         boolean;
  created_at:        string;
}

// ── Save a new prompt version ─────────────────────────────────────────────────

export async function savePromptVersion(
  agent:   string,
  prompt:  string,
  score    = 0,
): Promise<PromptVersion> {
  // Désactiver les versions actives précédentes
  await supabase
    .from('prompt_versions')
    .update({ is_active: false })
    .eq('agent_name', agent)
    .eq('is_active', true);

  // Calculer le prochain numéro de version
  const { data: lastRow } = await supabase
    .from('prompt_versions')
    .select('version')
    .eq('agent_name', agent)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const version = lastRow ? (lastRow.version as number) + 1 : 1;

  const { data, error } = await supabase
    .from('prompt_versions')
    .insert({
      agent_name:        agent,
      prompt_content:    prompt,
      version,
      performance_score: score,
      is_active:         true,
    })
    .select()
    .single();

  if (error) throw new Error(`Supabase insert prompt_versions: ${error.message}`);

  // Indexer dans Qdrant pour recherche sémantique
  await ensureCollection(COLLECTIONS.knowledge);
  await remember(COLLECTIONS.knowledge, {
    id:      crypto.randomUUID(),
    text:    `Prompt ${agent} v${version}\n\n${prompt}`,
    payload: { category: 'prompts', agent_name: agent, version, score, source: 'brook' },
  });

  await supabase.from('alerts').insert({
    agent_name: 'BROOK',
    level:      'INFO',
    message:    `Prompt archivé : ${agent} v${version} (score=${score})`,
  });

  return data as PromptVersion;
}

// ── Get prompt history for an agent ──────────────────────────────────────────

export async function getPromptHistory(agent: string, limit = 10): Promise<PromptVersion[]> {
  const { data, error } = await supabase
    .from('prompt_versions')
    .select('*')
    .eq('agent_name', agent)
    .order('version', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Supabase query prompt_versions: ${error.message}`);
  return (data ?? []) as PromptVersion[];
}

// ── Get the currently active prompt for an agent ─────────────────────────────

export async function getActivePrompt(agent: string): Promise<PromptVersion | null> {
  const { data } = await supabase
    .from('prompt_versions')
    .select('*')
    .eq('agent_name', agent)
    .eq('is_active', true)
    .single();

  return data ? (data as PromptVersion) : null;
}

// ── Rollback to a specific version ───────────────────────────────────────────

export async function rollback(agent: string, version: number): Promise<PromptVersion> {
  // Désactiver toutes les versions actives
  await supabase
    .from('prompt_versions')
    .update({ is_active: false })
    .eq('agent_name', agent);

  // Activer la version cible
  const { data, error } = await supabase
    .from('prompt_versions')
    .update({ is_active: true })
    .eq('agent_name', agent)
    .eq('version', version)
    .select()
    .single();

  if (error) throw new Error(`Rollback introuvable : ${agent} v${version}`);

  await supabase.from('alerts').insert({
    agent_name: 'BROOK',
    level:      'INFO',
    message:    `Rollback prompt ${agent} → v${version}`,
  });

  return data as PromptVersion;
}

// ── Update performance score ──────────────────────────────────────────────────

export async function updateScore(agent: string, version: number, score: number): Promise<void> {
  await supabase
    .from('prompt_versions')
    .update({ performance_score: score })
    .eq('agent_name', agent)
    .eq('version', version);
}

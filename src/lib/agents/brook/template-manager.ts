import { createClient } from '@supabase/supabase-js';
import { addDocument, getDocument } from './knowledge-manager';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type TemplateType =
  | 'email_welcome'
  | 'email_followup'
  | 'email_relance'
  | 'email_onboarding'
  | 'email_nps'
  | 'contrat_nda'
  | 'contrat_mission'
  | 'brief_client'
  | 'facture'
  | 'rapport_mensuel'
  | 'cold_email'
  | 'cold_followup';

export interface Template {
  id:         string;
  type:       TemplateType;
  title:      string;
  content:    string;
  version:    number;
  updated_at: string;
}

// ── Get a template by type ────────────────────────────────────────────────────

export async function getTemplate(type: TemplateType): Promise<Template | null> {
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id, title, content, version, updated_at, tags')
    .eq('category', 'templates')
    .contains('tags', [type])
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;

  return {
    id:         data.id as string,
    type,
    title:      data.title as string,
    content:    data.content as string,
    version:    data.version as number,
    updated_at: data.updated_at as string,
  };
}

// ── Save / update a template ──────────────────────────────────────────────────

export async function saveTemplate(
  type:    TemplateType,
  content: string,
  title?:  string,
): Promise<Template> {
  const displayTitle = title ?? `Template ${type.replace(/_/g, ' ')}`;

  const doc = await addDocument(content, 'templates', displayTitle, [type, 'template']);

  return {
    id:         doc.id,
    type,
    title:      displayTitle,
    content,
    version:    doc.version,
    updated_at: doc.updated_at,
  };
}

// ── List all available templates ──────────────────────────────────────────────

export async function listTemplates(): Promise<{ id: string; type: string; title: string; version: number; updated_at: string }[]> {
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id, title, tags, version, updated_at')
    .eq('category', 'templates')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Supabase list templates: ${error.message}`);

  return (data ?? []).map(row => {
    const tags = (row.tags as string[]) ?? [];
    const type = tags.find(t => t !== 'template') ?? 'unknown';
    return {
      id:         row.id as string,
      type,
      title:      row.title as string,
      version:    row.version as number,
      updated_at: row.updated_at as string,
    };
  });
}

// ── Get template by document id ───────────────────────────────────────────────

export async function getTemplateById(id: string): Promise<Template | null> {
  const doc = await getDocument(id);
  if (!doc || doc.category !== 'templates') return null;

  const type = (doc.tags.find(t => t !== 'template') ?? 'email_welcome') as TemplateType;
  return { id: doc.id, type, title: doc.title, content: doc.content, version: doc.version, updated_at: doc.updated_at };
}

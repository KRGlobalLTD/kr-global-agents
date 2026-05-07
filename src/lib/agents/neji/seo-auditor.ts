import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface SEOIssue {
  type:    'error' | 'warning' | 'info';
  field:   string;
  message: string;
}

export interface SEOAuditResult {
  audit_id:        string;
  url:             string;
  score:           number;
  issues:          SEOIssue[];
  recommendations: string[];
  word_count:      number;
  has_h1:          boolean;
  has_meta_desc:   boolean;
  keywords_found:  string[];
  keywords_missing: string[];
}

// Jina Reader API — extrait le texte propre de n'importe quelle URL
async function fetchPageContent(url: string): Promise<string> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const headers: Record<string, string> = { Accept: 'text/plain' };
  if (process.env.JINA_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`;
  }

  const res = await fetch(jinaUrl, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Jina reader ${res.status} pour ${url}`);
  return res.text();
}

function runAudit(url: string, content: string, targetKeywords: string[]): Omit<SEOAuditResult, 'audit_id'> {
  const issues:          SEOIssue[] = [];
  const recommendations: string[]   = [];
  const lower                        = content.toLowerCase();
  const wordCount                    = content.split(/\s+/).filter(w => w.length > 1).length;

  const hasH1      = /^#\s.+/m.test(content) || /<h1[\s>]/i.test(content);
  const hasMetaDesc = content.length > 200;

  if (!hasH1) {
    issues.push({ type: 'error', field: 'h1', message: 'Pas de titre H1 détecté' });
    recommendations.push('Ajouter un H1 unique contenant le mot-clé principal');
  }

  if (wordCount < 300) {
    issues.push({ type: 'error', field: 'contenu', message: `Contenu trop court : ${wordCount} mots (min 300)` });
    recommendations.push('Enrichir la page à au moins 300 mots');
  } else if (wordCount < 800) {
    issues.push({ type: 'warning', field: 'contenu', message: `Contenu court : ${wordCount} mots (idéal 800+)` });
    recommendations.push('Viser 800 mots minimum pour un meilleur référencement');
  }

  if (url.length > 75) {
    issues.push({ type: 'warning', field: 'url', message: `URL longue : ${url.length} caractères` });
    recommendations.push('Raccourcir l\'URL à moins de 75 caractères');
  }

  const keywordsFound:   string[] = [];
  const keywordsMissing: string[] = [];

  for (const kw of targetKeywords) {
    if (lower.includes(kw.toLowerCase())) {
      keywordsFound.push(kw);
    } else {
      keywordsMissing.push(kw);
      issues.push({ type: 'warning', field: 'keyword', message: `Mot-clé absent : "${kw}"` });
      recommendations.push(`Intégrer "${kw}" naturellement dans le contenu ou les titres`);
    }
  }

  if (!hasMetaDesc) {
    issues.push({ type: 'warning', field: 'meta_description', message: 'Contenu trop court pour évaluer la meta description' });
  }

  const errors   = issues.filter(i => i.type === 'error').length;
  const warnings = issues.filter(i => i.type === 'warning').length;
  const score    = Math.max(0, Math.min(100, 100 - errors * 20 - warnings * 7));

  return {
    url,
    score,
    issues,
    recommendations,
    word_count:       wordCount,
    has_h1:           hasH1,
    has_meta_desc:    hasMetaDesc,
    keywords_found:   keywordsFound,
    keywords_missing: keywordsMissing,
  };
}

export async function auditURL(url: string, keywords: string[] = []): Promise<SEOAuditResult> {
  const content = await fetchPageContent(url);
  const result  = runAudit(url, content, keywords);

  const { data, error } = await supabase
    .from('seo_audits')
    .insert({
      url,
      score:            result.score,
      issues:           result.issues,
      recommendations:  result.recommendations,
      word_count:       result.word_count,
      keywords_found:   result.keywords_found,
      keywords_missing: result.keywords_missing,
    })
    .select('id')
    .single();

  if (error) {
    await supabase.from('alerts').insert({
      agent_name: 'NEJI',
      level:      'WARNING',
      message:    `seo_audits insert error (${url}): ${error.message}`,
    });
  }

  const audit_id = (data as { id: string } | null)?.id ?? '';

  await supabase.from('alerts').insert({
    agent_name: 'NEJI',
    level:      'INFO',
    message:    `SEO audit ${url} — score=${result.score}/100, ${result.issues.length} problème(s)`,
  });

  return { audit_id, ...result };
}

export async function getRecentAudits(limit = 10): Promise<SEOAuditResult[]> {
  const { data, error } = await supabase
    .from('seo_audits')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getRecentAudits: ${error.message}`);
  return (data ?? []) as unknown as SEOAuditResult[];
}

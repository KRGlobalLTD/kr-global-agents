import { createClient } from '@supabase/supabase-js';
import { callOpenRouter, parseJsonSafe } from './content-generator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface SeoArticleInput {
  marque:     string;
  sujet:      string;
  mots_cles:  string[];
  langue:     string;
  ton:        string;
  entite_nom: string;
}

export interface SeoArticleOutput {
  titre:                 string;
  meta_description:      string;
  contenu_html:          string;
  mots_cles_secondaires: string[];
  modele:                string;
}

// kimi-k2 pour articles longs, qualité rédaction
const MODEL = 'moonshotai/kimi-k2';

const COST_PER_1K = { input: 0.0010, output: 0.0030 };

function buildSystemPrompt(input: SeoArticleInput): string {
  const kw = input.mots_cles.join(', ');

  return (
    `Tu es un expert en rédaction SEO pour KR Global Solutions Ltd (agence IA, Londres UK).\n` +
    `Marque : ${input.marque} | Langue : ${input.langue} | Ton : ${input.ton}\n` +
    `Mots-clés principaux : ${kw}\n\n` +
    `Rédige un article SEO complet en HTML. Structure OBLIGATOIRE :\n` +
    `<h1>Titre accrocheur intégrant le mot-clé principal</h1>\n` +
    `<p>Introduction de 150 mots présentant le problème et la valeur de l'article</p>\n` +
    `<h2>Section 1 : [titre descriptif]</h2><p>Contenu riche 200-250 mots</p>\n` +
    `<h2>Section 2 : [titre descriptif]</h2><p>Contenu riche 200-250 mots</p>\n` +
    `<h2>Section 3 : [titre descriptif]</h2><p>Contenu riche 200-250 mots</p>\n` +
    `[Section 4 optionnelle]\n` +
    `<h2>Conclusion</h2><p>Synthèse 100 mots + CTA vers KR Global</p>\n\n` +
    `Règles SEO :\n` +
    `- Densité mots-clés : 1-2% (naturel, pas de bourrage)\n` +
    `- Longueur totale : 800-1200 mots\n` +
    `- CTA final : "Découvrez comment KR Global peut vous aider" ou similaire\n` +
    `- Aucun contenu fictif, aucune statistique inventée\n\n` +
    `Retourne UNIQUEMENT un JSON valide :\n` +
    `{\n` +
    `  "titre": "...",\n` +
    `  "meta_description": "...",\n` +
    `  "contenu_html": "...",\n` +
    `  "mots_cles_secondaires": ["...", "..."]\n` +
    `}\n` +
    `"meta_description" : 155 chars max, optimisée CTR\n` +
    `"mots_cles_secondaires" : 5-8 variations longue traîne`
  );
}

export async function writeSeoArticle(input: SeoArticleInput): Promise<SeoArticleOutput> {
  const { raw, usage } = await callOpenRouter(
    MODEL,
    buildSystemPrompt(input),
    `Sujet de l'article : ${input.sujet}\nMots-clés cibles : ${input.mots_cles.join(', ')}`,
    6000
  );

  const parsed = parseJsonSafe(raw);

  const titre = typeof parsed['titre'] === 'string' && parsed['titre'].length > 0
    ? parsed['titre'] : input.sujet;

  const meta_description = typeof parsed['meta_description'] === 'string'
    ? parsed['meta_description'].slice(0, 155) : '';

  const contenu_html = typeof parsed['contenu_html'] === 'string' ? parsed['contenu_html'] : '';

  const mots_cles_secondaires = Array.isArray(parsed['mots_cles_secondaires'])
    ? (parsed['mots_cles_secondaires'] as unknown[]).filter((k): k is string => typeof k === 'string')
    : [];

  const cout = (usage.prompt_tokens / 1000) * COST_PER_1K.input
             + (usage.completion_tokens / 1000) * COST_PER_1K.output;

  await supabase.from('couts_par_entite').insert({
    entite_nom:    input.entite_nom,
    agent_name:    'ITACHI',
    modele:        MODEL,
    operation:     'seo_article',
    tokens_input:  usage.prompt_tokens,
    tokens_output: usage.completion_tokens,
    cout_estime:   cout,
  });

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Article SEO "${titre}" rédigé (${usage.completion_tokens} tokens, entité=${input.entite_nom})`,
  });

  return { titre, meta_description, contenu_html, mots_cles_secondaires, modele: MODEL };
}

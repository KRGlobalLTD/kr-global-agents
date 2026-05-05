import { getLLM } from '@/lib/langchain/llm';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type AdaptPlatform = 'linkedin' | 'twitter' | 'instagram';

export interface AdaptedPost {
  platform:  AdaptPlatform;
  content:   string;
  hashtags:  string[];
  charCount: number;
}

const PLATFORM_RULES: Record<AdaptPlatform, string> = {
  linkedin: `
LinkedIn - Règles strictes :
- 1300 caractères maximum (texte seul, sans hashtags)
- Ton professionnel, storytelling business
- Structure : accroche forte (1 ligne) → valeur concrète → CTA
- Exactement 5 hashtags pertinents en fin de post
- Pas d'emojis excessifs (2-3 max)
- Phrases courtes, paragraphes de 1-2 lignes`,

  twitter: `
Twitter/X - Règles strictes :
- 280 caractères maximum tout compris (texte + hashtags + espaces)
- Percutant, direct, hook immédiat
- Exactement 2 hashtags inclus dans les 280 caractères
- Un seul message, pas de thread
- Emojis autorisés (1-2 max)`,

  instagram: `
Instagram - Règles strictes :
- Caption : 150-300 mots, ton engageant et personnel
- Commence par une phrase d'accroche forte
- Raconte une histoire courte puis CTA
- Exactement 30 hashtags variés (niche + larges) en bloc séparé
- Emojis bienvenus (5-8)`,
};

const SYSTEM = `Tu es SANJI, expert social media de KR Global Solutions Ltd (agence IA, Londres UK).
Tu adaptes du contenu pour maximiser l'engagement sur chaque plateforme.
Réponds UNIQUEMENT en JSON valide : { "content": "...", "hashtags": ["tag1", "tag2", ...] }
Les hashtags sont sans le symbole #.
Respecte scrupuleusement les limites de caractères.`;

const promptTemplate = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM],
  ['human', `Contenu source :\n{source}\n\nRègles plateforme :\n{rules}`],
]);

const chain = promptTemplate.pipe(getLLM(false)).pipe(new StringOutputParser());

function parseJson(raw: string): { content: string; hashtags: string[] } {
  const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(clean) as { content: string; hashtags: string[] };
  } catch {
    return { content: raw.slice(0, 280), hashtags: [] };
  }
}

export async function adaptContent(source: string, platform: AdaptPlatform): Promise<AdaptedPost> {
  const raw = await chain.invoke({ source, rules: PLATFORM_RULES[platform] });
  const parsed = parseJson(raw);

  const content  = typeof parsed.content   === 'string' ? parsed.content   : source.slice(0, 280);
  const hashtags = Array.isArray(parsed.hashtags)
    ? (parsed.hashtags as unknown[]).filter((h): h is string => typeof h === 'string')
    : [];

  // Enforce Twitter char limit as hard guard
  let finalContent = content;
  if (platform === 'twitter') {
    const withTags = `${content} ${hashtags.map(h => `#${h}`).join(' ')}`;
    if (withTags.length > 280) {
      finalContent = content.slice(0, 280 - hashtags.slice(0, 2).map(h => ` #${h}`).join('').length - 1);
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'SANJI',
    level:      'INFO',
    message:    `Contenu adapté pour ${platform} (${finalContent.length} chars, ${hashtags.length} hashtags)`,
  });

  return {
    platform,
    content:   finalContent,
    hashtags:  platform === 'twitter'   ? hashtags.slice(0, 2)
               : platform === 'linkedin' ? hashtags.slice(0, 5)
               : hashtags.slice(0, 30),
    charCount: finalContent.length,
  };
}

export async function adaptForAllPlatforms(source: string): Promise<AdaptedPost[]> {
  const platforms: AdaptPlatform[] = ['linkedin', 'twitter', 'instagram'];
  return Promise.all(platforms.map(p => adaptContent(source, p)));
}

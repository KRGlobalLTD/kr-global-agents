import { createClient } from '@supabase/supabase-js';
import { callOpenRouter, parseJsonSafe } from './content-generator';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type SocialPlatform = 'linkedin' | 'instagram' | 'tiktok' | 'twitter';

export interface FormatInput {
  source_contenu: string;  // contenu source (article, texte long, etc.)
  plateforme:     SocialPlatform;
  marque:         string;
  langue:         string;
  sujet:          string;
}

export interface FormattedPost {
  contenu:   string;
  hashtags:  string[];
  chars:     number;
}

const PLATFORM_SPECS: Record<SocialPlatform, string> = {
  linkedin:
    `Formate ce contenu pour LinkedIn.\n` +
    `Règles : accroche forte en ligne 1 (jamais "Je" en premier), 3-5 paragraphes courts séparés par des sauts de ligne, ` +
    `1 insight concret actionnable, question engageante en fin de post, 3-5 hashtags sectoriels.\n` +
    `Max 1300 caractères. Ton professionnel et inspirant. "contenu" = texte brut du post.`,

  instagram:
    `Formate ce contenu pour Instagram.\n` +
    `Règles : première ligne accrocheuse + emoji, corps avec emojis pertinents bien espacés, ` +
    `CTA clair vers bio ou lien, 10-15 hashtags (mix populaires + niche, 30-50% niche).\n` +
    `Max 2200 caractères. Ton authentique et engageant. "contenu" = légende complète.`,

  tiktok:
    `Formate ce contenu pour TikTok (script vidéo).\n` +
    `Structure : [HOOK 3s] question ou affirmation choc, [PROBLÈME] identification du pain point, ` +
    `[SOLUTION] valeur apportée, [RÉSULTAT] bénéfice concret, [CTA] appel à l'action à 80% du script.\n` +
    `Max 150 mots. Ton direct, conversationnel, rythme rapide. "contenu" = script à lire face caméra.`,

  twitter:
    `Formate ce contenu pour Twitter/X.\n` +
    `Règles : accroche directe et impactante, une seule idée forte, chiffre ou statistique si pertinent, 1-2 hashtags max.\n` +
    `MAXIMUM 280 caractères — c'est impératif. "contenu" = tweet complet.`,
};

const MODEL = 'google/gemini-2.0-flash-001';

function buildPrompt(input: FormatInput): { system: string; user: string } {
  const system =
    `Tu es ITACHI, expert en marketing digital pour ${input.marque} (KR Global Solutions Ltd, agence IA).\n` +
    `Langue : ${input.langue}\n\n` +
    `${PLATFORM_SPECS[input.plateforme]}\n\n` +
    `Retourne UNIQUEMENT un JSON valide :\n` +
    `{ "contenu": "...", "hashtags": ["mot1", "mot2"] }\n` +
    `"hashtags" = tableau de mots sans le symbole #`;

  const user =
    `Sujet : ${input.sujet}\n\n` +
    `Contenu source à adapter :\n${input.source_contenu.slice(0, 3000)}`;

  return { system, user };
}

export async function formatForPlatform(input: FormatInput): Promise<FormattedPost> {
  const { system, user } = buildPrompt(input);

  const { raw } = await callOpenRouter(MODEL, system, user, 1000);
  const parsed  = parseJsonSafe(raw);

  const contenu = typeof parsed['contenu'] === 'string' ? parsed['contenu'] : '';
  const hashtags = Array.isArray(parsed['hashtags'])
    ? (parsed['hashtags'] as unknown[]).filter((h): h is string => typeof h === 'string')
    : [];

  return { contenu, hashtags, chars: contenu.length };
}

export interface AllPlatformsInput {
  source_contenu: string;
  marque:         string;
  langue:         string;
  sujet:          string;
  entite_nom:     string;
}

export type AllPlatformsOutput = Record<SocialPlatform, FormattedPost>;

export async function formatAllPlatforms(input: AllPlatformsInput): Promise<AllPlatformsOutput> {
  const platforms: SocialPlatform[] = ['linkedin', 'instagram', 'tiktok', 'twitter'];

  // Génération séquentielle pour éviter les rate limits
  const results: Partial<AllPlatformsOutput> = {};
  for (const p of platforms) {
    results[p] = await formatForPlatform({ ...input, plateforme: p });
  }

  await supabase.from('alerts').insert({
    agent_name: 'ITACHI',
    level:      'INFO',
    message:    `Contenu formaté pour 4 plateformes (sujet : ${input.sujet.slice(0, 60)}, entité=${input.entite_nom})`,
  });

  return results as AllPlatformsOutput;
}

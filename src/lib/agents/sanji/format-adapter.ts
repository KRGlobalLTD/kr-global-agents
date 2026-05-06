import { parseJsonSafe } from '@/lib/agents/itachi/content-generator';

export type PubPlatform =
  | 'linkedin_company'
  | 'linkedin_karim'
  | 'linkedin_raphael'
  | 'instagram'
  | 'tiktok'
  | 'facebook';

export interface AdaptedPost {
  platform:   PubPlatform;
  texte:      string;
  hashtags:   string[];
  imagePrompt: string;   // prompt Replicate pour générer le visuel
}

// ─── Profils par plateforme ───────────────────────────────────────────────────

const PLATFORM_PROFILES: Record<PubPlatform, string> = {
  linkedin_company:
    `LinkedIn — Page entreprise KR Global Solutions Ltd.\n` +
    `Ton : professionnel, autoritaire, orienté résultats business.\n` +
    `Structure : accroche forte (jamais commencer par "Nous") → insight clé → CTA vers le site.\n` +
    `Max 1 200 caractères. 3-5 hashtags sectoriels (#IA #Automation #PME #AgenceIA #Innovation).`,

  linkedin_karim:
    `LinkedIn — Profil personnel Karim Hammouche, co-fondateur KR Global Solutions Ltd.\n` +
    `Ton : authentique, expérience personnelle, thought leader entrepreneuriat IA.\n` +
    `Structure : anecdote ou apprentissage perso → valeur actionnable → question engageante.\n` +
    `Max 1 300 caractères. 3-4 hashtags (#Entrepreneuriat #IA #StartupLife #Fondateur).`,

  linkedin_raphael:
    `LinkedIn — Profil personnel Raphaël, co-fondateur KR Global Solutions Ltd.\n` +
    `Ton : authentique, pragmatique, vision tech & produit.\n` +
    `Structure : problème concret rencontré → solution mise en place → leçon tirée.\n` +
    `Max 1 300 caractères. 3-4 hashtags (#Tech #IA #Produit #Fondateur).`,

  instagram:
    `Instagram — Compte @krglobalsolutions.\n` +
    `Ton : inspirant, visuel, lifestyle entrepreneur + agence IA.\n` +
    `Structure : première ligne accrocheuse + emoji → histoire courte → CTA + hashtags.\n` +
    `Max 2 200 caractères. 10-15 hashtags (mix populaires + niche). Emojis bienvenus.`,

  tiktok:
    `TikTok — Compte KR Global.\n` +
    `Format : script court pour vidéo parlée (150 mots max).\n` +
    `Structure : [HOOK 3s] question ou choc → [DÉVELOPPEMENT] problème → solution en 3 points → [CTA] à 80%.\n` +
    `Ton : décontracté, dynamique, langage parlé. 3-5 hashtags tendance (#IA #Entrepreneur #AgenceIA #Tech).`,

  facebook:
    `Facebook — Page KR Global Solutions Ltd.\n` +
    `Ton : communautaire, accessible, légèrement moins formel que LinkedIn.\n` +
    `Structure : accroche question ou statistique → développement → CTA partage ou commentaire.\n` +
    `Max 500 caractères. 2-3 hashtags seulement. Public plus large (PME, dirigeants, non-tech).`,
};

// ─── Prompt image par plateforme ─────────────────────────────────────────────

const IMAGE_STYLE: Record<PubPlatform, string> = {
  linkedin_company:  'professional corporate, modern office, team collaboration, London cityscape, clean minimalist',
  linkedin_karim:    'entrepreneurial portrait, authentic candid, coffeeshop or office, warm lighting, personal brand',
  linkedin_raphael:  'tech workspace, minimalist desk setup, code on screen, modern productive environment',
  instagram:         'vibrant lifestyle, luxury entrepreneur aesthetic, travel or modern city, bold colors, Instagram-worthy',
  tiktok:            'dynamic energetic, bold graphic overlay style, young professional, trending visual',
  facebook:          'approachable business, community feel, diverse team, bright and welcoming office',
};

// ─── Appel OpenRouter ─────────────────────────────────────────────────────────

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
}

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kr-global.com',
      'X-Title':      'SANJI - KR Global',
    },
    body: JSON.stringify({
      model:           'google/gemini-2.0-flash-001',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.7,
      max_tokens:      1500,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as OpenRouterResponse;
  return data.choices?.[0]?.message?.content ?? '{}';
}

// ─── Adaptation pour une plateforme ──────────────────────────────────────────

export async function adaptForPlatform(
  sujet:    string,
  contenu:  string,
  hashtags: string[],
  platform: PubPlatform
): Promise<AdaptedPost> {
  const systemPrompt =
    `Tu es SANJI, l'agent réseaux sociaux de KR Global Solutions Ltd (agence IA, Londres).\n` +
    `Adapte le contenu pour :\n${PLATFORM_PROFILES[platform]}\n\n` +
    `Retourne UNIQUEMENT un JSON valide :\n` +
    `{ "texte": "...", "hashtags": ["mot1", "mot2"], "imagePrompt": "..." }\n` +
    `- "hashtags" : sans le symbole #\n` +
    `- "imagePrompt" : description en anglais pour générer un visuel IA (style : ${IMAGE_STYLE[platform]})\n` +
    `Jamais de données fictives. Adapte le style, conserve le sens.`;

  const userPrompt =
    `Sujet : ${sujet}\n\n` +
    `Contenu source :\n${contenu}\n\n` +
    `Hashtags suggérés : ${hashtags.join(', ')}`;

  const raw    = await callGemini(systemPrompt, userPrompt);
  const parsed = parseJsonSafe(raw);

  const texte = typeof parsed['texte'] === 'string' && parsed['texte'].length > 0
    ? parsed['texte'] : contenu;

  const parsedHashtags = Array.isArray(parsed['hashtags'])
    ? (parsed['hashtags'] as unknown[]).filter((h): h is string => typeof h === 'string')
    : hashtags;

  const imagePrompt = typeof parsed['imagePrompt'] === 'string'
    ? parsed['imagePrompt']
    : `${sujet}, ${IMAGE_STYLE[platform]}, high quality professional photo`;

  return { platform, texte, hashtags: parsedHashtags, imagePrompt };
}

// ─── Adaptation pour toutes les plateformes ──────────────────────────────────

export async function adaptForAllPlatforms(
  sujet:    string,
  contenu:  string,
  hashtags: string[]
): Promise<AdaptedPost[]> {
  const platforms: PubPlatform[] = [
    'linkedin_company',
    'linkedin_karim',
    'linkedin_raphael',
    'instagram',
    'tiktok',
    'facebook',
  ];

  const results = await Promise.allSettled(
    platforms.map(p => adaptForPlatform(sujet, contenu, hashtags, p))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<AdaptedPost> => r.status === 'fulfilled')
    .map(r => r.value);
}

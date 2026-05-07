import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type MarocLanguage = 'ar' | 'darija' | 'fr-MA' | 'bilingual';
export type ContentFormat  = 'email' | 'post_linkedin' | 'post_instagram' | 'blog' | 'pitch' | 'sms';

export interface LocalizationRequest {
  original_content: string;
  target_language:  MarocLanguage;
  format:           ContentFormat;
  sector?:          string;
  brand?:           string;
  tone?:            'formal' | 'conversational' | 'sales';
}

export interface LocalizationResult {
  localization_id:  string;
  original:         string;
  localized:        string;
  target_language:  MarocLanguage;
  format:           ContentFormat;
  cultural_notes:   string[];
  rtl:              boolean;        // right-to-left for ar/darija
}

export async function saveLocalization(
  req:     LocalizationRequest,
  result:  string,
  notes:   string[],
): Promise<LocalizationResult> {
  const { data, error } = await supabase
    .from('maroc_localizations')
    .insert({
      original_content:  req.original_content,
      localized_content: result,
      target_language:   req.target_language,
      format:            req.format,
      cultural_notes:    notes,
      sector:            req.sector ?? null,
    })
    .select('id')
    .single();

  if (error) {
    await supabase.from('alerts').insert({
      agent_name: 'GAARA',
      level:      'WARNING',
      message:    `maroc_localizations insert error: ${error.message}`,
    });
  }

  await supabase.from('alerts').insert({
    agent_name: 'GAARA',
    level:      'INFO',
    message:    `Localisation ${req.target_language} (${req.format}) — ${req.original_content.slice(0, 60)}...`,
  });

  return {
    localization_id: (data as { id: string } | null)?.id ?? '',
    original:        req.original_content,
    localized:       result,
    target_language: req.target_language,
    format:          req.format,
    cultural_notes:  notes,
    rtl:             req.target_language === 'ar' || req.target_language === 'darija',
  };
}

export function buildLocalizationPrompt(req: LocalizationRequest): string {
  const langInstructions: Record<MarocLanguage, string> = {
    'ar': `Traduis et adapte ce contenu en arabe standard moderne (MSA) adapté au marché marocain.
Utilise un registre formel et professionnel.
Pour les emails/pitchs B2B : commence par "السيد/السيدة [Prénom]، أهلاً وسهلاً،" si un nom est mentionné.
Évite les tournures trop formelles du MSA classique — reste accessible.`,

    'darija': `Adapte ce contenu en Darija marocain (dialecte arabe marocain mélangé de français).
Règles Darija : mélange naturel d'arabe marocain et de français, script latin ou arabe selon le contexte.
Pour réseaux sociaux : utilise le script latin (ex: "Salam!", "Khouya", "3ndi", "Wach t3ref").
Pour emails B2B : reste semi-formel, utilise le français pour les termes techniques.
Exemples : "Labas ?", "KR Global kayddem solutions d IA li ghadi t3awnek", "7it n9der n3awnek f..."`,

    'fr-MA': `Adapte ce contenu en français marocain professionnel.
Utilise un ton chaleureux et direct, adapté à la culture business marocaine.
Intègre des références locales pertinentes (secteurs, entreprises, défis marocains).
Exemples de formulations marocaines : "Permettez-moi de vous présenter...", "Dans le cadre de la digitalisation du Maroc..."
Référence au contexte économique marocain si pertinent : Digital Maroc 2030, investissements technologiques, PME marocaines.`,

    'bilingual': `Génère une version bilingue français/arabe.
Structure : [Version française d'abord] puis [النسخة العربية]
Adapte le ton à chaque langue (professionnel en FR, formel MSA en AR).
Assure-toi que les deux versions transmettent le même message avec les nuances culturelles appropriées.`,
  };

  const formatNotes: Record<ContentFormat, string> = {
    email:          'Email B2B professionnel — objet accrocheur, corps structuré, CTA clair.',
    post_linkedin:  'Post LinkedIn — accroche forte, 3-5 paragraphes, hashtags en fin.',
    post_instagram: 'Caption Instagram — emojis pertinents, hashtags mix AR/FR.',
    blog:           'Article blog — titre SEO, intro, 3 sections H2, conclusion + CTA.',
    pitch:          'Pitch commercial — problème, solution KR Global, bénéfices, preuve sociale, CTA.',
    sms:            'SMS court (160 chars max) — percutant et direct.',
  };

  const sectorCtx = req.sector
    ? `\nSecteur cible au Maroc : ${req.sector}. Adapte les exemples et références à ce secteur.`
    : '';

  const brandCtx = req.brand
    ? `\nMarque/entreprise : ${req.brand}.`
    : '';

  return `${langInstructions[req.target_language]}

Format : ${formatNotes[req.format]}${sectorCtx}${brandCtx}

Retourne un JSON valide :
{
  "localized": "contenu localisé complet",
  "cultural_notes": ["note culturelle 1", "note culturelle 2"]
}

Contenu original à localiser :
---
${req.original_content}
---`;
}

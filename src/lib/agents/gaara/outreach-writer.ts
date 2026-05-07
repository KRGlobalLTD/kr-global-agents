import { createClient } from '@supabase/supabase-js';
import type { MarocLanguage } from './content-localizer';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface MarocProspect {
  name:         string;
  company:      string;
  role:         string;
  sector:       string;
  city:         string;
  pain_point?:  string;
  email?:       string;
}

export interface OutreachEmail {
  subject:    string;
  body:       string;
  language:   MarocLanguage;
  prospect:   MarocProspect;
  prospect_id?: string;
}

// Secteurs prioritaires Maroc avec context IA
const SECTOR_CONTEXT: Record<string, string> = {
  finance:     'banques, assurances, fintechs — automatisation KYC, analyse crédit, détection fraude',
  ecommerce:   'e-commerce, retail — chatbots, recommandations personnalisées, gestion stocks',
  bpo:         'centres d\'appels, BPO, outsourcing — agents IA, analyse sentiment, SVI intelligent',
  tech:        'startups tech, ESN — intégration agents IA, automatisation workflows',
  immobilier:  'immobilier, promotion — IA pour leads qualifiés, visites virtuelles, pricing dynamique',
  textile:     'industrie textile, export — contrôle qualité IA, traçabilité, optimisation production',
  tourisme:    'hôtellerie, tourisme — chatbots multilingues, revenue management, analyse avis',
  education:   'universités, edtech — tuteurs IA, correction automatique, personnalisation pédagogique',
};

export function buildOutreachPrompt(
  prospect: MarocProspect,
  language: MarocLanguage,
  emailType: 'initial' | 'followup1' | 'followup2' = 'initial',
): string {
  const sectorCtx = SECTOR_CONTEXT[prospect.sector.toLowerCase()] ?? prospect.sector;

  const followupCtx = emailType === 'followup1'
    ? 'C\'est un premier suivi (J+4). Rappelle brièvement le message précédent, ajoute une preuve sociale ou étude de cas.'
    : emailType === 'followup2'
    ? 'C\'est le deuxième et dernier suivi (J+10). Ton concis, respect de leur temps, CTA doux avec question ouverte.'
    : 'C\'est le premier contact — email d\'approche à froid.';

  const langGuide: Record<MarocLanguage, string> = {
    'fr-MA': `Écris en français marocain professionnel. Ton direct et chaleureux.
Formule d'ouverture : "Bonjour [Prénom]," ou "Monsieur/Madame [Nom],".
Max 150 mots. Structure : accroche pertinente → valeur → preuve → CTA.`,

    'ar': `اكتب بالعربية المعيارية الحديثة المناسبة للمغرب.
الافتتاحية : "السيد/السيدة [الاسم]، أهلاً وسهلاً،"
الأسلوب : رسمي ودافئ. 120 كلمة كحد أقصى.
الهيكل : مقدمة ذات صلة ← القيمة ← دليل ← دعوة للعمل.`,

    'darija': `Écris en Darija marocain (script latin). Ton semi-formel et friendly.
Ouverture : "Salam [Prénom]," ou "Bonjour [Prénom],"
Mix naturel FR/Darija : ex. "KR Global kayddem solutions dyal IA..."
Max 120 mots. Direct et percutant.`,

    'bilingual': `Génère un email bilingue : objet en français, corps avec intro en français puis paragraphe en arabe.
Structure : [Objet FR] | [Corps FR 80 mots] | [--- | النسخة العربية المختصرة 60 كلمة]`,
  };

  return `Tu es GAARA, expert outreach B2B pour le marché marocain de KR Global Solutions Ltd.
KR Global : agence IA londonienne qui automatise les opérations des PME avec des agents IA.

Prospect :
- Nom : ${prospect.name}
- Entreprise : ${prospect.company}
- Poste : ${prospect.role}
- Secteur : ${sectorCtx}
- Ville : ${prospect.city}
${prospect.pain_point ? `- Point de douleur connu : ${prospect.pain_point}` : ''}

${followupCtx}

Instructions langue :
${langGuide[language]}

Retourne un JSON valide :
{
  "subject": "objet email",
  "body": "corps complet de l'email"
}`;
}

export async function saveMarocProspect(prospect: MarocProspect): Promise<string> {
  const { data, error } = await supabase
    .from('prospects')
    .insert({
      name:    prospect.name,
      company: prospect.company,
      email:   prospect.email ?? null,
      need:    prospect.pain_point ?? `Automatisation IA — secteur ${prospect.sector}`,
      source:  'GAARA',
      status:  'prospect_froid',
    })
    .select('id')
    .single();

  if (error) {
    await supabase.from('alerts').insert({
      agent_name: 'GAARA',
      level:      'WARNING',
      message:    `saveMarocProspect error: ${error.message}`,
    });
    return '';
  }

  return (data as { id: string }).id;
}

export async function getMarocProspects(limit = 20): Promise<MarocProspect[]> {
  const { data, error } = await supabase
    .from('prospects')
    .select('name, company, need, email')
    .eq('source', 'GAARA')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getMarocProspects: ${error.message}`);

  return (data ?? []).map(r => ({
    name:        r.name as string    ?? '',
    company:     r.company as string ?? '',
    role:        'Décideur',
    sector:      'tech',
    city:        'Casablanca',
    pain_point:  r.need as string    ?? undefined,
    email:       r.email as string   ?? undefined,
  }));
}

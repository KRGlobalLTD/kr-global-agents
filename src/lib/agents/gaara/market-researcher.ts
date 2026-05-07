import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface MarocMarketInsight {
  sector:         string;
  opportunity:    string;
  key_players:    string[];
  ai_use_cases:   string[];
  entry_barriers: string[];
  estimated_tam:  string;
  priority:       'high' | 'medium' | 'low';
}

export interface MarocMarketReport {
  generated_at:    string;
  sectors:         MarocMarketInsight[];
  macro_context:   string;
  recommendations: string[];
}

// Connaissance marché Maroc intégrée (évite dépendance scraping)
export const MAROC_MARKET_KNOWLEDGE: MarocMarketInsight[] = [
  {
    sector:       'BPO / Centres d\'appels',
    opportunity:  'Leader africain du BPO avec +100k employés. Migration vers agents IA pour traitement L1/L2.',
    key_players:  ['Intelcia', 'Outsource Global', 'TELUS International', 'Majorel'],
    ai_use_cases: ['Agents IA bilingues FR/AR', 'Analyse sentiment temps réel', 'SVI intelligent', 'Résumé automatique d\'appels'],
    entry_barriers: ['Relations client long terme', 'Certifications ISO', 'Volume minimum'],
    estimated_tam:  '~2Md MAD (services IA)',
    priority:       'high',
  },
  {
    sector:       'Finance & Banques',
    opportunity:  'Attijariwafa, CIH, Banque Populaire en pleine transformation digitale (Bank Al-Maghrib FinTech Lab).',
    key_players:  ['Attijariwafa Bank', 'CIH Bank', 'Banque Populaire', 'BMCE', 'Cashplus'],
    ai_use_cases: ['KYC automatisé', 'Scoring crédit IA', 'Détection fraude', 'Chatbot client bilingue'],
    entry_barriers: ['Réglementation Bank Al-Maghrib', 'Conformité CNDP', 'Cycles de vente longs'],
    estimated_tam:  '~5Md MAD (digitalisation bancaire)',
    priority:       'high',
  },
  {
    sector:       'E-commerce & Retail',
    opportunity:  'Croissance 25%/an portée par Jumia, Hmizate. PME cherchent à automatiser service client.',
    key_players:  ['Jumia Maroc', 'Hmizate', 'Glovo', 'Marjane', 'Label\'Vie'],
    ai_use_cases: ['Chatbot SAV multilingue', 'Recommandations personnalisées', 'Prédiction stocks', 'Prix dynamiques'],
    entry_barriers: ['Concurrence prix', 'Intégration systèmes legacy'],
    estimated_tam:  '~800M MAD (tech e-commerce)',
    priority:       'high',
  },
  {
    sector:       'Immobilier & Construction',
    opportunity:  'Boom immobilier (programme 300k logements). Promoteurs cherchent leads qualifiés et automatisation.',
    key_players:  ['Addoha', 'Alliances', 'CIH Bank Immobilier', 'Mubawab'],
    ai_use_cases: ['IA qualification leads', 'Chatbot visite virtuelle', 'Pricing prédictif', 'Analyse marché'],
    entry_barriers: ['Relations directes avec promoteurs', 'Connaissance réglementaire'],
    estimated_tam:  '~300M MAD',
    priority:       'medium',
  },
  {
    sector:       'Tourisme & Hôtellerie',
    opportunity:  'Objectif 26M touristes/an (Vision 2030). Hôtels 4-5* cherchent à personnaliser l\'expérience.',
    key_players:  ['Sofitel Maroc', 'Ibis', 'Accor Maroc', 'Royal Air Maroc', 'Booking.com Maroc'],
    ai_use_cases: ['Chatbot multilingue (AR/FR/EN/ES)', 'Revenue management IA', 'Analyse avis clients', 'Upselling automatisé'],
    entry_barriers: ['Groupes internationaux avec solutions centralisées', 'Budget IT limité PME'],
    estimated_tam:  '~200M MAD',
    priority:       'medium',
  },
  {
    sector:       'Education & EdTech',
    opportunity:  'Maroc investi massivement dans l\'éducation (4-5% PIB). Universités + écoles privées en digitalisation.',
    key_players:  ['UM6P (Mohammed VI Polytechnic)', 'HEM', 'ESCA', 'ALX Africa Maroc'],
    ai_use_cases: ['Tuteurs IA adaptatifs', 'Correction automatique', 'Détection décrochage', 'Contenu personnalisé'],
    entry_barriers: ['Cycles décision longs secteur public', 'Budget contraint universités publiques'],
    estimated_tam:  '~150M MAD',
    priority:       'medium',
  },
];

const CNDP_KNOWLEDGE = `
CNDP — Commission Nationale de contrôle de la protection des Données à caractère Personnel (Maroc)
Loi 09-08 relative à la protection des personnes physiques à l'égard du traitement des données à caractère personnel.

Points clés :
1. DÉCLARATION PRÉALABLE : Tout traitement de données personnelles doit être déclaré à la CNDP (sauf exemptions)
2. FINALITÉ : Données collectées pour finalité déterminée, explicite et légitime
3. CONSENTEMENT : Consentement explicite requis pour données sensibles (santé, biométrie, opinions politiques)
4. DROITS PERSONNES : Droit d'accès, rectification, opposition, suppression
5. TRANSFERT INTERNATIONAL : Encadré — pays avec protection adéquate ou clauses contractuelles
6. RESPONSABLE TRAITEMENT : Obligation de sécurité et confidentialité
7. SANCTIONS : Art. 52-54 — amendes jusqu'à 300k MAD, emprisonnement possible

Pour une agence IA traitant données clients marocains :
- Déclarer le traitement à la CNDP (formulaire en ligne)
- Politique de confidentialité en arabe et français
- Contrats DPA avec sous-traitants (Supabase, OpenAI...)
- Stockage données : préférer serveurs EU/Maroc
- Retention policy documentée
`;

export function getMarketKnowledge(sector?: string): MarocMarketInsight[] {
  if (!sector) return MAROC_MARKET_KNOWLEDGE;
  const lower = sector.toLowerCase();
  return MAROC_MARKET_KNOWLEDGE.filter(m =>
    m.sector.toLowerCase().includes(lower) ||
    m.ai_use_cases.some(u => u.toLowerCase().includes(lower))
  );
}

export function getCNDPKnowledge(): string {
  return CNDP_KNOWLEDGE.trim();
}

export function buildMarketResearchPrompt(sector?: string, question?: string): string {
  const insights = getMarketKnowledge(sector);
  const insightsStr = JSON.stringify(insights, null, 2);

  return `Tu es GAARA, expert marché marocain de KR Global Solutions Ltd.

DONNÉES MARCHÉ MAROC (IA & Automatisation) :
${insightsStr}

CONTEXTE MACRO :
- Programme Digital Maroc 2030 : +25Md MAD d'investissements tech
- Maroc : hub technologique Afrique + Europe francophone
- 65% PME marocaines non encore digitalisées (opportunité massive)
- Langue : FR (officiel business), AR (administrations), Darija (quotidien), Amazigh
- Timezone : GMT+1 (proche UK, idéal pour KR Global)
${question ? `\nQuestion spécifique : ${question}` : ''}

Génère une analyse de marché structurée avec recommandations de ciblage pour KR Global.
Priorise les secteurs à fort potentiel IA et cycle de vente court.`;
}

export async function saveMarketInsight(
  sector:     string,
  insight:    string,
  source:     string,
): Promise<void> {
  supabase.from('research_insights').insert({
    agent_name: 'GAARA',
    topic:      `Maroc — ${sector}`,
    summary:    insight.slice(0, 500),
    source_url: source,
    tags:       ['maroc', sector.toLowerCase(), 'ia', 'marché'],
  }).then(() => undefined, () => undefined);  // non-blocking, ignore errors
}

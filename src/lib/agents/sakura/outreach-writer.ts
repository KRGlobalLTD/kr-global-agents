import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type FranceEmailType = 'cold_email' | 'linkedin_connect' | 'linkedin_message' | 'followup1' | 'followup2' | 'proposal_intro';

export interface FranceProspect {
  civilite:    'Monsieur' | 'Madame';
  nom:         string;
  prenom:      string;
  poste:       string;
  entreprise:  string;
  secteur:     string;
  taille:      'startup' | 'pme' | 'eti' | 'grand_compte';
  ville:       string;
  pain_point?: string;
  email?:      string;
  linkedin?:   string;
}

// Culture B2B française — règles strictes
const FRENCH_B2B_RULES = `RÈGLES OUTREACH B2B FRANÇAIS :
- Toujours "Monsieur [Nom]," ou "Madame [Nom]," — jamais le prénom seul en premier contact
- Pas de point d'exclamation en français formel
- Pas de superlatifs ("révolutionnaire", "incroyable") — perçus comme vendeur
- Pas d'anglicismes inutiles — préférer "analyse" à "insights", "automatisation" à "workflow"
- Posture conseil, pas vente : "Je me demandais si..." plutôt que "Je veux vous proposer..."
- RGPD mention si données personnelles — crédibilité auprès des DSI/DPO
- Références françaises : Station F, BPI France, French Tech, CAC 40 si pertinent
- Email court = puissant : max 5 lignes pour cold, 3 lignes pour followup
- LinkedIn : 300 chars max pour note de connexion, jamais de pitch dans la demande de connexion
- Délai followup : J+7 minimum (pas de relance J+2 comme aux US)`;

// Spécificités par taille d'entreprise
const SIZE_CONTEXT: Record<FranceProspect['taille'], string> = {
  startup:      'Startup / Scale-up (< 50 salariés) : décision rapide, budget tech limité mais réactivité IA forte, fondateur = DG = décideur',
  pme:          'PME (50-250 salariés) : DAF + DG co-décident, cycle 1-3 mois, ROI chiffré attendu, référence client similaire très efficace',
  eti:          'ETI (250-5000 salariés) : DSI impliqué, appel d\'offre possible, compliance RGPD incontournable, 3-6 mois cycle',
  grand_compte: 'Grand compte / CAC 40 : multiple stakeholders (DG/DSI/DPO/DAF), sourcing via cabinet, RGPD + AI Act = prérequis, 6-18 mois cycle',
};

export function buildFranceOutreachPrompt(
  prospect: FranceProspect,
  type: FranceEmailType,
): string {
  const followupContext = {
    cold_email:       'Premier contact à froid par email.',
    linkedin_connect: 'Note de demande de connexion LinkedIn (300 chars MAX, pas de pitch).',
    linkedin_message: 'Message LinkedIn après connexion acceptée (300 chars MAX, one clear ask).',
    followup1:        'Première relance (J+7). Rappel discret, nouvel angle, question ouverte.',
    followup2:        'Deuxième relance (J+14). Dernier message, fermer la boucle élégamment.',
    proposal_intro:   'Email d\'introduction d\'une proposition commerciale suite à un échange.',
  }[type];

  return `Tu es SAKURA, expert prospection B2B marché français de KR Global Solutions Ltd.
KR Global : agence IA londonienne — agents IA qui automatisent les opérations des entreprises.

${FRENCH_B2B_RULES}

Prospect cible :
- ${prospect.civilite} ${prospect.prenom} ${prospect.nom} — ${prospect.poste}
- Entreprise : ${prospect.entreprise} (${SIZE_CONTEXT[prospect.taille]})
- Secteur : ${prospect.secteur} | Ville : ${prospect.ville}
${prospect.pain_point ? `- Point de douleur : ${prospect.pain_point}` : ''}

Type de message : ${followupContext}

Génère un message percutant, bref et professionnel.
Retourne un JSON valide :
{
  "subject": "objet email (si applicable, sinon null)",
  "body": "corps du message"
}`;
}

// Secteurs clés France
export const FRANCE_SECTORS: Record<string, {
  key_players: string[];
  ai_use_cases: string[];
  decision_makers: string[];
  compliance_angle: string;
}> = {
  'tech_esn': {
    key_players:     ['Capgemini', 'Sopra Steria', 'Atos', 'Devoteam', 'Wavestone'],
    ai_use_cases:    ['Automatisation code review', 'Agents support niveau 1/2', 'Génération doc technique', 'IA pour gestion de projet'],
    decision_makers: ['CTO', 'DSI', 'Directeur Innovation', 'Practice Manager IA'],
    compliance_angle: 'RGPD data processing agreements avec clients — avantage de traçabilité IA',
  },
  'finance': {
    key_players:     ['BNP Paribas', 'Société Générale', 'Crédit Agricole', 'AXA', 'Allianz'],
    ai_use_cases:    ['KYC automatisé', 'Analyse crédit IA', 'Détection fraude', 'Rapport réglementaire automatisé'],
    decision_makers: ['CDO', 'DSI', 'DPO', 'Responsable Conformité', 'DAF'],
    compliance_angle: 'RGPD + DORA (résilience opérationnelle) + AI Act catégorie haut risque pour crédit',
  },
  'retail_ecommerce': {
    key_players:     ['Carrefour', 'Fnac-Darty', 'La Redoute', 'Cdiscount', 'Veepee'],
    ai_use_cases:    ['Personnalisation produits', 'Chatbot SAV multilingue', 'Prédiction stocks', 'Prix dynamiques'],
    decision_makers: ['CMO', 'CDO', 'Responsable E-commerce', 'DSI'],
    compliance_angle: 'RGPD + ePrivacy (cookies) + droit de rétractation e-commerce',
  },
  'industrie': {
    key_players:     ['Michelin', 'Schneider Electric', 'Renault', 'Airbus', 'Saint-Gobain'],
    ai_use_cases:    ['Maintenance prédictive', 'Contrôle qualité vision IA', 'Optimisation chaîne', 'Jumeaux numériques'],
    decision_makers: ['DSI', 'Directeur Industrie 4.0', 'CTO', 'Directeur Opérations'],
    compliance_angle: 'NIS2 (cybersécurité infrastructures) + AI Act haute criticité production',
  },
  'sante': {
    key_players:     ['Doctolib', 'Elsan', 'Ramsay Santé', 'AP-HP', 'Medicalib'],
    ai_use_cases:    ['Aide au diagnostic', 'Planification RDV IA', 'Analyse dossiers patients', 'Facturation automatisée'],
    decision_makers: ['DSI', 'Médecin DIM', 'Directeur Médical', 'DAF'],
    compliance_angle: 'Données de santé = données sensibles RGPD art.9 — hébergeur HDS (Hébergeur Données Santé) obligatoire',
  },
  'immobilier': {
    key_players:     ['Nexity', 'Bouygues Immobilier', 'SeLoger', 'Meilleurs Agents', 'Foncia'],
    ai_use_cases:    ['Estimation IA', 'Qualification leads', 'Visite virtuelle', 'Gestion locative automatisée'],
    decision_makers: ['DG', 'Directeur Marketing', 'CDO', 'DSI'],
    compliance_angle: 'RGPD données acheteurs + conformité DPE (diagnostic performance énergétique) obligatoire',
  },
};

export async function saveFranceProspect(prospect: FranceProspect): Promise<string> {
  const { data, error } = await supabase
    .from('prospects')
    .insert({
      name:    `${prospect.prenom} ${prospect.nom}`,
      company: prospect.entreprise,
      email:   prospect.email ?? null,
      need:    prospect.pain_point ?? `Automatisation IA — ${prospect.secteur}`,
      source:  'SAKURA',
      status:  'prospect_froid',
    })
    .select('id')
    .single();

  if (error) {
    await supabase.from('alerts').insert({
      agent_name: 'SAKURA',
      level:      'WARNING',
      message:    `saveFranceProspect error: ${error.message}`,
    });
    return '';
  }

  return (data as { id: string }).id;
}

export async function getFranceProspects(limit = 20): Promise<FranceProspect[]> {
  const { data, error } = await supabase
    .from('prospects')
    .select('name, company, need, email')
    .eq('source', 'SAKURA')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getFranceProspects: ${error.message}`);

  return (data ?? []).map(r => {
    const parts = ((r.name as string) ?? '').split(' ');
    return {
      civilite:   'Monsieur' as const,
      prenom:     parts[0] ?? '',
      nom:        parts.slice(1).join(' '),
      poste:      'Directeur',
      entreprise: (r.company as string) ?? '',
      secteur:    'tech_esn',
      taille:     'pme' as const,
      ville:      'Paris',
      pain_point: r.need as string | undefined,
      email:      r.email as string | undefined,
    };
  });
}

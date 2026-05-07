// Connaissance RGPD / CNIL / EU AI Act intégrée — pas de dépendance réseau

export interface ComplianceCheck {
  use_case:        string;
  risk_level:      'low' | 'medium' | 'high' | 'critical';
  legal_basis:     string;
  obligations:     string[];
  blockers:        string[];
  recommendations: string[];
  dpo_required:    boolean;
  aipd_required:   boolean;
}

export const RGPD_KNOWLEDGE = `
RGPD — Règlement Général sur la Protection des Données (UE 2016/679)
Implémenté en France par la Loi Informatique et Libertés (révisée 2018 + 2021)
Autorité de contrôle : CNIL (Commission Nationale de l'Informatique et des Libertés)

BASES LÉGALES (art. 6 RGPD) — une seule suffit :
1. Consentement : libre, éclairé, spécifique, univoque — révocable à tout moment
2. Exécution d'un contrat : traitement nécessaire à l'exécution
3. Obligation légale : obligation imposée par le droit UE ou national
4. Sauvegarde des intérêts vitaux : urgence médicale
5. Mission d'intérêt public : organismes publics
6. Intérêts légitimes (LIA) : si pas prévaut sur droits personnes — à documenter

DROITS DES PERSONNES :
- Droit d'accès (art. 15) : réponse sous 1 mois
- Droit de rectification (art. 16)
- Droit à l'effacement / "droit à l'oubli" (art. 17)
- Droit à la limitation du traitement (art. 18)
- Droit à la portabilité (art. 20)
- Droit d'opposition (art. 21) — notamment au profilage
- Droits relatifs aux décisions automatisées (art. 22)

OBLIGATIONS CLÉS :
- Registre des activités de traitement (obligatoire > 250 personnes ou traitements à risque)
- Privacy by design et by default (art. 25)
- Sécurité des traitements (art. 32) — chiffrement, pseudonymisation
- Notification violation données : CNIL sous 72h + personnes si risque élevé
- AIPD (Analyse d'Impact) : obligatoire pour traitements à risque élevé

DPO (Délégué à la Protection des Données) — obligatoire pour :
- Organismes publics
- Traitements à grande échelle de données sensibles
- Surveillance systématique à grande échelle
Pour une agence IA : recommandé dès que traitement de données clients à grande échelle

DONNÉES SENSIBLES (art. 9 RGPD) — interdit sauf exception :
Race/ethnie, opinions politiques, convictions religieuses, données génétiques,
données biométriques, santé, vie sexuelle, appartenance syndicale

TRANSFERTS HORS UE :
- Pays adéquats : UK post-Brexit (décision adéquation 2021, à renouveler), États-Unis (DPF 2023)
- Sinon : clauses contractuelles types (CCT), BCR, dérogations art. 49

SANCTIONS CNIL :
- Amende administrative : jusqu'à 4% CA mondial annuel OU 20M€ (le plus élevé)
- Mise en demeure, injonction, suspension traitement
- Exemples 2023-2024 : Meta 1,2Md€, TikTok 345M€, Clearview 20M€ (FR)

RECOMMANDATIONS CNIL SUR L'IA :
- Janvier 2024 : recommandations sur les systèmes d'IA
- Base légale : intérêt légitime souvent applicable pour IA B2B
- Transparence : informer les personnes du traitement automatisé
- Opt-out : permettre l'opposition aux décisions automatisées
- Données d'entraînement : vérifier licéité de la collecte originale
`.trim();

export const AI_ACT_KNOWLEDGE = `
EU AI ACT — Règlement UE 2024/1689 — Entrée en vigueur progressive 2024-2027
Premier règlement mondial sur l'IA — approche basée sur les risques

CATÉGORIES DE RISQUE :
1. RISQUE INACCEPTABLE (interdit depuis fév. 2025) :
   - Notation sociale par autorités publiques
   - Manipulation subliminale
   - Exploitation des vulnérabilités (âge, handicap)
   - Identification biométrique en temps réel dans espaces publics (sauf exceptions)

2. RISQUE ÉLEVÉ (obligations lourdes) :
   - Infrastructures critiques
   - Éducation / formation professionnelle
   - Emploi / recrutement / gestion RH
   - Services essentiels (crédit, assurance)
   - Application de la loi
   - Administration de la justice
   - Gestion des migrations
   OBLIGATIONS : documentation technique, transparence, supervision humaine,
   précision/robustesse testées, enregistrement dans base EU, marquage CE

3. RISQUE LIMITÉ (obligations de transparence) :
   - Chatbots → informer l'utilisateur qu'il parle à une IA
   - Deepfakes → étiquetage obligatoire
   - Systèmes générateurs de contenu → transparence

4. RISQUE MINIMAL (libre) :
   - Filtres anti-spam, jeux IA, recommandations non critiques

POUR UNE AGENCE IA (KR Global) :
- Agents email/prospecting → risque minimal/limité → transparence suffit
- Agents RH/recrutement → risque élevé → obligations lourdes
- Agents finance/crédit → risque élevé → DORA + AI Act
- Chatbots clients → risque limité → informer que c'est une IA
- Générateurs de contenu → risque limité → étiquetage si deepfake

CALENDRIER :
- Fév. 2025 : interdictions risque inacceptable
- Août 2025 : obligations GPAI (IA à usage général, ex: GPT)
- Août 2026 : systèmes à haut risque (sauf Annexe I)
- Août 2027 : tous systèmes IA à risque élevé
`.trim();

export const CNIL_GUIDES = `
GUIDES PRATIQUES CNIL :
- Cookies & traceurs : consentement obligatoire sauf cookies techniques
- Prospection commerciale B2B : intérêt légitime possible, opt-out obligatoire
- Recrutement : CVthèque → durée conservation 2 ans max
- IA & données personnelles : recommandations jan. 2024
- Données RH : registre + information salariés obligatoire
- Sous-traitance : DPA (accord de traitement des données) avec chaque sous-traitant

DURÉES DE CONSERVATION RECOMMANDÉES :
- Données prospects (non convertis) : 3 ans max depuis dernier contact
- Données clients : durée contractuelle + 5 ans (prescription commerciale)
- Données candidats recrutement : 2 ans
- Logs/traces : 6 mois à 1 an selon criticité
- Données de facturation : 10 ans (obligation comptable)
`.trim();

export function buildRGPDPrompt(useCase: string): string {
  return `Tu es SAKURA, expert RGPD et conformité IA de KR Global Solutions Ltd.

RÉFÉRENTIEL RGPD :
${RGPD_KNOWLEDGE}

EU AI ACT :
${AI_ACT_KNOWLEDGE}

GUIDES CNIL :
${CNIL_GUIDES}

Analyse la conformité RGPD et EU AI Act pour ce cas d'usage :
"${useCase}"

Structure ta réponse :
1. Niveau de risque (low/medium/high/critical) et justification
2. Base légale applicable et documentation requise
3. Obligations spécifiques (registre, AIPD, DPO, notifications...)
4. Blockers identifiés (points de non-conformité critique)
5. Plan d'action recommandé (priorisé par urgence)
6. Points à clarifier avec un avocat spécialisé`;
}

export function buildAIActPrompt(systemDescription: string): string {
  return `Tu es SAKURA, expert EU AI Act de KR Global Solutions Ltd.

EU AI ACT (complet) :
${AI_ACT_KNOWLEDGE}

Catégorise ce système IA et liste les obligations applicables :
"${systemDescription}"

Retourne un JSON :
{
  "risk_category": "unacceptable|high|limited|minimal",
  "justification": "...",
  "obligations": ["..."],
  "timeline": "...",
  "action_required": ["..."],
  "provider_vs_deployer": "..."
}`;
}

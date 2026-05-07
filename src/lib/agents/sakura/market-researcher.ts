import { createClient } from '@supabase/supabase-js';
import { FRANCE_SECTORS } from './outreach-writer';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const FRANCE_MARKET_CONTEXT = `
MARCHÉ FRANCE — CONTEXTE IA & AUTOMATISATION 2025-2026

MACRO :
- 3ème économie Europe, 7ème mondiale — PIB ~2 900 Md€
- 3,8M PME (99,8% des entreprises) — cœur de cible KR Global
- Station F (Paris) : plus grand campus startup du monde — 1000+ startups résidentes
- French Tech : label gouvernemental, 25 capitales régionales
- Plan France 2030 : 54Md€ investis dont 1,5Md€ IA spécifiquement
- BPI France : financement public PME — acheteur de solutions tech
- Marché services IA France 2025 : ~4,5Md€ (+35%/an)

COMPORTEMENT ACHETEUR B2B FRANÇAIS :
- Cycle décision long (3-12 mois selon taille) vs UK (1-3 mois)
- Appel d'offres (AO) : obligation > 50k€ dans secteur public
- Référence client : obligatoire pour grands comptes — "avez-vous travaillé avec X ?"
- ROI chiffré : obligation de présenter gains en € et % — pas de promesses vagues
- Pilote/POC : préféré pour limiter risque — démarrer petit, scaler si succès
- DSI/DPO impliqués dès 50 salariés : conformité RGPD = prérequis non négociable
- Prix : pas nécessairement le critère #1 — qualité et conformité priment

CANAUX D'ACQUISITION :
- LinkedIn : canal B2B dominant — 26M utilisateurs actifs mensuels en France
- Salons : Viva Technology (Paris, mai), Big Data & AI Paris (nov.), Tech for Retail (nov.)
- Apporteurs d'affaires : avocats, experts-comptables, DSI en freelance
- Contenu : articles LinkedIn, livres blancs (très valorisés en France)
- Cold email : taux d'ouverture 20-25% avec personnalisation, relance J+7

AVANTAGE KR GLOBAL EN FRANCE :
- Agence UK = neutralité — pas concurrent d'une ESN française
- Tarifs compétitifs vs Paris (coût de vie London mais positionnement international)
- Agents IA multilingues (FR/EN/AR) = différenciateur unique
- RGPD compliance UK (équivalence) : data processing dans UE/UK acceptable
- Référence Maroc : montre capacité à adapter aux marchés francophones

SECTEURS PRIORITAIRES (par potentiel KR Global) :
1. PME Tech/ESN : clients digitaux, budget tech, décision rapide — PRIORITÉ HAUTE
2. Finance/Fintech : budget élevé, RGPD complexe, AI Act = besoin conseil — PRIORITÉ HAUTE
3. E-commerce : automatisation SAV, marketing IA — PRIORITÉ HAUTE
4. Industrie 4.0 : gros budgets, cycles longs, transformer avec IA — PRIORITÉ MOYENNE
5. Santé : données sensibles → compliance lourde, mais marché massif — PRIORITÉ MOYENNE
6. Immobilier : en digitalisation rapide, PME nombreuses — PRIORITÉ BASSE

CONCURRENTS LOCAUX À CONNAÎTRE :
- Doctrine.ai, Nabla : IA verticale (légal, santé) — très spécialisés
- Quantmetry, Artefact : conseil IA/data — positionnement cabinet de conseil
- Hugging Face : IA open source, pas concurrent direct
- IBM France, Accenture : grands comptes — ne jouent pas sur le terrain des PME
`.trim();

export function buildFranceMarketPrompt(sector?: string, question?: string): string {
  const sectorData = sector ? FRANCE_SECTORS[sector] : null;
  const sectorCtx  = sectorData ? `\nDONNÉES SECTEUR "${sector}" :\n${JSON.stringify(sectorData, null, 2)}` : '';

  return `Tu es SAKURA, experte marché français et stratégie d'expansion de KR Global Solutions Ltd.

CONTEXTE MARCHÉ FRANCE :
${FRANCE_MARKET_CONTEXT}
${sectorCtx}

${question ? `Question spécifique : ${question}` : 'Génère une analyse de marché pour KR Global ciblant la France.'}

Priorise les recommandations par impact/effort (quick wins d'abord).
Inclus : cibles prioritaires, stratégie d'entrée, messages clés, timeline réaliste.`;
}

export function getFranceSectorData(sector?: string) {
  if (!sector) return FRANCE_SECTORS;
  const key = sector.toLowerCase().replace(/\s+/g, '_');
  const match = Object.entries(FRANCE_SECTORS).find(([k]) =>
    k.toLowerCase().includes(key) || key.includes(k.toLowerCase())
  );
  return match ? { [match[0]]: match[1] } : FRANCE_SECTORS;
}

export async function saveFranceInsight(sector: string, insight: string): Promise<void> {
  supabase.from('research_insights').insert({
    agent_name: 'SAKURA',
    topic:      `France — ${sector}`,
    summary:    insight.slice(0, 500),
    source_url: 'SAKURA internal knowledge',
    tags:       ['france', sector.toLowerCase(), 'ia', 'rgpd'],
  }).then(() => undefined, () => undefined);
}

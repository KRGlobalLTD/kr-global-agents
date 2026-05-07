import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser }  from '@langchain/core/output_parsers';
import { getLLM }              from '@/lib/langchain/llm';

export const KR_PACKAGES = {
  starter: {
    price:    1500,
    currency: 'GBP',
    services: [
      'Stratégie contenu LinkedIn (2 posts/semaine)',
      'Prospecting B2B automatisé (50 leads/mois)',
      'Rapport mensuel KPI',
    ],
    target: 'PME, startups < 10 salariés',
  },
  growth: {
    price:    3000,
    currency: 'GBP',
    services: [
      'Contenu multi-plateforme (5 posts/semaine)',
      'Prospecting B2B avancé (200 leads/mois)',
      'Veille concurrentielle hebdomadaire',
      'Rapport KPI hebdomadaire',
      'Support email 5j/7',
    ],
    target: 'Scale-ups, PME 10-50 salariés',
  },
  enterprise: {
    price:    6000,
    currency: 'GBP',
    services: [
      'Stratégie IA complète sur mesure',
      'Contenu illimité toutes plateformes',
      'Prospecting avancé (500+ leads/mois)',
      'Agents IA dédiés à votre marque',
      'Intégrations CRM/ERP personnalisées',
      'Account manager dédié',
    ],
    target: 'ETI, grandes PME 50+ salariés',
  },
} as const;

const SYSTEM = `Tu es SHIKAMARU, expert en pricing dynamique de KR Global Solutions Ltd (agence IA, Londres UK).

Packages KR Global (GBP/mois) :
- Starter £1500 — PME/startups < 10 salariés
- Growth £3000 — Scale-ups, PME 10-50 salariés
- Enterprise £6000 — ETI, grandes entreprises 50+

Concurrents marché UK 2026 :
- Agences marketing classiques : £800-2000/mois (sans IA)
- Agences IA spécialisées UK : £2500-8000/mois
- Freelances IA senior : £500-1500/mois
- Automation agencies : £1500-4000/mois

Positionnement KR Global : IA autonome 24/7, 13+ agents spécialisés, ROI mesurable, reporting temps réel.

Retourne UNIQUEMENT un JSON valide, sans markdown.`;

const analysisChain = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM],
  ['human', '{input}'],
]).pipe(getLLM(true)).pipe(new StringOutputParser());

function extractJson(raw: string): string {
  const s = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  return a !== -1 && b > a ? s.slice(a, b + 1) : s;
}

export interface MarketAnalysis {
  recommended_package: 'starter' | 'growth' | 'enterprise' | 'custom';
  recommended_price:   number;
  currency:            string;
  reasoning:           string;
  upsell_opportunity:  string | null;
  competitor_position: string;
  discount_max_pct:    number;
}

export async function analyzeProspectPricing(brief: string): Promise<MarketAnalysis> {
  const raw = await analysisChain.invoke({
    input: `Analyse ce prospect et recommande le package KR Global optimal :\n\n${brief}\n\nRetourne :\n{{\n  "recommended_package": "starter|growth|enterprise|custom",\n  "recommended_price": 3000,\n  "currency": "GBP",\n  "reasoning": "explication courte",\n  "upsell_opportunity": "suggestion ou null",\n  "competitor_position": "vs concurrents",\n  "discount_max_pct": 10\n}}`,
  });
  return JSON.parse(extractJson(raw)) as MarketAnalysis;
}

export function getMarketRates(): { packages: typeof KR_PACKAGES; position: string; updated: string } {
  return {
    packages: KR_PACKAGES,
    position: 'Premium — IA autonome multi-agents, ROI mesurable, reporting temps réel',
    updated:  new Date().toISOString().split('T')[0],
  };
}

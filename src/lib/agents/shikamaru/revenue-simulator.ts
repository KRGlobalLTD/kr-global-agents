// AI + infra cost estimate per active client per month (GBP)
const COST_PER_CLIENT = 180;

export interface RevenueScenario {
  label:            string;
  clients:          number;
  package:          string;
  monthly_price:    number;
  monthly_revenue:  number;
  annual_revenue:   number;
  costs_estimated:  number;
  net_margin:       number;
  net_margin_pct:   number;
}

export interface RevenueSimulation {
  scenarios:             RevenueScenario[];
  breakeven_clients:     number;
  target_5k_clients:     number;
  current_mrr_estimate:  number;
  recommended_focus:     string;
}

const SCENARIOS = [
  { label: 'Starter uniquement (£1500)', clients: 5, price: 1500, pkg: 'starter' },
  { label: 'Growth uniquement (£3000)',  clients: 3, price: 3000, pkg: 'growth'  },
  { label: 'Mix Starter + Growth',       clients: 4, price: 2250, pkg: 'mixed'   },
  { label: 'Enterprise focus (£6000)',   clients: 2, price: 6000, pkg: 'enterprise' },
];

export function simulateRevenue(
  currentClients = 0,
  currentMrr     = 0,
): RevenueSimulation {
  const scenarios: RevenueScenario[] = SCENARIOS.map(s => {
    const revenue = s.clients * s.price;
    const costs   = s.clients * COST_PER_CLIENT;
    const net     = revenue - costs;
    return {
      label:           s.label,
      clients:         s.clients,
      package:         s.pkg,
      monthly_price:   s.price,
      monthly_revenue: revenue,
      annual_revenue:  revenue * 12,
      costs_estimated: costs,
      net_margin:      net,
      net_margin_pct:  Math.round((net / revenue) * 100),
    };
  });

  // Add scenario targeting the 5k€/month goal (≈ £4300/month at EUR/GBP ~0.86)
  const target5kGbp    = Math.round(5000 * 0.86);
  const avgPrice       = 2250;
  const clientsFor5k   = Math.ceil(target5kGbp / avgPrice);
  const rev5k          = clientsFor5k * avgPrice;
  const costs5k        = clientsFor5k * COST_PER_CLIENT;
  scenarios.push({
    label:           `Objectif 5k€/mois (${clientsFor5k} clients mix)`,
    clients:         clientsFor5k,
    package:         'mixed',
    monthly_price:   avgPrice,
    monthly_revenue: rev5k,
    annual_revenue:  rev5k * 12,
    costs_estimated: costs5k,
    net_margin:      rev5k - costs5k,
    net_margin_pct:  Math.round(((rev5k - costs5k) / rev5k) * 100),
  });

  return {
    scenarios,
    breakeven_clients:    Math.ceil(COST_PER_CLIENT / 1500 * 3),
    target_5k_clients:    clientsFor5k,
    current_mrr_estimate: currentMrr || currentClients * avgPrice,
    recommended_focus:    currentClients < 3
      ? 'Priorité Starter — acquisition rapide, barrière entrée basse'
      : 'Upsell vers Growth — maximise MRR par client',
  };
}

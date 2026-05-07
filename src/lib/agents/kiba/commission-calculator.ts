import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// KR Global package prices (GBP)
const PACKAGE_PRICES = { starter: 1500, growth: 3000, enterprise: 6000 } as const;
type PackageName = keyof typeof PACKAGE_PRICES;

export interface CommissionEstimate {
  partner_id:           string;
  company:              string;
  commission_rate:      number;
  referred_clients:     number;
  total_revenue_gbp:    number;
  total_commission_gbp: number;
  projected_12m_gbp:    number;
  tier:                 'standard' | 'premium';
}

export async function calculateCommission(partnerId: string): Promise<CommissionEstimate> {
  const { data, error } = await supabase
    .from('partners')
    .select('company, commission_rate, referred_clients, total_revenue')
    .eq('id', partnerId)
    .single();
  if (error) throw new Error(error.message);

  const rate       = (data['commission_rate']  as number) ?? 15;
  const clients    = (data['referred_clients'] as number) ?? 0;
  const revenue    = (data['total_revenue']    as number) ?? 0;
  const commission = revenue * rate / 100;
  // Project based on avg 1.5k revenue per client per month × 12
  const projected  = clients > 0 ? (revenue / clients) * 12 * rate / 100 : 0;

  return {
    partner_id:           partnerId,
    company:              data['company'] as string,
    commission_rate:      rate,
    referred_clients:     clients,
    total_revenue_gbp:    Math.round(revenue * 100) / 100,
    total_commission_gbp: Math.round(commission * 100) / 100,
    projected_12m_gbp:    Math.round(projected * 100) / 100,
    tier:                 clients >= 3 ? 'premium' : 'standard',
  };
}

export function simulatePartnerRevenue(
  estimatedClientsPerYear: number,
  avgPackage: PackageName = 'starter',
): {
  gross_revenue_gbp:    number;
  commission_standard:  number;
  commission_premium:   number;
  monthly_passive_gbp:  number;
} {
  const price    = PACKAGE_PRICES[avgPackage];
  const gross    = estimatedClientsPerYear * price;
  const standard = Math.round(gross * 0.15 * 100) / 100;
  const premium  = Math.round(gross * 0.20 * 100) / 100;
  const monthly  = Math.round((standard / 12) * 100) / 100;
  return { gross_revenue_gbp: gross, commission_standard: standard, commission_premium: premium, monthly_passive_gbp: monthly };
}

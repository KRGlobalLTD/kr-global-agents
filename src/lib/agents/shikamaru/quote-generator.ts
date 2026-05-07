import { createClient }                                            from '@supabase/supabase-js';
import { KR_PACKAGES, analyzeProspectPricing }                    from './price-analyzer';

type PkgDef = { price: number; currency: string; services: readonly string[]; target: string };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface QuoteInput {
  prospect_name:     string;
  prospect_id?:      string;
  brief:             string;
  budget_hint?:      string;
  package_override?: 'starter' | 'growth' | 'enterprise' | 'custom';
  custom_services?:  string[];
  custom_price?:     number;
  discount_pct?:     number;
  valid_days?:       number;
}

export interface PricingProposal {
  id:             string;
  prospect_name:  string;
  package_type:   string;
  monthly_price:  number;
  currency:       string;
  services:       string[];
  discount_pct:   number;
  final_price:    number;
  valid_until:    string;
  status:         string;
  reasoning?:     string;
}

export async function generateQuote(input: QuoteInput): Promise<PricingProposal> {
  const pkgs = KR_PACKAGES as unknown as Record<string, PkgDef>;
  let packageType = input.package_override ?? 'growth';
  let price       = pkgs[packageType]?.price    ?? 3000;
  let services    = [...(pkgs[packageType]?.services ?? [])];
  let reasoning: string | undefined;

  if (!input.package_override) {
    const brief = `Prospect: ${input.prospect_name}\nBrief: ${input.brief}${input.budget_hint ? `\nBudget indicatif: ${input.budget_hint}` : ''}`;
    const analysis = await analyzeProspectPricing(brief);
    packageType = analysis.recommended_package;
    price       = analysis.recommended_price;
    reasoning   = analysis.reasoning;
    if (packageType !== 'custom') {
      services = [...(pkgs[packageType]?.services ?? [])];
    }
  }

  if (input.custom_services?.length) services = input.custom_services;
  if (input.custom_price)            price     = input.custom_price;

  const discountPct  = input.discount_pct ?? 0;
  const finalPrice   = Math.round(price * (1 - discountPct / 100));
  const validUntil   = new Date(Date.now() + (input.valid_days ?? 30) * 86_400_000)
    .toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('pricing_proposals')
    .insert({
      prospect_name: input.prospect_name,
      prospect_id:   input.prospect_id ?? null,
      package_type:  packageType,
      monthly_price: price,
      currency:      'GBP',
      services,
      discount_pct:  discountPct,
      valid_until:   validUntil,
      status:        'draft',
      notes:         reasoning ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  return {
    id:            data['id'] as string,
    prospect_name: data['prospect_name'] as string,
    package_type:  data['package_type'] as string,
    monthly_price: data['monthly_price'] as number,
    currency:      data['currency'] as string,
    services:      data['services'] as string[],
    discount_pct:  data['discount_pct'] as number,
    final_price:   finalPrice,
    valid_until:   data['valid_until'] as string,
    status:        data['status'] as string,
    reasoning,
  };
}

export async function getProposals(status?: string): Promise<PricingProposal[]> {
  let q = supabase
    .from('pricing_proposals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id:            r['id'] as string,
    prospect_name: r['prospect_name'] as string,
    package_type:  r['package_type'] as string,
    monthly_price: r['monthly_price'] as number,
    currency:      r['currency'] as string,
    services:      r['services'] as string[],
    discount_pct:  r['discount_pct'] as number,
    final_price:   Math.round((r['monthly_price'] as number) * (1 - (r['discount_pct'] as number) / 100)),
    valid_until:   r['valid_until'] as string,
    status:        r['status'] as string,
  }));
}

export async function updateProposalStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase
    .from('pricing_proposals')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

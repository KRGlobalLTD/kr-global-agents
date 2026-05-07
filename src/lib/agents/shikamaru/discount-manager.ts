import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface DiscountRequest {
  proposal_id:             string;
  requested_discount_pct:  number;
  reason:                  string;
}

export interface DiscountDecision {
  approved:                boolean;
  approved_discount_pct:   number;
  reasoning:               string;
  requires_karim_approval: boolean;
}

// ≤ 10% : auto-approve | 10-20% : notify Karim, approve 10% | > 20% : reject
export async function validateDiscount(req: DiscountRequest): Promise<DiscountDecision> {
  const d = req.requested_discount_pct;

  if (d > 20) {
    void supabase.from('alerts').insert({
      agent_name: 'SHIKAMARU',
      level:      'WARNING',
      message:    `Remise ${d}% refusée sur devis ${req.proposal_id} — dépasse le plafond 20%.`,
    });
    return {
      approved:                false,
      approved_discount_pct:   0,
      reasoning:               `Remise de ${d}% refusée — plafond absolu 20%. Exception à demander directement à Karim.`,
      requires_karim_approval: true,
    };
  }

  if (d > 10) {
    void fetch(process.env.SLACK_WEBHOOK_ALERTES!, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        text: `⚠️ SHIKAMARU — Remise ${d}% demandée sur devis \`${req.proposal_id}\`\nRaison : ${req.reason}\n→ Approbation Karim requise. Remise de 10% accordée en attendant.`,
      }),
    });
    return {
      approved:                false,
      approved_discount_pct:   10,
      reasoning:               `Remise > 10% nécessite approbation Karim. Remise de 10% accordée automatiquement en attente.`,
      requires_karim_approval: true,
    };
  }

  const { error } = await supabase
    .from('pricing_proposals')
    .update({ discount_pct: d, updated_at: new Date().toISOString() })
    .eq('id', req.proposal_id);
  if (error) throw new Error(error.message);

  return {
    approved:                true,
    approved_discount_pct:   d,
    reasoning:               `Remise de ${d}% approuvée automatiquement (≤ seuil 10%).`,
    requires_karim_approval: false,
  };
}

export async function checkExpiredProposals(): Promise<{ expired: number }> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('pricing_proposals')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('status', 'sent')
    .lt('valid_until', today)
    .select('id, prospect_name');
  if (error) throw new Error(error.message);

  const count = (data ?? []).length;
  if (count > 0) {
    const names = (data ?? []).map(r => r['prospect_name'] as string).join(', ');
    void fetch(process.env.SLACK_WEBHOOK_PROSPECTS!, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: `📋 SHIKAMARU — ${count} devis expirés : ${names}` }),
    });
  }
  return { expired: count };
}

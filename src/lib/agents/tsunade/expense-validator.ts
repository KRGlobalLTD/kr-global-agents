import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export type ThresholdTier  = 'auto' | 'log' | 'require_approval';
export type ValidationStatus = 'auto_approved' | 'logged' | 'pending' | 'approved' | 'rejected';

export interface ExpenseRequest {
  description:  string;
  amount:       number;
  currency?:    string;
  category:     string;
  requestedBy?: string;
}

export interface ValidationResult {
  validationId:     string;
  validationNumber: string;
  tier:             ThresholdTier;
  status:           ValidationStatus;
  approved:         boolean;
  message:          string;
}

export interface ExpenseValidation {
  id:                   string;
  validation_number:    string;
  description:          string;
  amount:               number;
  currency:             string;
  category:             string;
  requested_by:         string;
  threshold_tier:       ThresholdTier;
  status:               ValidationStatus;
  approved_by:          string | null;
  approved_at:          string | null;
  rejected_reason:      string | null;
  approval_email_sent:  string | null;
  created_at:           string;
}

// ---- Seuils ----

const THRESHOLD_AUTO     =  50;   // EUR — auto-approuvé en dessous
const THRESHOLD_LOG      = 200;   // EUR — log seulement entre 50 et 200
                                   //       approbation requise au-dessus de 200

function classifyTier(amountEur: number): ThresholdTier {
  if (amountEur < THRESHOLD_AUTO)  return 'auto';
  if (amountEur <= THRESHOLD_LOG)  return 'log';
  return 'require_approval';
}

// ---- Numérotation séquentielle ----

async function getNextValidationNumber(): Promise<string> {
  const year   = new Date().getFullYear();
  const prefix = `EXP-${year}-`;

  const result = await supabase
    .from('expense_validations')
    .select('id', { count: 'exact', head: true })
    .like('validation_number', `${prefix}%`);

  const next = (result.count ?? 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// ---- Conversion en EUR (simplifiée) ----

const EUR_RATES: Record<string, number> = {
  EUR: 1,
  GBP: 1.17,   // 1 GBP ≈ 1.17 EUR (approximatif — mettre à jour via API taux)
  USD: 0.93,
  MAD: 0.092,
};

function toEur(amount: number, currency: string): number {
  const rate = EUR_RATES[currency.toUpperCase()] ?? 1;
  return amount * rate;
}

// ---- Email d'approbation à Karim (Resend REST) ----

async function sendApprovalEmailToKarim(
  validationNumber: string,
  description:      string,
  amount:           number,
  currency:         string,
  category:         string,
  requestedBy:      string,
  validationId:     string
): Promise<void> {
  const karimEmail = process.env.KARIM_EMAIL;
  const resendKey  = process.env.RESEND_API_KEY;

  if (!karimEmail || !resendKey) {
    await supabase.from('alerts').insert({
      agent_name: 'TSUNADE',
      level:      'WARNING',
      message:    `KARIM_EMAIL ou RESEND_API_KEY manquant — email d'approbation non envoyé pour ${validationNumber}`,
    });
    return;
  }

  const appUrl = process.env.APP_URL ?? 'https://kr-global.vercel.app';

  const html = `
    <!DOCTYPE html>
    <html lang="fr">
    <head><meta charset="UTF-8"></head>
    <body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
      <div style="border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:24px;">
        <strong style="font-size:18px;">TSUNADE · KR Global</strong>
        <span style="color:#64748b;font-size:13px;margin-left:8px;">Validation de dépense</span>
      </div>

      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:12px 16px;margin-bottom:20px;">
        <strong>⚠️ Approbation requise — Dépense > ${THRESHOLD_LOG}€</strong>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <tr><td style="padding:7px 10px;background:#f8fafc;font-weight:bold;border:1px solid #e2e8f0;width:40%;">Référence</td>
            <td style="padding:7px 10px;border:1px solid #e2e8f0;"><strong>${validationNumber}</strong></td></tr>
        <tr><td style="padding:7px 10px;background:#f8fafc;font-weight:bold;border:1px solid #e2e8f0;">Description</td>
            <td style="padding:7px 10px;border:1px solid #e2e8f0;">${description}</td></tr>
        <tr><td style="padding:7px 10px;background:#f8fafc;font-weight:bold;border:1px solid #e2e8f0;">Montant</td>
            <td style="padding:7px 10px;border:1px solid #e2e8f0;"><strong style="color:#dc2626;">${amount.toFixed(2)} ${currency}</strong></td></tr>
        <tr><td style="padding:7px 10px;background:#f8fafc;font-weight:bold;border:1px solid #e2e8f0;">Catégorie</td>
            <td style="padding:7px 10px;border:1px solid #e2e8f0;">${category}</td></tr>
        <tr><td style="padding:7px 10px;background:#f8fafc;font-weight:bold;border:1px solid #e2e8f0;">Demandé par</td>
            <td style="padding:7px 10px;border:1px solid #e2e8f0;">${requestedBy}</td></tr>
      </table>

      <p>Pour approuver ou rejeter cette dépense, appelez l'API TSUNADE :</p>
      <pre style="background:#f1f5f9;padding:10px;border-radius:4px;font-size:12px;overflow:auto;">
POST ${appUrl}/api/tsunade
x-internal-token: &lt;token&gt;
{ "action": "approve_expense", "validationId": "${validationId}", "approved": true }
      </pre>

      <p style="margin-top:24px;font-size:12px;color:#64748b;">
        KR Global Solutions Ltd · Londres, UK<br>
        <a href="mailto:agent@krglobalsolutionsltd.com">agent@krglobalsolutionsltd.com</a>
      </p>
    </body>
    </html>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'TSUNADE · KR Global <agent@krglobalsolutionsltd.com>',
      to:      karimEmail,
      subject: `[TSUNADE] Approbation requise — ${validationNumber} · ${amount.toFixed(2)} ${currency}`,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend approbation : ${res.status} ${err}`);
  }
}

// ---- Validation principale ----

export async function validateExpense(req: ExpenseRequest): Promise<ValidationResult> {
  const currency    = req.currency ?? 'EUR';
  const requestedBy = req.requestedBy ?? 'SYSTEM';
  const amountEur   = toEur(req.amount, currency);
  const tier        = classifyTier(amountEur);

  const statusMap: Record<ThresholdTier, ValidationStatus> = {
    auto:             'auto_approved',
    log:              'logged',
    require_approval: 'pending',
  };

  const initialStatus = statusMap[tier];
  const validationNumber = await getNextValidationNumber();

  const { data, error } = await supabase
    .from('expense_validations')
    .insert({
      validation_number:  validationNumber,
      description:        req.description,
      amount:             req.amount,
      currency,
      category:           req.category,
      requested_by:       requestedBy,
      threshold_tier:     tier,
      status:             initialStatus,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Erreur création validation : ${error.message}`);
  const validationId = (data as { id: string }).id;

  // Email à Karim si approbation requise
  if (tier === 'require_approval') {
    try {
      await sendApprovalEmailToKarim(
        validationNumber,
        req.description,
        req.amount,
        currency,
        req.category,
        requestedBy,
        validationId
      );
      await supabase
        .from('expense_validations')
        .update({ approval_email_sent: new Date().toISOString() })
        .eq('id', validationId);
    } catch (emailErr) {
      const msg = emailErr instanceof Error ? emailErr.message : 'Erreur email';
      await supabase.from('alerts').insert({
        agent_name: 'TSUNADE',
        level:      'WARNING',
        message:    `Échec email approbation ${validationNumber} : ${msg.slice(0, 150)}`,
      });
    }
  }

  const messages: Record<ThresholdTier, string> = {
    auto:             `Dépense auto-approuvée (< ${THRESHOLD_AUTO}€)`,
    log:              `Dépense enregistrée (${THRESHOLD_AUTO}–${THRESHOLD_LOG}€, log seulement)`,
    require_approval: `Approbation requise (> ${THRESHOLD_LOG}€) — email envoyé à Karim`,
  };

  await supabase.from('alerts').insert({
    agent_name: 'TSUNADE',
    level:      tier === 'require_approval' ? 'WARNING' : 'INFO',
    message:    `${validationNumber} : ${req.description} — ${req.amount.toFixed(2)} ${currency} (${tier})`,
  });

  return {
    validationId,
    validationNumber,
    tier,
    status:   initialStatus,
    approved: initialStatus === 'auto_approved',
    message:  messages[tier],
  };
}

// ---- Décision manuelle (Karim approuve ou rejette) ----

export async function decideExpense(
  validationId: string,
  approved:     boolean,
  approvedBy:   string,
  reason?:      string
): Promise<void> {
  const newStatus: ValidationStatus = approved ? 'approved' : 'rejected';

  const patch: Record<string, unknown> = {
    status:      newStatus,
    approved_by: approvedBy,
  };

  if (approved) {
    patch['approved_at'] = new Date().toISOString();
  } else {
    patch['rejected_reason'] = reason ?? 'Refus sans motif précisé';
  }

  const { error } = await supabase
    .from('expense_validations')
    .update(patch)
    .eq('id', validationId);

  if (error) throw new Error(`Erreur décision dépense : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'TSUNADE',
    level:      'INFO',
    message:    `Dépense id=${validationId} ${newStatus} par ${approvedBy}`,
  });
}

// ---- Dépenses en attente ----

export async function getPendingExpenses(): Promise<ExpenseValidation[]> {
  const { data, error } = await supabase
    .from('expense_validations')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Erreur lecture dépenses en attente : ${error.message}`);
  return (data ?? []) as unknown as ExpenseValidation[];
}

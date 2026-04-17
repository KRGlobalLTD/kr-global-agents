import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

// ---- Types ----

interface OverdueInvoice {
  id: string;
  number: string;
  client_name: string;
  client_email: string;
  client_phone: string | null;
  amount: number;
  currency: string;
  due_at: string;
  r2_url: string | null;
  reminder_7d_sent: string | null;
  reminder_14d_sent: string | null;
  reminder_21d_sent: string | null;
  reminder_30d_sent: string | null;
  escalated_at: string | null;
}

// ---- Twilio SMS (API REST directe) ----

async function sendSms(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken  = process.env.TWILIO_AUTH_TOKEN!;
  const from       = process.env.TWILIO_PHONE_NUMBER!;

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    }
  );

  if (!response.ok) {
    throw new Error(`Twilio SMS ${response.status}`);
  }
}

// ---- Templates email ----

function emailJ7(inv: OverdueInvoice): { subject: string; html: string } {
  return {
    subject: `Rappel : facture ${inv.number} arrivée à échéance`,
    html: `
      <p>Bonjour,</p>
      <p>Nous vous contactons au sujet de la facture <strong>${inv.number}</strong>
         d'un montant de <strong>${inv.amount.toFixed(2)} ${inv.currency}</strong>,
         dont l'échéance était le <strong>${inv.due_at}</strong>.</p>
      <p>Si vous avez déjà effectué le règlement, veuillez ignorer ce message.</p>
      <p>Dans le cas contraire, nous vous remercions de procéder au paiement dans
         les meilleurs délais.</p>
      ${inv.r2_url ? `<p><a href="${inv.r2_url}">Télécharger la facture</a></p>` : ''}
      <p>Cordialement,<br>KR Global Solutions Ltd</p>
    `,
  };
}

function emailJ14(inv: OverdueInvoice): { subject: string; html: string } {
  return {
    subject: `2e rappel - facture ${inv.number} impayée`,
    html: `
      <p>Bonjour,</p>
      <p>Malgré notre premier rappel, la facture <strong>${inv.number}</strong>
         d'un montant de <strong>${inv.amount.toFixed(2)} ${inv.currency}</strong>
         demeure impayée (échéance : ${inv.due_at}).</p>
      <p>Nous vous demandons de régulariser cette situation <strong>dans les 7 jours</strong>.</p>
      ${inv.r2_url ? `<p><a href="${inv.r2_url}">Télécharger la facture</a></p>` : ''}
      <p>Cordialement,<br>KR Global Solutions Ltd<br>
         <em>En cas de difficulté, n'hésitez pas à nous contacter pour trouver
         un arrangement.</em></p>
    `,
  };
}

function emailJ30(inv: OverdueInvoice): { subject: string; html: string } {
  return {
    subject: `MISE EN DEMEURE - facture ${inv.number}`,
    html: `
      <p>Madame, Monsieur,</p>
      <p>Par la présente, nous vous mettons en demeure de régler
         <strong>sous 8 jours</strong> la somme de
         <strong>${inv.amount.toFixed(2)} ${inv.currency}</strong>
         correspondant à la facture <strong>${inv.number}</strong>
         (échéance : ${inv.due_at}).</p>
      <p>À défaut de règlement dans ce délai, nous nous réservons le droit d'engager
         toute procédure de recouvrement, y compris judiciaire, et de facturer
         des pénalités de retard conformément aux conditions générales de vente.</p>
      ${inv.r2_url ? `<p><a href="${inv.r2_url}">Facture concernée</a></p>` : ''}
      <p>KR Global Solutions Ltd<br>
         71-75 Shelton Street, London WC2H 9JQ, United Kingdom</p>
    `,
  };
}

// ---- Logique de relance ----

function daysSince(dateStr: string): number {
  const due  = new Date(dateStr);
  const now  = new Date();
  due.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - due.getTime()) / 86_400_000);
}

async function markReminderSent(
  id: string,
  column: 'reminder_7d_sent' | 'reminder_14d_sent' | 'reminder_21d_sent' | 'reminder_30d_sent' | 'escalated_at'
): Promise<void> {
  await supabase
    .from('invoices')
    .update({ [column]: new Date().toISOString() })
    .eq('id', id);
}

async function sendEmailReminder(
  inv: OverdueInvoice,
  tpl: { subject: string; html: string }
): Promise<void> {
  const { error } = await resend.emails.send({
    from: 'billing@kr-global.com',
    to:   inv.client_email,
    subject: tpl.subject,
    html: tpl.html,
  });

  if (error) throw new Error(`Resend erreur : ${error.message}`);
}

async function escalateToSlack(inv: OverdueInvoice, daysOverdue: number): Promise<void> {
  const text =
    `<!channel> 🚨 *ZORO — Décision requise* (J+${daysOverdue})\n` +
    `Facture : *${inv.number}*\n` +
    `Client : ${inv.client_name}\n` +
    `Montant : ${inv.amount.toFixed(2)} ${inv.currency}\n` +
    `Échéance initiale : ${inv.due_at}\n` +
    `Action : Décision @Karim @Raphael — contentieux, abandon de créance ou arrangement ?`;

  const response = await fetch(process.env.SLACK_WEBHOOK_ALERTES!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, username: 'ZORO', icon_emoji: ':scales:' }),
  });

  if (!response.ok) throw new Error(`Slack webhook alertes échoué : ${response.status}`);
}

// ---- Point d'entrée principal ----

export async function processPaymentReminders(): Promise<void> {
  const { data, error } = await supabase
    .from('invoices')
    .select(
      'id, number, client_name, client_email, client_phone, amount, currency, ' +
      'due_at, r2_url, reminder_7d_sent, reminder_14d_sent, reminder_21d_sent, ' +
      'reminder_30d_sent, escalated_at'
    )
    .in('status', ['PENDING', 'OVERDUE'])
    .lt('due_at', new Date().toISOString().split('T')[0]); // échéance passée

  if (error) throw new Error(`Erreur lecture factures impayées : ${error.message}`);

  const invoices = (data ?? []) as unknown as OverdueInvoice[];
  let processed  = 0;

  for (const inv of invoices) {
    const days = daysSince(inv.due_at);

    try {
      if (days >= 45 && inv.escalated_at === null) {
        // J+45 : escalade Slack pour décision
        await escalateToSlack(inv, days);
        await markReminderSent(inv.id, 'escalated_at');
        await supabase.from('alerts').insert({
          agent_name: 'ZORO',
          level: 'URGENT',
          message: `Facture ${inv.number} escaladée après J+${days} sans paiement`,
        });
        processed++;
        continue;
      }

      if (days >= 30 && inv.reminder_30d_sent === null) {
        // J+30 : mise en demeure par email
        await sendEmailReminder(inv, emailJ30(inv));
        await markReminderSent(inv.id, 'reminder_30d_sent');
        await supabase.from('alerts').insert({
          agent_name: 'ZORO',
          level: 'WARNING',
          message: `Mise en demeure envoyée : ${inv.number} (J+${days})`,
        });
        processed++;
        continue;
      }

      if (days >= 21 && inv.reminder_21d_sent === null) {
        // J+21 : email ferme + SMS
        await sendEmailReminder(inv, emailJ14(inv)); // même ton ferme
        if (inv.client_phone) {
          await sendSms(
            inv.client_phone,
            `KR Global Solutions Ltd — Facture ${inv.number} de ${inv.amount.toFixed(2)} ${inv.currency} impayée depuis ${days}j. Merci de régulariser au plus vite.`
          );
        }
        await markReminderSent(inv.id, 'reminder_21d_sent');
        await supabase.from('alerts').insert({
          agent_name: 'ZORO',
          level: 'WARNING',
          message: `Relance J+21 envoyée (email + SMS) : ${inv.number}`,
        });
        processed++;
        continue;
      }

      if (days >= 14 && inv.reminder_14d_sent === null) {
        // J+14 : email ferme
        await sendEmailReminder(inv, emailJ14(inv));
        await markReminderSent(inv.id, 'reminder_14d_sent');
        await supabase.from('alerts').insert({
          agent_name: 'ZORO',
          level: 'WARNING',
          message: `Relance J+14 envoyée : ${inv.number}`,
        });
        processed++;
        continue;
      }

      if (days >= 7 && inv.reminder_7d_sent === null) {
        // J+7 : rappel doux
        await sendEmailReminder(inv, emailJ7(inv));
        await markReminderSent(inv.id, 'reminder_7d_sent');
        await supabase.from('alerts').insert({
          agent_name: 'ZORO',
          level: 'INFO',
          message: `Rappel J+7 envoyé : ${inv.number}`,
        });
        processed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      await supabase.from('alerts').insert({
        agent_name: 'ZORO',
        level: 'URGENT',
        message: `Erreur relance ${inv.number} (J+${days}) : ${msg.slice(0, 120)}`,
      });
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Cycle relances : ${invoices.length} factures examinées, ${processed} actions effectuées`,
  });
}

// ---- Marquer une facture payée ----

export async function markInvoicePaid(invoiceNumber: string): Promise<void> {
  const { error } = await supabase
    .from('invoices')
    .update({
      status:  'PAID',
      paid_at: new Date().toISOString().split('T')[0],
    })
    .eq('number', invoiceNumber);

  if (error) throw new Error(`Erreur mise à jour facture : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'ZORO',
    level: 'INFO',
    message: `Facture marquée payée : ${invoiceNumber}`,
  });
}

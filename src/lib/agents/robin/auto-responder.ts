import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import type { Ticket } from './ticket-handler';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

const FROM    = 'ROBIN · KR Global <agent@krglobalsolutionsltd.com>';
const REPLYTO = 'agent@krglobalsolutionsltd.com';

// ---- Types OpenRouter ----

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
}

// ---- Base de connaissance KR Global ----

const KR_KNOWLEDGE_BASE =
  `KR Global Solutions Ltd - Agence IA & Digital (Londres, UK)\n\n` +
  `Services proposés :\n` +
  `- Agents IA sur mesure (prospection, support, comptabilité, marketing, réseaux sociaux)\n` +
  `- Développement web & mobile (Next.js, React Native, TypeScript)\n` +
  `- Conseil en transformation digitale\n\n` +
  `Informations pratiques :\n` +
  `- Contact : agent@krglobalsolutionsltd.com\n` +
  `- Délais typiques : agent IA 2-4 semaines, application 4-8 semaines\n` +
  `- Tarifs : sur devis personnalisé, contacter l'équipe\n` +
  `- Technologies : Next.js, Supabase, Vercel, TypeScript, OpenRouter, Resend\n` +
  `- Support : tickets traités sous 24h ouvrées (priorité high/critical sous 4h)\n\n` +
  `Questions fréquentes (FAQ) :\n` +
  `- "Combien ça coûte ?" → Devis gratuit sur demande, tarifs variables selon la complexité\n` +
  `- "Quels délais ?" → Agent IA : 2-4 semaines. App complète : 4-8 semaines\n` +
  `- "Comment démarrer ?" → Répondre à cet email ou appeler notre équipe\n` +
  `- "Puis-je modifier mon projet ?" → Oui, via notre processus d'évolution contractuelle\n` +
  `- "Avez-vous une démo ?" → Oui, sur rendez-vous - répondre à cet email`;

// ---- Prompt génération de réponse ----

function buildResponsePrompt(ticket: Ticket): string {
  return (
    `Tu es ROBIN, l'agent support client de KR Global Solutions Ltd.\n` +
    `Réponds professionnellement en français à cette demande support.\n\n` +
    `Base de connaissance :\n${KR_KNOWLEDGE_BASE}\n\n` +
    `Règles :\n` +
    `- Si tu peux répondre complètement → réponds et sets needs_escalation=false\n` +
    `- Si la demande nécessite un accès client, une intervention technique complexe, ` +
    `ou un remboursement → sets needs_escalation=true\n` +
    `- Toujours mentionner le numéro de ticket dans la réponse\n` +
    `- Ton chaleureux, professionnel, concis (150-250 mots)\n\n` +
    `Retourne UNIQUEMENT un JSON valide :\n` +
    `{ "response_html": "...", "needs_escalation": false, "escalation_reason": "" }\n` +
    `"response_html" : HTML simple (<p>, <strong>, <ul>, <li>), ` +
    `inclure le n° de ticket ${ticket.ticket_number} dans la réponse.`
  );
}

// ---- Appel OpenRouter Gemini ----

interface AutoResponseResult {
  response_html:      string;
  needs_escalation:   boolean;
  escalation_reason:  string;
}

async function generateResponse(ticket: Ticket): Promise<AutoResponseResult> {
  const userPrompt =
    `Demande de : ${ticket.from_name} <${ticket.from_email}>\n` +
    `Objet : ${ticket.subject}\n` +
    `Catégorie : ${ticket.category} | Priorité : ${ticket.priority}\n\n` +
    `Message :\n${ticket.body.slice(0, 2000)}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kr-global.com',
      'X-Title':      'ROBIN - KR Global',
    },
    body: JSON.stringify({
      model:           'google/gemini-2.0-flash-001',
      messages: [
        { role: 'system', content: buildResponsePrompt(ticket) },
        { role: 'user',   content: userPrompt                  },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.5,
      max_tokens:      800,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${err}`);
  }

  const data  = (await response.json()) as OpenRouterResponse;
  const raw   = data.choices?.[0]?.message?.content ?? '{}';

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`JSON réponse invalide : ${raw.slice(0, 200)}`);
  }

  const response_html = typeof parsed['response_html'] === 'string' && parsed['response_html'].length > 0
    ? parsed['response_html']
    : `<p>Bonjour ${ticket.from_name.split(' ')[0]},</p>` +
      `<p>Nous avons bien reçu votre demande (réf. <strong>${ticket.ticket_number}</strong>) ` +
      `et vous répondrons sous 24h ouvrées.</p>`;

  const needs_escalation = parsed['needs_escalation'] === true;

  const escalation_reason = typeof parsed['escalation_reason'] === 'string'
    ? parsed['escalation_reason']
    : '';

  return { response_html, needs_escalation, escalation_reason };
}

// ---- Template email ----

function buildEmailHtml(params: {
  firstName:     string;
  ticketNumber:  string;
  bodyHtml:      string;
  isEscalated:   boolean;
}): string {
  const eta = params.isEscalated
    ? `<p style="color:#b45309;font-size:14px;">⚡ Un membre de notre équipe vous contactera sous peu.</p>`
    : `<p style="color:#555;font-size:14px;">Délai de traitement standard : 24h ouvrées.</p>`;

  return `
    <!DOCTYPE html>
    <html lang="fr">
    <head><meta charset="UTF-8"></head>
    <body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
      <div style="border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:24px;">
        <strong style="font-size:18px;">KR Global Solutions Ltd</strong>
        <span style="color:#64748b;font-size:13px;margin-left:8px;">Support Client</span>
      </div>

      <p style="background:#f1f5f9;border-left:4px solid #0f172a;padding:8px 12px;font-size:13px;color:#475569;">
        Référence ticket : <strong>${params.ticketNumber}</strong>
      </p>

      ${params.bodyHtml}

      ${eta}

      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
        <p>KR Global Solutions Ltd · Londres, UK<br>
        <a href="mailto:agent@krglobalsolutionsltd.com" style="color:#0f172a;">agent@krglobalsolutionsltd.com</a></p>
        <p>Pour répondre à ce ticket, répondez simplement à cet email.</p>
      </div>
    </body>
    </html>
  `;
}

// ---- Envoi réponse automatique ----

export async function respondToTicket(ticketId: string): Promise<void> {
  const { data: ticketData, error: fetchError } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .single();

  if (fetchError || !ticketData) throw new Error(`Ticket introuvable : ${ticketId}`);

  const ticket = ticketData as unknown as Ticket;

  // Ne pas répondre deux fois
  if (ticket.auto_response_sent) return;

  const generated = await generateResponse(ticket);

  // Décision d'escalade : IA + priorité critique
  const shouldEscalate = generated.needs_escalation || ticket.priority === 'critical';

  const html = buildEmailHtml({
    firstName:    ticket.from_name.split(' ')[0] ?? ticket.from_name,
    ticketNumber: ticket.ticket_number,
    bodyHtml:     generated.response_html,
    isEscalated:  shouldEscalate,
  });

  // Envoi au client
  const { error: sendError } = await resend.emails.send({
    from:    FROM,
    replyTo: REPLYTO,
    to:      ticket.from_email,
    subject: `[${ticket.ticket_number}] Re: ${ticket.subject}`,
    html,
  });

  if (sendError) throw new Error(`Resend client ${ticket.from_email}: ${sendError.message}`);

  // Mise à jour ticket
  await supabase
    .from('tickets')
    .update({
      auto_response_sent: new Date().toISOString(),
      response_sent:      generated.response_html,
      status:             shouldEscalate ? 'escalated' : 'in_progress',
    })
    .eq('id', ticketId);

  await supabase.from('alerts').insert({
    agent_name: 'ROBIN',
    level:      'INFO',
    message:    `Réponse auto envoyée pour ${ticket.ticket_number} (${ticket.from_email})`,
  });

  // Escalade si nécessaire
  if (shouldEscalate) {
    await escalateTicket(
      ticketId,
      generated.escalation_reason || `Priorité ${ticket.priority} - intervention humaine requise`
    );
  }
}

// ---- Escalade vers Karim ----

export async function escalateTicket(ticketId: string, reason?: string): Promise<void> {
  const { data: ticketData, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .single();

  if (error || !ticketData) throw new Error(`Ticket introuvable pour escalade : ${ticketId}`);

  const ticket = ticketData as unknown as Ticket;
  const karimEmail = process.env.KARIM_EMAIL;

  if (!karimEmail) {
    await supabase.from('alerts').insert({
      agent_name: 'ROBIN',
      level:      'WARNING',
      message:    `KARIM_EMAIL non configuré - ticket ${ticket.ticket_number} non escaladé`,
    });
    return;
  }

  const escalationReason = reason ?? 'Escalade manuelle';
  const priorityLabel: Record<string, string> = {
    critical: '🔴 CRITIQUE',
    high:     '🟠 HIGH',
    medium:   '🟡 MEDIUM',
    low:      '🟢 LOW',
  };

  const html = `
    <!DOCTYPE html>
    <html lang="fr">
    <head><meta charset="UTF-8"></head>
    <body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
      <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;padding:12px 16px;margin-bottom:20px;">
        <strong>⚡ Ticket escaladé - Action requise</strong>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#64748b;width:140px;">Référence</td>
            <td><strong>${ticket.ticket_number}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Priorité</td>
            <td><strong>${priorityLabel[ticket.priority] ?? ticket.priority}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Catégorie</td>
            <td>${ticket.category}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Client</td>
            <td>${ticket.from_name} &lt;${ticket.from_email}&gt;</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Objet</td>
            <td>${ticket.subject}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Raison escalade</td>
            <td style="color:#b91c1c;">${escalationReason}</td></tr>
      </table>

      <div style="margin-top:20px;padding:12px;background:#f8fafc;border-radius:4px;">
        <strong style="font-size:13px;color:#475569;">Message original :</strong>
        <p style="font-size:13px;white-space:pre-wrap;">${ticket.body.slice(0, 1000)}</p>
      </div>

      <p style="margin-top:20px;font-size:13px;color:#64748b;">
        Répondre directement au client : <a href="mailto:${ticket.from_email}">${ticket.from_email}</a>
      </p>
    </body>
    </html>
  `;

  const { error: sendError } = await resend.emails.send({
    from:    FROM,
    replyTo: ticket.from_email,
    to:      karimEmail,
    subject: `[ESCALADE ${priorityLabel[ticket.priority] ?? ticket.priority}] ${ticket.ticket_number} - ${ticket.subject}`,
    html,
  });

  if (sendError) throw new Error(`Resend escalade Karim : ${sendError.message}`);

  await supabase
    .from('tickets')
    .update({
      status:           'escalated',
      escalated_at:     new Date().toISOString(),
      escalated_to:     karimEmail,
      escalation_reason: escalationReason,
    })
    .eq('id', ticketId);

  await supabase.from('alerts').insert({
    agent_name: 'ROBIN',
    level:      'URGENT',
    message:    `Ticket ${ticket.ticket_number} escaladé à Karim (${karimEmail}) - ${escalationReason}`,
  });
}

// ---- Réponse manuelle ----

export async function sendManualResponse(
  ticketId:     string,
  responseHtml: string
): Promise<void> {
  const { data: ticketData, error } = await supabase
    .from('tickets')
    .select('id, ticket_number, from_email, from_name, subject')
    .eq('id', ticketId)
    .single();

  if (error || !ticketData) throw new Error(`Ticket introuvable : ${ticketId}`);

  const t = ticketData as {
    id: string; ticket_number: string;
    from_email: string; from_name: string; subject: string;
  };

  const html = buildEmailHtml({
    firstName:    t.from_name.split(' ')[0] ?? t.from_name,
    ticketNumber: t.ticket_number,
    bodyHtml:     responseHtml,
    isEscalated:  false,
  });

  const { error: sendError } = await resend.emails.send({
    from:    FROM,
    replyTo: REPLYTO,
    to:      t.from_email,
    subject: `[${t.ticket_number}] Re: ${t.subject}`,
    html,
  });

  if (sendError) throw new Error(`Resend réponse manuelle : ${sendError.message}`);

  await supabase
    .from('tickets')
    .update({ response_sent: responseHtml, status: 'in_progress' })
    .eq('id', ticketId);

  await supabase.from('alerts').insert({
    agent_name: 'ROBIN',
    level:      'INFO',
    message:    `Réponse manuelle envoyée pour ${t.ticket_number} (${t.from_email})`,
  });
}

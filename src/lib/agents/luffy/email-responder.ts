import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import type { IncomingEmail, ClassificationResult, Classification } from './email-classifier';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

const FROM    = 'LUFFY · KR Global <agent@krglobalsolutionsltd.com>';
const REPLYTO = 'agent@krglobalsolutionsltd.com';

// ---- Alerte Slack #prospects ----

async function alertProspectsChaud(
  email: IncomingEmail,
  result: ClassificationResult
): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_PROSPECTS!;

  const urgencyIcon = result.urgency === 'haute' ? '🔥' : result.urgency === 'normale' ? '⚡' : '💬';

  const text =
    `${urgencyIcon} *LUFFY — Nouveau prospect CHAUD*\n` +
    `De : ${result.name ?? email.fromName} <${email.fromEmail}>\n` +
    (result.company ? `Société : ${result.company}\n` : '') +
    `Objet : ${email.subject}\n` +
    `Besoin : ${result.need ?? 'Non précisé'}\n` +
    `Urgence : ${result.urgency}\n` +
    `Résumé : ${result.summary}`;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      username:    'LUFFY',
      icon_emoji:  ':incoming_envelope:',
    }),
  });

  if (!response.ok) {
    await supabase.from('alerts').insert({
      agent_name: 'LUFFY',
      level: 'WARNING',
      message: `Échec alerte #prospects pour ${email.fromEmail} (HTTP ${response.status})`,
    });
  }
}

// ---- Templates de réponse ----

function replySubject(original: string): string {
  return original.startsWith('Re:') ? original : `Re: ${original}`;
}

function templateProspectChaud(email: IncomingEmail, result: ClassificationResult): string {
  const firstName = (result.name ?? email.fromName).split(' ')[0] || 'vous';
  return `
    <p>Bonjour ${firstName},</p>
    <p>Merci pour votre message. Votre demande retient toute notre attention.</p>
    <p>Un membre de notre équipe vous contactera <strong>dans les 24 heures</strong>
       pour discuter de votre projet en détail.</p>
    <p>En attendant, n'hésitez pas à nous transmettre tout document ou information
       supplémentaire qui nous permettrait de mieux comprendre votre besoin.</p>
    <p>Cordialement,<br>
       L'équipe KR Global Solutions Ltd<br>
       <a href="mailto:agent@krglobalsolutionsltd.com">agent@krglobalsolutionsltd.com</a></p>
  `;
}

function templateProspectFroid(email: IncomingEmail, result: ClassificationResult): string {
  const firstName = (result.name ?? email.fromName).split(' ')[0] || 'vous';
  return `
    <p>Bonjour ${firstName},</p>
    <p>Merci de nous avoir contactés. Nous avons bien pris note de votre demande.</p>
    <p>Pourriez-vous nous donner quelques précisions sur votre projet afin que
       nous puissions vous proposer la solution la plus adaptée ?</p>
    <ul>
      <li>Nature de votre besoin</li>
      <li>Délais souhaités</li>
      <li>Budget approximatif</li>
    </ul>
    <p>Nous reviendrons vers vous dès réception de ces informations.</p>
    <p>Cordialement,<br>
       L'équipe KR Global Solutions Ltd<br>
       <a href="mailto:agent@krglobalsolutionsltd.com">agent@krglobalsolutionsltd.com</a></p>
  `;
}

function templateClient(email: IncomingEmail, result: ClassificationResult): string {
  const firstName = (result.name ?? email.fromName).split(' ')[0] || 'vous';
  return `
    <p>Bonjour ${firstName},</p>
    <p>Merci pour votre message. Nous en avons bien pris note et y donnons suite
       dans les meilleurs délais.</p>
    <p>Si votre demande est urgente, vous pouvez également nous écrire directement
       à <a href="mailto:agent@krglobalsolutionsltd.com">agent@krglobalsolutionsltd.com</a>.</p>
    <p>Cordialement,<br>
       L'équipe KR Global Solutions Ltd</p>
  `;
}

function templateAutre(email: IncomingEmail): string {
  const firstName = email.fromName.split(' ')[0] || 'vous';
  return `
    <p>Bonjour ${firstName},</p>
    <p>Merci pour votre message. Nous en avons bien pris note et reviendrons vers
       vous si nécessaire.</p>
    <p>Cordialement,<br>
       L'équipe KR Global Solutions Ltd</p>
  `;
}

type ResponseTemplate = Exclude<Classification, 'spam'>;

const TEMPLATES: Record<ResponseTemplate, (e: IncomingEmail, r: ClassificationResult) => string> = {
  prospect_chaud: templateProspectChaud,
  prospect_froid: templateProspectFroid,
  client:         templateClient,
  autre:          (e) => templateAutre(e),
};

// ---- Point d'entrée principal ----

export async function respondToEmail(
  email: IncomingEmail,
  result: ClassificationResult
): Promise<void> {
  // Spam → aucune réponse
  if (result.classification === 'spam') {
    await supabase.from('alerts').insert({
      agent_name: 'LUFFY',
      level: 'INFO',
      message: `Email spam ignoré : from=${email.fromEmail}`,
    });
    return;
  }

  const html = TEMPLATES[result.classification](email, result);

  const { error } = await resend.emails.send({
    from:     FROM,
    replyTo:  REPLYTO,
    to:       email.fromEmail,
    subject:  replySubject(email.subject),
    html,
  });

  if (error) throw new Error(`Resend erreur : ${error.message}`);

  // Marquer la réponse en base (si prospect)
  if (result.classification === 'prospect_chaud' || result.classification === 'prospect_froid') {
    await supabase
      .from('prospects')
      .update({ response_sent_at: new Date().toISOString() })
      .eq('message_id', email.messageId);
  }

  // Alerte Slack pour les prospects chauds
  if (result.classification === 'prospect_chaud') {
    await alertProspectsChaud(email, result);
  }

  await supabase.from('alerts').insert({
    agent_name: 'LUFFY',
    level: 'INFO',
    message: `Réponse envoyée (${result.classification}) à ${email.fromEmail}`,
  });
}

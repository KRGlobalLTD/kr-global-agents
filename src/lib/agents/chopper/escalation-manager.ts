import { createClient }          from '@supabase/supabase-js';
import { updateTicket, getTicketById, type Ticket } from './ticket-manager';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ESCALATED_TO = 'Karim Hammouche';

export async function escalateToHuman(ticket: Ticket, reason: string): Promise<void> {
  await updateTicket(ticket.id, {
    status:      'escalated',
    escalatedTo: ESCALATED_TO,
  });

  const webhookUrl = process.env.SLACK_WEBHOOK_ALERTES;
  if (webhookUrl) {
    const priorityEmoji: Record<string, string> = {
      urgent: ':rotating_light:',
      high:   ':warning:',
      medium: ':large_orange_circle:',
      low:    ':large_blue_circle:',
    };
    const emoji   = priorityEmoji[ticket.priority] ?? ':warning:';
    const excerpt = ticket.description.length > 300
      ? `${ticket.description.slice(0, 300)}…`
      : ticket.description;

    const message = [
      `<!channel> ${emoji} *ESCALADE TICKET — CHOPPER*`,
      `*ID :* \`${ticket.id}\``,
      `*Client :* ${ticket.client_email ?? 'Inconnu'}`,
      `*Sujet :* ${ticket.subject}`,
      `*Priorité :* ${ticket.priority.toUpperCase()}`,
      `*Raison :* ${reason}`,
      `*Description :*\n${excerpt}`,
      `→ Assigné à *${ESCALATED_TO}*`,
    ].join('\n');

    try {
      await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          text:        message,
          username:    'CHOPPER',
          icon_emoji:  ':sos:',
        }),
      });
    } catch {
      // Non-bloquant
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'CHOPPER',
    level:      'URGENT',
    message:    `Ticket ${ticket.id} escaladé à ${ESCALATED_TO} — ${reason.slice(0, 150)}`,
  });
}

export async function escalateById(ticketId: string, reason: string): Promise<void> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) throw new Error(`Ticket ${ticketId} introuvable`);
  await escalateToHuman(ticket, reason);
}

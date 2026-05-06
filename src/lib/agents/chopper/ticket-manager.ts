import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type TicketStatus   = 'open' | 'in_progress' | 'resolved' | 'escalated';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TicketInput {
  clientEmail?: string;
  subject:      string;
  description:  string;
  priority?:    TicketPriority;
}

export interface Ticket {
  id:                 string;
  agent_name:         string;
  client_email:       string | null;
  subject:            string;
  description:        string;
  status:             TicketStatus;
  priority:           TicketPriority;
  resolution:         string | null;
  satisfaction_score: number | null;
  escalated_to:       string | null;
  created_at:         string;
  resolved_at:        string | null;
}

export async function createTicket(input: TicketInput): Promise<Ticket> {
  const { data, error } = await supabase
    .from('support_tickets')
    .insert({
      client_email: input.clientEmail ?? null,
      subject:      input.subject,
      description:  input.description,
      priority:     input.priority ?? 'medium',
    })
    .select()
    .single();

  if (error) throw new Error(`Erreur création ticket : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'CHOPPER',
    level:      'INFO',
    message:    `Ticket créé : "${input.subject.slice(0, 80)}" — priorité ${input.priority ?? 'medium'}`,
  });

  return data as Ticket;
}

export async function updateTicket(
  id: string,
  updates: {
    status?:            TicketStatus;
    resolution?:        string;
    satisfactionScore?: number;
    escalatedTo?:       string;
  }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.status            !== undefined) payload['status']             = updates.status;
  if (updates.resolution        !== undefined) payload['resolution']         = updates.resolution;
  if (updates.satisfactionScore !== undefined) payload['satisfaction_score'] = updates.satisfactionScore;
  if (updates.escalatedTo       !== undefined) payload['escalated_to']       = updates.escalatedTo;
  if (updates.status === 'resolved')           payload['resolved_at']        = new Date().toISOString();

  const { error } = await supabase
    .from('support_tickets')
    .update(payload)
    .eq('id', id);

  if (error) throw new Error(`Erreur mise à jour ticket : ${error.message}`);
}

export async function getTicketById(id: string): Promise<Ticket | null> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Erreur récupération ticket : ${error.message}`);
  return data as Ticket | null;
}

export async function getOpenTickets(): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Erreur récupération tickets : ${error.message}`);
  return (data ?? []) as Ticket[];
}

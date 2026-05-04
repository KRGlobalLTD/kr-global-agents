import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export type TicketCategory = 'technique' | 'facturation' | 'general' | 'urgent';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
export type TicketStatus   = 'open' | 'in_progress' | 'resolved' | 'escalated' | 'closed';

export interface TicketInput {
  from_email: string;
  from_name:  string;
  subject:    string;
  body:       string;
}

export interface Ticket {
  id:                 string;
  ticket_number:      string;
  from_email:         string;
  from_name:          string;
  subject:            string;
  body:               string;
  category:           TicketCategory;
  priority:           TicketPriority;
  status:             TicketStatus;
  summary:            string | null;
  response_sent:      string | null;
  auto_response_sent: string | null;
  escalated_at:       string | null;
  escalated_to:       string | null;
  escalation_reason:  string | null;
  resolved_at:        string | null;
  resolution:         string | null;
  created_at:         string;
}

// ---- Types OpenRouter ----

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
}

// ---- Résultat de la classification IA ----

interface ClassificationResult {
  category: TicketCategory;
  priority: TicketPriority;
  summary:  string;
}

// ---- Prompt de classification ----

const CLASSIFICATION_PROMPT =
  `Tu es ROBIN, l'agent support client de KR Global Solutions Ltd (UK).\n` +
  `Analyse cette demande support et retourne UNIQUEMENT un JSON valide :\n` +
  `{ "category": "technique|facturation|general|urgent", "priority": "low|medium|high|critical", "summary": "..." }\n\n` +
  `Critères catégorie :\n` +
  `- technique : bug, erreur, problème d'accès, intégration, API\n` +
  `- facturation : facture, paiement, remboursement, devis, tarif\n` +
  `- general : question, information, demande de démo, partenariat\n` +
  `- urgent : panne totale, perte de données, deadline critique\n\n` +
  `Critères priorité :\n` +
  `- critical : système en panne, perte de données, blocage total de production\n` +
  `- high : bug bloquant, erreur de facturation, délai urgent (< 24h)\n` +
  `- medium : bug non bloquant, question technique, demande de fonctionnalité\n` +
  `- low : question générale, demande d'information, curiosité\n\n` +
  `"summary" : résumé de la demande en 1 phrase (max 120 caractères).`;

// ---- Numéro de ticket séquentiel ----

async function getNextTicketNumber(): Promise<string> {
  const year   = new Date().getFullYear();
  const prefix = `TKT-${year}-`;

  const result = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .like('ticket_number', `${prefix}%`);

  const next = (result.count ?? 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// ---- Classification via Gemini 2.0 Flash ----

async function classifyTicket(input: TicketInput): Promise<ClassificationResult> {
  const userPrompt =
    `De : ${input.from_name} <${input.from_email}>\n` +
    `Objet : ${input.subject}\n\n` +
    `${input.body.slice(0, 2000)}`;

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
        { role: 'system', content: CLASSIFICATION_PROMPT },
        { role: 'user',   content: userPrompt            },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.2,
      max_tokens:      200,
    }),
  });

  // En cas d'échec IA, on crée quand même le ticket avec des valeurs par défaut
  if (!response.ok) {
    return { category: 'general', priority: 'medium', summary: input.subject };
  }

  const data  = (await response.json()) as OpenRouterResponse;
  const raw   = data.choices?.[0]?.message?.content ?? '{}';

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { category: 'general', priority: 'medium', summary: input.subject };
  }

  const validCategories: TicketCategory[] = ['technique', 'facturation', 'general', 'urgent'];
  const validPriorities: TicketPriority[] = ['low', 'medium', 'high', 'critical'];

  const category: TicketCategory = validCategories.includes(parsed['category'] as TicketCategory)
    ? (parsed['category'] as TicketCategory)
    : 'general';

  const priority: TicketPriority = validPriorities.includes(parsed['priority'] as TicketPriority)
    ? (parsed['priority'] as TicketPriority)
    : 'medium';

  const summary = typeof parsed['summary'] === 'string'
    ? parsed['summary'].slice(0, 120)
    : input.subject;

  // "urgent" catégorie → toujours high minimum
  const effectivePriority: TicketPriority =
    category === 'urgent' && (priority === 'low' || priority === 'medium')
      ? 'high'
      : priority;

  return { category, priority: effectivePriority, summary };
}

// ---- Création du ticket ----

export async function createTicket(input: TicketInput): Promise<Ticket> {
  const [ticketNumber, classification] = await Promise.all([
    getNextTicketNumber(),
    classifyTicket(input),
  ]);

  const { data, error } = await supabase
    .from('tickets')
    .insert({
      ticket_number: ticketNumber,
      from_email:    input.from_email,
      from_name:     input.from_name,
      subject:       input.subject,
      body:          input.body,
      category:      classification.category,
      priority:      classification.priority,
      status:        'open',
      summary:       classification.summary,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Erreur création ticket : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'ROBIN',
    level:      classification.priority === 'critical' ? 'URGENT' : 'INFO',
    message:
      `Ticket ${ticketNumber} créé (${classification.category}, ${classification.priority}) - ` +
      `${input.from_email} : "${classification.summary}"`,
  });

  return data as unknown as Ticket;
}

// ---- Lecture des tickets ouverts ----

export async function getOpenTickets(category?: TicketCategory): Promise<Ticket[]> {
  let query = supabase
    .from('tickets')
    .select('*')
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: false });

  if (category) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture tickets : ${error.message}`);
  return (data ?? []) as unknown as Ticket[];
}

// ---- Mise à jour statut ----

export async function updateTicketStatus(
  ticketId: string,
  status:   TicketStatus,
  resolution?: string
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === 'resolved') {
    patch['resolved_at'] = new Date().toISOString();
    if (resolution) patch['resolution'] = resolution;
  }

  const { error } = await supabase
    .from('tickets')
    .update(patch)
    .eq('id', ticketId);

  if (error) throw new Error(`Erreur mise à jour ticket : ${error.message}`);
}

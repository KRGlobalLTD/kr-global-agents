import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createTicket,
  getOpenTickets,
  updateTicketStatus,
  type TicketCategory,
  type TicketStatus,
} from '@/lib/agents/robin/ticket-handler';
import {
  respondToTicket,
  escalateTicket,
  sendManualResponse,
} from '@/lib/agents/robin/auto-responder';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyInternalToken(request: NextRequest): boolean {
  return request.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

// ---- Payload types ----

type ActionPayload =
  | {
      action:     'create_ticket';
      from_email: string;
      from_name:  string;
      subject:    string;
      body:       string;
      auto_respond?: boolean;     // default true
    }
  | {
      action:        'respond';
      ticketId:      string;
      responseHtml?: string;      // si absent → réponse automatique IA
    }
  | {
      action:    'escalate';
      ticketId:  string;
      reason?:   string;
    }
  | {
      action:      'resolve';
      ticketId:    string;
      resolution?: string;
    };

// ---- POST ----

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: ActionPayload;
  try {
    body = (await request.json()) as ActionPayload;
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'create_ticket': {
        if (!body.from_email || !body.from_name || !body.subject || !body.body) {
          return NextResponse.json(
            { error: 'from_email, from_name, subject et body sont requis' },
            { status: 400 }
          );
        }

        const ticket = await createTicket({
          from_email: body.from_email,
          from_name:  body.from_name,
          subject:    body.subject,
          body:       body.body,
        });

        // Réponse automatique par défaut (sauf si auto_respond=false)
        if (body.auto_respond !== false) {
          await respondToTicket(ticket.id);
        }

        return NextResponse.json({ success: true, ticket });
      }

      case 'respond': {
        if (body.responseHtml) {
          // Réponse manuelle fournie
          await sendManualResponse(body.ticketId, body.responseHtml);
        } else {
          // Réponse automatique IA
          await respondToTicket(body.ticketId);
        }
        return NextResponse.json({ success: true });
      }

      case 'escalate': {
        await escalateTicket(body.ticketId, body.reason);
        return NextResponse.json({ success: true });
      }

      case 'resolve': {
        await updateTicketStatus(
          body.ticketId,
          'resolved',
          body.resolution
        );
        return NextResponse.json({ success: true });
      }

      default: {
        return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';

    try {
      await supabase.from('alerts').insert({
        agent_name: 'ROBIN',
        level:      'URGENT',
        message:    `Erreur API ROBIN : action=${body.action}`,
      });
    } catch {
      // log silencieux
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---- GET — tickets ouverts ----

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const category  = searchParams.get('category') as TicketCategory | null;
  const status    = searchParams.get('status')   as TicketStatus   | null;
  const ticketId  = searchParams.get('ticketId');

  // Détail d'un ticket spécifique
  if (ticketId) {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Ticket introuvable' }, { status: 404 });
    }
    return NextResponse.json({ success: true, ticket: data });
  }

  // Liste filtrée
  if (status && status !== 'open' && status !== 'in_progress') {
    // Statut arbitraire (resolved, escalated, closed)
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ agent: 'ROBIN', status: 'ACTIF', tickets: data ?? [] });
  }

  const tickets = await getOpenTickets(category ?? undefined);

  // Statistiques rapides
  const { data: statsRaw } = await supabase
    .from('tickets')
    .select('status, priority, category');

  interface StatRow { status: string; priority: string; category: string }
  const rows = (statsRaw ?? []) as unknown as StatRow[];

  const stats = {
    open:       rows.filter(r => r.status === 'open').length,
    in_progress: rows.filter(r => r.status === 'in_progress').length,
    escalated:  rows.filter(r => r.status === 'escalated').length,
    critical:   rows.filter(r => r.priority === 'critical').length,
    by_category: {
      technique:   rows.filter(r => r.category === 'technique').length,
      facturation: rows.filter(r => r.category === 'facturation').length,
      general:     rows.filter(r => r.category === 'general').length,
      urgent:      rows.filter(r => r.category === 'urgent').length,
    },
  };

  return NextResponse.json({
    agent:   'ROBIN',
    status:  'ACTIF',
    tickets,
    stats,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createMission,
  publishMission,
  assignFreelance,
  updateMissionStatus,
  getOpenMissions,
  type MissionInput,
  type MissionStatus,
} from '@/lib/agents/chopper/mission-manager';
import {
  evaluateAndRegister,
  blacklistFreelance,
  getAvailableFreelances,
  type FreelancePlatform,
} from '@/lib/agents/chopper/freelance-evaluator';
import {
  generateContract,
  sendContract,
  markContractSigned,
  type ContractType,
} from '@/lib/agents/chopper/contract-generator';
import {
  createTicket,
  updateTicket,
  getOpenTickets,
  getTicketById,
  type TicketPriority,
} from '@/lib/agents/chopper/ticket-manager';
import { findAnswer, addToFAQ } from '@/lib/agents/chopper/faq-engine';
import { escalateById }         from '@/lib/agents/chopper/escalation-manager';

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
      action:          'create_mission';
      title:           string;
      description:     string;
      skills_required: string[];
      budget_min?:     number;
      budget_max?:     number;
      currency?:       string;
      duration_weeks?: number;
      publish?:        boolean;     // publier immédiatement sur Upwork/Fiverr
    }
  | { action: 'publish_mission'; missionId: string }
  | {
      action:      'assign_freelance';
      missionId:   string;
      freelanceId: string;
    }
  | {
      action:      'update_mission';
      missionId:   string;
      status:      MissionStatus;
    }
  | {
      action:               'evaluate';
      name:                 string;
      email:                string;
      skills:               string[];
      platform:             FreelancePlatform;
      hourly_rate?:         number;
      currency?:            string;
      platform_profile_url?: string;
      bio?:                 string;
      portfolio_description?: string;
      platform_rating?:     number;
      years_experience?:    number;
    }
  | { action: 'blacklist'; freelanceId: string; reason: string }
  | {
      action:      'generate_contract';
      missionId:   string;
      freelanceId: string;
      type:        ContractType;
      send?:       boolean;         // envoyer immédiatement par email
    }
  | { action: 'send_contract';   contractId: string }
  | { action: 'sign_contract';   contractId: string }
  // ---- Support client ----
  | { action: 'answer_question'; question: string; client_email?: string }
  | { action: 'create_ticket';   subject: string; description: string; client_email?: string; priority?: TicketPriority }
  | { action: 'resolve_ticket';  ticket_id: string; resolution?: string; satisfaction_score?: number }
  | { action: 'escalate';        ticket_id: string; reason?: string }
  | { action: 'get_open_tickets' }
  | { action: 'add_faq';         question: string; answer: string };

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
      case 'create_mission': {
        const input: MissionInput = {
          title:           body.title,
          description:     body.description,
          skills_required: body.skills_required,
          budget_min:      body.budget_min,
          budget_max:      body.budget_max,
          currency:        body.currency,
          duration_weeks:  body.duration_weeks,
        };

        const mission = await createMission(input);

        if (body.publish) {
          const publishResult = await publishMission(mission.id);
          return NextResponse.json({ success: true, mission, publishResult });
        }

        return NextResponse.json({ success: true, mission });
      }

      case 'publish_mission': {
        const result = await publishMission(body.missionId);
        return NextResponse.json({ success: true, result });
      }

      case 'assign_freelance': {
        await assignFreelance(body.missionId, body.freelanceId);
        return NextResponse.json({ success: true });
      }

      case 'update_mission': {
        await updateMissionStatus(body.missionId, body.status);
        return NextResponse.json({ success: true });
      }

      case 'evaluate': {
        const result = await evaluateAndRegister({
          name:                  body.name,
          email:                 body.email,
          skills:                body.skills,
          platform:              body.platform,
          hourly_rate:           body.hourly_rate,
          currency:              body.currency,
          platform_profile_url:  body.platform_profile_url,
          bio:                   body.bio,
          portfolio_description: body.portfolio_description,
          platform_rating:       body.platform_rating,
          years_experience:      body.years_experience,
        });
        return NextResponse.json({ success: true, evaluation: result });
      }

      case 'blacklist': {
        await blacklistFreelance(body.freelanceId, body.reason);
        return NextResponse.json({ success: true });
      }

      case 'generate_contract': {
        const contract = await generateContract(body.missionId, body.freelanceId, body.type);

        if (body.send) {
          await sendContract(contract.id);
        }

        return NextResponse.json({ success: true, contract });
      }

      case 'send_contract': {
        await sendContract(body.contractId);
        return NextResponse.json({ success: true });
      }

      case 'sign_contract': {
        await markContractSigned(body.contractId);
        return NextResponse.json({ success: true });
      }

      // ---- Support client ----

      case 'answer_question': {
        const answer = await findAnswer(body.question);
        if (answer) await addToFAQ(body.question, answer);
        return NextResponse.json({ success: true, answer, source: answer ? 'knowledge_base' : 'llm' });
      }

      case 'create_ticket': {
        const ticket = await createTicket({
          clientEmail: body.client_email,
          subject:     body.subject,
          description: body.description,
          priority:    body.priority,
        });
        return NextResponse.json({ success: true, ticket });
      }

      case 'resolve_ticket': {
        const ticket = await getTicketById(body.ticket_id);
        if (!ticket) return NextResponse.json({ error: `Ticket ${body.ticket_id} introuvable` }, { status: 404 });
        await updateTicket(body.ticket_id, {
          status:            'resolved',
          resolution:        body.resolution,
          satisfactionScore: body.satisfaction_score,
        });
        return NextResponse.json({ success: true, ticket_id: body.ticket_id });
      }

      case 'escalate': {
        await escalateById(
          body.ticket_id,
          body.reason ?? 'Problème complexe nécessitant intervention humaine',
        );
        return NextResponse.json({ success: true, escalated_to: 'Karim Hammouche' });
      }

      case 'get_open_tickets': {
        const tickets = await getOpenTickets();
        return NextResponse.json({ success: true, tickets, count: tickets.length });
      }

      case 'add_faq': {
        await addToFAQ(body.question, body.answer);
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
        agent_name: 'CHOPPER',
        level:      'URGENT',
        message:    `Erreur API CHOPPER : action=${body.action}`,
      });
    } catch {
      // log silencieux
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---- GET — missions ouvertes + freelances disponibles ----

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const view       = searchParams.get('view');        // 'missions' | 'freelances' | 'contracts'
  const skills     = searchParams.get('skills');      // CSV pour filtrer freelances
  const missionId  = searchParams.get('missionId');

  // Détail contrats d'une mission
  if (missionId) {
    const { data: contracts, error } = await supabase
      .from('contracts')
      .select('id, contract_number, type, sent_at, signed_at, created_at')
      .eq('mission_id', missionId)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, contracts: contracts ?? [] });
  }

  if (view === 'freelances') {
    const skillsFilter = skills ? skills.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    const freelances   = await getAvailableFreelances(skillsFilter);
    return NextResponse.json({ success: true, freelances });
  }

  if (view === 'contracts') {
    const { data: contracts, error } = await supabase
      .from('contracts')
      .select('id, contract_number, type, mission_id, freelance_id, sent_at, signed_at, created_at')
      .is('signed_at', null)
      .not('sent_at', 'is', null)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, contracts: contracts ?? [] });
  }

  // Vue par défaut : missions ouvertes + résumé freelances
  const [missions, freelances] = await Promise.all([
    getOpenMissions(),
    getAvailableFreelances(),
  ]);

  const { data: statsRaw } = await supabase
    .from('missions')
    .select('status');

  interface StatusRow { status: string }
  const rows = (statsRaw ?? []) as unknown as StatusRow[];

  const stats = {
    ouvert:    rows.filter(r => r.status === 'ouvert').length,
    en_cours:  rows.filter(r => r.status === 'en_cours').length,
    livre:     rows.filter(r => r.status === 'livre').length,
    termine:   rows.filter(r => r.status === 'termine').length,
    freelances_disponibles: freelances.length,
  };

  return NextResponse.json({
    agent:      'CHOPPER',
    status:     'ACTIF',
    missions,
    freelances,
    stats,
  });
}

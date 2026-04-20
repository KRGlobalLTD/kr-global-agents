import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runInboxMonitor } from '@/lib/agents/luffy/inbox-monitor';
import { classifyEmail, type IncomingEmail } from '@/lib/agents/luffy/email-classifier';
import { respondToEmail } from '@/lib/agents/luffy/email-responder';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyInternalToken(request: NextRequest): boolean {
  return request.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

// ---- Payload types ----

interface ClassifyPayload {
  action: 'classify';
  messageId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  body: string;
  respond?: boolean;
}

type ActionPayload =
  | { action: 'monitor' }
  | ClassifyPayload;

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
      case 'monitor': {
        const result = await runInboxMonitor();
        return NextResponse.json({ success: true, result });
      }

      case 'classify': {
        const email: IncomingEmail = {
          messageId:  body.messageId,
          fromEmail:  body.fromEmail,
          fromName:   body.fromName,
          subject:    body.subject,
          body:       body.body,
          receivedAt: new Date(),
        };

        const result = await classifyEmail(email);

        if (body.respond) {
          await respondToEmail(email, result);
        }

        return NextResponse.json({ success: true, result });
      }

      default: {
        return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';

    try {
      await supabase.from('alerts').insert({
        agent_name: 'LUFFY',
        level: 'URGENT',
        message: `Erreur API LUFFY : action=${body.action}`,
      });
    } catch {
      // log silencieux
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---- GET — statut ----

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const [{ data: recentProspects }, { data: recentAlerts }] = await Promise.all([
    supabase
      .from('prospects')
      .select('name, email, status, urgency, summary, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('alerts')
      .select('level, message, created_at')
      .eq('agent_name', 'LUFFY')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return NextResponse.json({
    agent:            'LUFFY',
    status:           'ACTIF',
    recentProspects:  recentProspects ?? [],
    recentAlerts:     recentAlerts ?? [],
  });
}

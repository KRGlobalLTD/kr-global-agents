import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateContent, type ContentRequest, type ContentType, type Longueur } from '@/lib/agents/itachi/content-generator';
import {
  scheduleContent,
  approveContent,
  publishContent,
  archiveContent,
  getPendingApproval,
  type ContentStatus,
} from '@/lib/agents/itachi/content-scheduler';
import {
  trackMetrics,
  getContentMetrics,
  generateWeeklyReport,
} from '@/lib/agents/itachi/performance-tracker';

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
      action:      'generate';
      marque:      string;
      type:        ContentType;
      sujet:       string;
      ton?:        string;
      langue?:     string;
      longueur?:   Longueur;
      entite_nom:  string;
      statut?:     'draft' | 'approuve';
    }
  | {
      action:    'schedule';
      contentId: string;
      statut?:   ContentStatus;
    }
  | { action: 'approve';  contentId: string }
  | { action: 'publish';  contentId: string }
  | { action: 'archive';  contentId: string }
  | {
      action:       'track';
      contentId:    string;
      vues?:        number;
      clics?:       number;
      conversions?: number;
    }
  | { action: 'get_metrics';    contentId: string }
  | { action: 'weekly_report' };

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
      case 'generate': {
        const req: ContentRequest = {
          marque:     body.marque,
          type:       body.type,
          sujet:      body.sujet,
          ton:        body.ton       ?? 'professionnel',
          langue:     body.langue    ?? 'fr',
          longueur:   body.longueur  ?? 'moyen',
          entite_nom: body.entite_nom,
        };

        const generated = await generateContent(req);
        const contentId = await scheduleContent({
          request:  req,
          generated,
          statut:   body.statut ?? 'draft',
        });

        return NextResponse.json({ success: true, contentId, generated });
      }

      case 'schedule': {
        // Met à jour le statut d'un contenu existant
        const targetStatut: ContentStatus = body.statut ?? 'approuve';
        if (targetStatut === 'approuve') {
          await approveContent(body.contentId);
        } else if (targetStatut === 'publie') {
          await publishContent(body.contentId);
        } else if (targetStatut === 'archive') {
          await archiveContent(body.contentId);
        }
        return NextResponse.json({ success: true, statut: targetStatut });
      }

      case 'approve': {
        await approveContent(body.contentId);
        return NextResponse.json({ success: true });
      }

      case 'publish': {
        await publishContent(body.contentId);
        return NextResponse.json({ success: true });
      }

      case 'archive': {
        await archiveContent(body.contentId);
        return NextResponse.json({ success: true });
      }

      case 'track': {
        await trackMetrics({
          contentId:   body.contentId,
          vues:        body.vues,
          clics:       body.clics,
          conversions: body.conversions,
        });
        return NextResponse.json({ success: true });
      }

      case 'get_metrics': {
        const metrics = await getContentMetrics(body.contentId);
        if (!metrics) {
          return NextResponse.json({ error: 'Contenu introuvable' }, { status: 404 });
        }
        return NextResponse.json({ success: true, metrics });
      }

      case 'weekly_report': {
        await generateWeeklyReport();
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
        agent_name: 'ITACHI',
        level:      'URGENT',
        message:    `Erreur API ITACHI : action=${body.action}`,
      });
    } catch {
      // log silencieux
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---- GET — contenu en attente d'approbation ----

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const contentId = searchParams.get('contentId');

  if (contentId) {
    const metrics = await getContentMetrics(contentId);
    if (!metrics) {
      return NextResponse.json({ error: 'Contenu introuvable' }, { status: 404 });
    }
    return NextResponse.json({ success: true, metrics });
  }

  const pending = await getPendingApproval();
  return NextResponse.json({
    agent:   'ITACHI',
    status:  'ACTIF',
    pending,
  });
}

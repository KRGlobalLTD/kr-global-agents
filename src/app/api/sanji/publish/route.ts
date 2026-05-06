import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { publishContentViaPubler, publishApprovedContent } from '@/lib/agents/sanji/publisher';
import type { PubPlatform }          from '@/lib/agents/sanji/format-adapter';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyWebhookSecret(req: NextRequest): boolean {
  return req.headers.get('x-sanji-secret') === process.env.SANJI_WEBHOOK_SECRET;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });
  }

  const action = (body['action'] as string | undefined) ?? 'publish_one';

  try {
    // ── publish_one : planifie un contenu spécifique ──────────────────────────
    if (action === 'publish_one') {
      const contentId = body['content_id'] as string | undefined;
      if (!contentId) {
        return NextResponse.json({ error: 'content_id requis' }, { status: 400 });
      }

      const platforms = body['platforms'] as PubPlatform[] | undefined;
      const results   = await publishContentViaPubler(contentId, platforms);

      const scheduled = results.filter(r => r.statut === 'scheduled').length;
      const failed    = results.filter(r => r.statut === 'echec').length;

      await supabase.from('alerts').insert({
        agent_name: 'SANJI',
        level:      'INFO',
        message:    `publish_one ${contentId} : ${scheduled} planifiés, ${failed} échecs`,
      });

      return NextResponse.json({ results, scheduled, failed });
    }

    // ── publish_approved : batch tous les contenus approuvés ─────────────────
    if (action === 'publish_approved') {
      const summary = await publishApprovedContent();
      return NextResponse.json(summary);
    }

    return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabase.from('alerts').insert({
      agent_name: 'SANJI',
      level:      'WARNING',
      message:    `POST /api/sanji/publish erreur : ${message.slice(0, 200)}`,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

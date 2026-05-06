import { NextRequest, NextResponse } from 'next/server';
import { adaptForPlatform, adaptForAllPlatforms, type PubPlatform } from '@/lib/agents/sanji/format-adapter';
import { getNextSlot } from '@/lib/agents/sanji/scheduler';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });
  }

  const sujet    = (body['sujet']    as string | undefined) ?? 'L\'IA transforme les PME en 2025';
  const contenu  = (body['contenu']  as string | undefined) ?? sujet;
  const hashtags = (body['hashtags'] as string[] | undefined) ?? ['IA', 'Automation', 'PME'];
  const platform = body['platform']  as PubPlatform | undefined;

  try {
    // Dry-run : adapte le contenu sans publier ni générer d'image
    const adapted = platform
      ? [await adaptForPlatform(sujet, contenu, hashtags, platform)]
      : await adaptForAllPlatforms(sujet, contenu, hashtags);

    // Calcul des créneaux suivants pour chaque plateforme adaptée
    const slots = await Promise.all(
      adapted.map(async a => ({
        platform:     a.platform,
        next_slot:    await getNextSlot(a.platform),
        texte_length: a.texte.length,
        hashtags:     a.hashtags,
        imagePrompt:  a.imagePrompt,
      }))
    );

    await supabase.from('alerts').insert({
      agent_name: 'SANJI',
      level:      'INFO',
      message:    `Dry-run test : ${adapted.length} plateformes adaptées pour "${sujet.slice(0, 60)}"`,
    });

    return NextResponse.json({
      dry_run:  true,
      sujet,
      adapted:  adapted.map(a => ({ platform: a.platform, texte: a.texte, hashtags: a.hashtags })),
      slots,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

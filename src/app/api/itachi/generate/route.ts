import { NextRequest, NextResponse } from 'next/server';
import { generateContent, type ContentType } from '@/lib/agents/itachi/content-generator';
import { scheduleContent }                   from '@/lib/agents/itachi/content-scheduler';
import { notifyDraft }                       from '@/lib/agents/itachi/slack-notifier';

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

const VALID_TYPES = new Set<ContentType>([
  'article_seo', 'post_linkedin', 'post_instagram', 'post_tiktok',
  'newsletter', 'script_podcast', 'script_youtube',
]);

interface GenerateBody {
  marque:      string;
  type:        ContentType;
  sujet:       string;
  ton?:        string;
  langue?:     string;
  longueur?:   string;
  entite_nom?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const {
    marque,
    type,
    sujet,
    ton        = 'professionnel',
    langue     = 'fr',
    entite_nom = marque ?? 'KR Global',
  } = body;

  if (!marque || !type || !sujet) {
    return NextResponse.json({ error: 'marque, type et sujet sont requis' }, { status: 400 });
  }

  if (!VALID_TYPES.has(type)) {
    return NextResponse.json({
      error: `type invalide. Valeurs acceptées : ${[...VALID_TYPES].join(', ')}`,
    }, { status: 400 });
  }

  try {
    const generated = await generateContent({ marque, type, sujet, ton, langue, entite_nom });

    const contentId = await scheduleContent({
      request:   { marque, type, sujet, ton, langue, longueur: 'long', entite_nom },
      generated,
      statut:    'draft',
    });

    // Notification Slack #contenu uniquement pour les types structurants
    const notifyTypes: ContentType[] = ['article_seo', 'script_podcast', 'script_youtube', 'newsletter'];
    if (notifyTypes.includes(type)) {
      await notifyDraft({
        contentId,
        plateforme: type,
        langue,
        titre:      generated.titre,
        contenu:    generated.contenu,
        hashtags:   generated.hashtags,
      });
    }

    return NextResponse.json({
      content_id:       contentId,
      titre:            generated.titre,
      contenu:          generated.contenu,
      hashtags:         generated.hashtags,
      meta_description: generated.meta_description,
      modele:           generated.modele,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

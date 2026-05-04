import { NextRequest, NextResponse } from 'next/server';
import { generateContent, type ContentType, type Longueur } from '@/lib/agents/itachi/content-generator';
import { scheduleContent } from '@/lib/agents/itachi/content-scheduler';
import { notifyDraft } from '@/lib/agents/itachi/slack-notifier';

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

type Plateforme = 'linkedin' | 'twitter' | 'blog';

const PLATEFORME_TYPE: Record<Plateforme, ContentType> = {
  linkedin: 'post',
  twitter:  'post',
  blog:     'article',
};

const PLATEFORME_LONGUEUR: Record<Plateforme, Longueur> = {
  linkedin: 'moyen',
  twitter:  'court',
  blog:     'long',
};

interface GenerateBody {
  sujet:      string;
  plateforme: Plateforme;
  langue?:    string;
  ton?:       string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });
  }

  const { sujet, plateforme, langue = 'fr', ton = 'professionnel' } = body;

  if (!sujet || !plateforme) {
    return NextResponse.json({ error: 'sujet et plateforme sont requis' }, { status: 400 });
  }

  if (!['linkedin', 'twitter', 'blog'].includes(plateforme)) {
    return NextResponse.json({ error: 'plateforme doit être : linkedin, twitter ou blog' }, { status: 400 });
  }

  // Contexte plateforme injecté dans le sujet pour guider le LLM
  const platformeCtx: Record<Plateforme, string> = {
    linkedin: '[LINKEDIN — 1500 caractères max, storytelling pro, 3-5 hashtags]',
    twitter:  '[TWITTER/X — 280 caractères max, accrocheur, 1-2 hashtags]',
    blog:     '[BLOG — 800-1200 mots, SEO-friendly, titre H1 + sous-titres H2]',
  };

  const sujetAvecCtx = `${platformeCtx[plateforme]} ${sujet}`;

  try {
    const generated = await generateContent({
      marque:     'KR Global Solutions Ltd',
      type:       PLATEFORME_TYPE[plateforme],
      sujet:      sujetAvecCtx,
      ton,
      langue,
      longueur:   PLATEFORME_LONGUEUR[plateforme],
      entite_nom: 'KR Global',
    });

    const contentId = await scheduleContent({
      request: {
        marque:     'KR Global Solutions Ltd',
        type:       PLATEFORME_TYPE[plateforme],
        sujet,
        ton,
        langue,
        longueur:   PLATEFORME_LONGUEUR[plateforme],
        entite_nom: 'KR Global',
      },
      generated,
      statut: 'draft',
    });

    await notifyDraft({
      contentId,
      plateforme,
      langue,
      titre:   generated.titre,
      contenu: generated.contenu,
      hashtags: generated.hashtags,
    });

    return NextResponse.json({
      content_id: contentId,
      contenu:    generated.contenu,
      hashtags:   generated.hashtags,
      titre:      generated.titre,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

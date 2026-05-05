import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export type Platform = 'linkedin' | 'instagram' | 'tiktok' | 'twitter';

export interface PublishInput {
  contentId?:  string;      // depuis la table content d'ITACHI
  texte?:      string;      // texte brut si pas de contentId
  hashtags?:   string[];
  plateformes: Platform[];
  mediaUrl?:   string;      // requis pour Instagram (image)
}

export interface PublishResult {
  plateforme:       Platform;
  statut:           'publie' | 'planifie' | 'echec';
  publication_id:   string;
  platform_post_id?: string;
  erreur?:          string;
}

// ---- Types OpenRouter ----

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
}

// ---- Contenu source depuis ITACHI ----

interface ContentRow {
  titre:    string | null;
  contenu:  string | null;
  hashtags: string[];
}

async function fetchContentFromDb(contentId: string): Promise<ContentRow> {
  const { data, error } = await supabase
    .from('content')
    .select('titre, contenu, hashtags')
    .eq('id', contentId)
    .single();

  if (error || !data) throw new Error(`Contenu introuvable : ${contentId}`);
  return data as unknown as ContentRow;
}

// ---- Adaptation par plateforme via Gemini 2.0 Flash ----

const PLATFORM_GUIDES: Record<Platform, string> = {
  twitter: (
    'Twitter/X - percutant et direct, 280 caractères tout compris (texte + hashtags), ' +
    '2 hashtags maximum, hook fort en première ligne, un seul message.'
  ),
  linkedin: (
    'LinkedIn - ton B2B professionnel, 1 200 caractères max, ' +
    '3 à 5 hashtags en fin de texte, pas d\'excès d\'emojis, ' +
    'structure : accroche → valeur → CTA.'
  ),
  instagram: (
    'Instagram - ton engageant et visuel, 2 200 caractères max, ' +
    'emojis bienvenus, 10 à 15 hashtags en fin de légende, ' +
    'structure : phrase d\'accroche → histoire → hashtags.'
  ),
  tiktok: (
    'TikTok - ton décontracté et percutant, 150 caractères max, ' +
    'hook fort en première ligne, langage tendance, ' +
    '3 à 5 hashtags pertinents, pensé pour être lu en vidéo.'
  ),
};

interface AdaptedContent {
  texte:    string;
  hashtags: string[];
}

async function adaptForPlatform(
  texte:      string,
  hashtags:   string[],
  plateforme: Platform
): Promise<AdaptedContent> {
  const systemPrompt =
    `Tu es SANJI, l'agent réseaux sociaux de KR Global Solutions Ltd (agence IA, Londres).\n` +
    `Adapte le contenu fourni pour la plateforme suivante :\n` +
    `${PLATFORM_GUIDES[plateforme]}\n\n` +
    `Retourne UNIQUEMENT un JSON valide : { "texte": "...", "hashtags": ["...", "..."] }\n` +
    `- "hashtags" : tableau de mots-clés sans le symbole #\n` +
    `Ne modifie pas le sens, adapte uniquement le style et la longueur.`;

  const userPrompt =
    `Contenu original :\n${texte}\n\n` +
    `Hashtags suggérés : ${hashtags.join(', ')}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kr-global.com',
      'X-Title':      'SANJI - KR Global',
    },
    body: JSON.stringify({
      model:           'google/gemini-2.0-flash-001',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.65,
      max_tokens:      1200,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter adaptation ${plateforme} : ${response.status} ${err}`);
  }

  const data  = (await response.json()) as OpenRouterResponse;
  const raw   = data.choices?.[0]?.message?.content ?? '{}';

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`JSON adaptation invalide (${plateforme}) : ${raw.slice(0, 200)}`);
  }

  const texteAdapte = typeof parsed['texte'] === 'string' && parsed['texte'].length > 0
    ? parsed['texte']
    : texte;

  const hashtagsAdaptes = Array.isArray(parsed['hashtags'])
    ? (parsed['hashtags'] as unknown[]).filter((h): h is string => typeof h === 'string')
    : hashtags;

  return { texte: texteAdapte, hashtags: hashtagsAdaptes };
}

// ---- LinkedIn API ----

interface LinkedInPostResponse {
  id: string;
}

async function publishToLinkedIn(
  texteAdapte: string,
  hashtags:    string[]
): Promise<string> {
  const token     = process.env.LINKEDIN_ACCESS_TOKEN;
  const authorUrn = process.env.LINKEDIN_AUTHOR_URN;

  if (!token || !authorUrn) throw new Error('LINKEDIN_ACCESS_TOKEN ou LINKEDIN_AUTHOR_URN manquant');

  const fullText = hashtags.length > 0
    ? `${texteAdapte}\n\n${hashtags.map(h => `#${h}`).join(' ')}`
    : texteAdapte;

  const body = {
    author:           authorUrn,
    lifecycleState:   'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary:    { text: fullText },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LinkedIn API ${res.status}: ${err}`);
  }

  const data = (await res.json()) as LinkedInPostResponse;
  return data.id;
}

// ---- Twitter/X API v2 (OAuth 1.0a) ----

function buildOAuth1Header(
  method: string,
  url:    string,
  body:   Record<string, string>,
): string {
  const apiKey      = process.env.TWITTER_API_KEY ?? '';
  const apiSecret   = process.env.TWITTER_API_SECRET ?? '';
  const token       = process.env.TWITTER_ACCESS_TOKEN ?? '';
  const tokenSecret = process.env.TWITTER_ACCESS_SECRET ?? '';

  const nonce     = crypto.randomBytes(16).toString('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));

  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     apiKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        timestamp,
    oauth_token:            token,
    oauth_version:          '1.0',
  };

  const allParams = { ...oauthParams, ...body };
  const paramStr  = Object.keys(allParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const baseStr   = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramStr)}`;
  const signingKey = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(tokenSecret)}`;
  const signature  = crypto.createHmac('sha1', signingKey).update(baseStr).digest('base64');

  const header = Object.entries({ ...oauthParams, oauth_signature: signature })
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(', ');

  return `OAuth ${header}`;
}

async function publishToTwitter(text: string): Promise<string> {
  const apiKey      = process.env.TWITTER_API_KEY;
  const apiSecret   = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    await supabase.from('alerts').insert({
      agent_name: 'SANJI',
      level:      'WARNING',
      message:    'Twitter non configuré : TWITTER_API_KEY / SECRET manquants — publication ignorée',
    });
    throw new Error('Twitter non configuré');
  }

  const tweetText = text.slice(0, 280);
  const url       = 'https://api.twitter.com/2/tweets';
  const bodyObj   = { text: tweetText };
  const authHeader = buildOAuth1Header('POST', url, {});

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyObj),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twitter API ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { data: { id: string } };
  return data.data.id;
}

// ---- Instagram Graph API ----

interface InstagramContainerResponse { id: string }
interface InstagramPublishResponse   { id: string }

const IG_BASE = 'https://graph.facebook.com/v21.0';

async function publishToInstagram(
  texteAdapte: string,
  hashtags:    string[],
  mediaUrl?:   string
): Promise<string> {
  const token     = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;

  if (!token || !accountId) throw new Error('INSTAGRAM_ACCESS_TOKEN ou INSTAGRAM_ACCOUNT_ID manquant');
  if (!mediaUrl)            throw new Error('mediaUrl requis pour publier sur Instagram');

  const caption = hashtags.length > 0
    ? `${texteAdapte}\n\n${hashtags.map(h => `#${h}`).join(' ')}`
    : texteAdapte;

  // Étape 1 - Créer le conteneur média
  const containerParams = new URLSearchParams({
    image_url:    mediaUrl,
    caption,
    access_token: token,
  });

  const containerRes = await fetch(
    `${IG_BASE}/${accountId}/media?${containerParams.toString()}`,
    { method: 'POST' }
  );

  if (!containerRes.ok) {
    const err = await containerRes.text();
    throw new Error(`Instagram conteneur ${containerRes.status}: ${err}`);
  }

  const container = (await containerRes.json()) as InstagramContainerResponse;

  // Étape 2 - Publier le conteneur
  const publishParams = new URLSearchParams({
    creation_id:  container.id,
    access_token: token,
  });

  const publishRes = await fetch(
    `${IG_BASE}/${accountId}/media_publish?${publishParams.toString()}`,
    { method: 'POST' }
  );

  if (!publishRes.ok) {
    const err = await publishRes.text();
    throw new Error(`Instagram publication ${publishRes.status}: ${err}`);
  }

  const published = (await publishRes.json()) as InstagramPublishResponse;
  return published.id;
}

// ---- TikTok ----
// L'API TikTok Content Posting nécessite une vidéo ou une image.
// Le texte seul est sauvegardé comme "planifie" pour publication manuelle.

// ---- Sauvegarde dans social_publications ----

async function savePublication(params: {
  contentId?:       string;
  plateforme:       Platform;
  texteAdapte:      string;
  hashtags:         string[];
  statut:           'publie' | 'planifie' | 'echec';
  platform_post_id?: string;
  erreur?:          string;
}): Promise<string> {
  const { data, error } = await supabase
    .from('social_publications')
    .insert({
      content_id:       params.contentId ?? null,
      plateforme:       params.plateforme,
      texte_adapte:     params.texteAdapte,
      hashtags:         params.hashtags,
      statut:           params.statut,
      platform_post_id: params.platform_post_id ?? null,
      erreur:           params.erreur ?? null,
      published_at:     params.statut === 'publie' ? new Date().toISOString() : null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Erreur sauvegarde publication : ${error.message}`);
  return (data as { id: string }).id;
}

// ---- Orchestrateur principal ----

export async function publishContent(input: PublishInput): Promise<PublishResult[]> {
  // Résoudre le texte source
  let sourceTexte:    string;
  let sourceHashtags: string[];

  if (input.contentId) {
    const row    = await fetchContentFromDb(input.contentId);
    sourceTexte  = [row.titre, row.contenu].filter(Boolean).join('\n\n');
    sourceHashtags = Array.isArray(row.hashtags) ? row.hashtags : [];
  } else if (input.texte) {
    sourceTexte    = input.texte;
    sourceHashtags = input.hashtags ?? [];
  } else {
    throw new Error('contentId ou texte requis');
  }

  const results: PublishResult[] = [];

  for (const plateforme of input.plateformes) {
    let pubId: string;
    let adapted: AdaptedContent;

    // Adaptation IA
    try {
      adapted = await adaptForPlatform(sourceTexte, sourceHashtags, plateforme);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erreur adaptation';
      pubId = await savePublication({
        contentId:   input.contentId,
        plateforme,
        texteAdapte: sourceTexte,
        hashtags:    sourceHashtags,
        statut:      'echec',
        erreur:      errMsg,
      });
      results.push({ plateforme, statut: 'echec', publication_id: pubId, erreur: errMsg });

      await supabase.from('alerts').insert({
        agent_name: 'SANJI',
        level:      'WARNING',
        message:    `Échec adaptation ${plateforme} : ${errMsg.slice(0, 150)}`,
      });
      continue;
    }

    // Publication plateforme
    try {
      let postId: string | undefined;
      let statut: 'publie' | 'planifie' = 'publie';

      if (plateforme === 'linkedin') {
        postId = await publishToLinkedIn(adapted.texte, adapted.hashtags);
      } else if (plateforme === 'instagram') {
        postId = await publishToInstagram(adapted.texte, adapted.hashtags, input.mediaUrl);
      } else if (plateforme === 'twitter') {
        const tweetText = adapted.hashtags.length > 0
          ? `${adapted.texte} ${adapted.hashtags.slice(0, 2).map(h => `#${h}`).join(' ')}`.slice(0, 280)
          : adapted.texte.slice(0, 280);
        postId = await publishToTwitter(tweetText);
      } else {
        // TikTok - contenu adapté enregistré pour publication manuelle
        statut = 'planifie';
      }

      pubId = await savePublication({
        contentId:        input.contentId,
        plateforme,
        texteAdapte:      adapted.texte,
        hashtags:         adapted.hashtags,
        statut,
        platform_post_id: postId,
      });

      results.push({
        plateforme,
        statut,
        publication_id:   pubId,
        platform_post_id: postId,
      });

      await supabase.from('alerts').insert({
        agent_name: 'SANJI',
        level:      'INFO',
        message:    `Publication ${statut} sur ${plateforme} (id=${pubId})`,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erreur publication';
      pubId = await savePublication({
        contentId:   input.contentId,
        plateforme,
        texteAdapte: adapted.texte,
        hashtags:    adapted.hashtags,
        statut:      'echec',
        erreur:      errMsg,
      });
      results.push({ plateforme, statut: 'echec', publication_id: pubId, erreur: errMsg });

      await supabase.from('alerts').insert({
        agent_name: 'SANJI',
        level:      'WARNING',
        message:    `Échec publication ${plateforme} : ${errMsg.slice(0, 150)}`,
      });
    }
  }

  // Marquer le contenu ITACHI comme publié si au moins une réussite
  if (input.contentId && results.some(r => r.statut === 'publie')) {
    await supabase
      .from('content')
      .update({ statut: 'publie', published_at: new Date().toISOString() })
      .eq('id', input.contentId);
  }

  return results;
}

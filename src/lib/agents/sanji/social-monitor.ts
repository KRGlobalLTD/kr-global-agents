import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const IG_BASE = 'https://graph.facebook.com/v21.0';

// ---- Types ----

export interface MonitorResult {
  processed:    number;    // publications vérifiées
  new_mentions: number;    // nouvelles mentions trouvées
  opportunities: number;  // opportunités détectées
  alerts_sent:  number;   // alertes Slack envoyées
}

// ---- Types API LinkedIn ----

interface LinkedInCommentMessage {
  text: string;
}

interface LinkedInCommentActor {
  // urn:li:person:xxx or urn:li:organization:xxx
}

interface LinkedInComment {
  id:      string;
  actor:   string | LinkedInCommentActor;
  message: LinkedInCommentMessage;
}

interface LinkedInCommentsResponse {
  elements: LinkedInComment[];
}

// ---- Types API Instagram ----

interface InstagramComment {
  id:        string;
  text:      string;
  username?: string;
  timestamp: string;
}

interface InstagramCommentsResponse {
  data: InstagramComment[];
}

// ---- Types OpenRouter ----

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
}

// ---- Classification mention via Gemini 2.0 Flash ----

interface MentionClassification {
  sentiment:  'positif' | 'neutre' | 'negatif';
  opportunite: boolean;
  raison:     string;
}

async function classifyMention(
  contenu:    string,
  plateforme: string
): Promise<MentionClassification> {
  const systemPrompt =
    `Tu es SANJI, l'agent réseaux sociaux de KR Global Solutions Ltd (agence IA, Londres).\n` +
    `Analyse ce commentaire publié sur ${plateforme} et retourne UNIQUEMENT un JSON valide :\n` +
    `{ "sentiment": "positif|neutre|negatif", "opportunite": true|false, "raison": "..." }\n\n` +
    `"opportunite" = true si : demande de service, intérêt de collaboration, lead potentiel, ` +
    `journaliste/influenceur, mention de concurrence à adresser.\n` +
    `"raison" : explication en une phrase.`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kr-global.com',
      'X-Title':      'SANJI — KR Global',
    },
    body: JSON.stringify({
      model:           'google/gemini-2.0-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `Commentaire : "${contenu}"` },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.3,
      max_tokens:      200,
    }),
  });

  if (!response.ok) {
    return { sentiment: 'neutre', opportunite: false, raison: 'Classification indisponible' };
  }

  const data  = (await response.json()) as OpenRouterResponse;
  const raw   = data.choices?.[0]?.message?.content ?? '{}';

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { sentiment: 'neutre', opportunite: false, raison: 'JSON invalide' };
  }

  const sentiment = (
    parsed['sentiment'] === 'positif' ||
    parsed['sentiment'] === 'negatif'
  ) ? parsed['sentiment'] : 'neutre';

  const opportunite = parsed['opportunite'] === true;
  const raison = typeof parsed['raison'] === 'string' ? parsed['raison'] : '';

  return { sentiment, opportunite, raison };
}

// ---- Alerte Slack #general ----

async function alertSlack(params: {
  plateforme:    string;
  auteur:        string;
  contenu:       string;
  sentiment:     string;
  opportunite:   boolean;
  raison:        string;
  publicationId: string;
}): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_GENERAL;
  if (!webhookUrl) return;

  const icon     = params.opportunite ? '💡' : params.sentiment === 'negatif' ? '⚠️' : '💬';
  const label    = params.opportunite ? 'OPPORTUNITÉ détectée' : 'Mention négative signalée';

  const text =
    `${icon} *SANJI — ${label}*\n` +
    `Plateforme : ${params.plateforme}\n` +
    `Auteur : ${params.auteur}\n` +
    `Commentaire : "${params.contenu.slice(0, 200)}"\n` +
    `Sentiment : ${params.sentiment} | ${params.raison}\n` +
    `Publication : \`${params.publicationId}\``;

  const slackRes = await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      username:   'SANJI',
      icon_emoji: ':speech_balloon:',
    }),
  });

  if (!slackRes.ok) {
    await supabase.from('alerts').insert({
      agent_name: 'SANJI',
      level:      'WARNING',
      message:    `Slack #general webhook échoué (monitor) : ${slackRes.status}`,
    });
  }
}

// ---- LinkedIn : récupération des commentaires ----

async function fetchLinkedInComments(postUrn: string): Promise<Array<{ id: string; auteur: string; contenu: string }>> {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) return [];

  const encoded = encodeURIComponent(postUrn);
  const res = await fetch(
    `https://api.linkedin.com/v2/socialActions/${encoded}/comments?count=50`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    }
  );

  if (!res.ok) return [];

  const data = (await res.json()) as LinkedInCommentsResponse;
  return (data.elements ?? []).map(c => ({
    id:      c.id,
    auteur:  typeof c.actor === 'string' ? c.actor : 'linkedin_user',
    contenu: c.message?.text ?? '',
  }));
}

// ---- Instagram : récupération des commentaires ----

async function fetchInstagramComments(mediaId: string): Promise<Array<{ id: string; auteur: string; contenu: string }>> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return [];

  const params = new URLSearchParams({
    fields:       'id,text,username,timestamp',
    access_token: token,
  });

  const res = await fetch(`${IG_BASE}/${mediaId}/comments?${params.toString()}`);
  if (!res.ok) return [];

  const data = (await res.json()) as InstagramCommentsResponse;
  return (data.data ?? []).map(c => ({
    id:      c.id,
    auteur:  c.username ?? 'instagram_user',
    contenu: c.text,
  }));
}

// ---- Type de publication récente ----

interface RecentPublication {
  id:               string;
  plateforme:       string;
  platform_post_id: string | null;
}

// ---- Cycle de surveillance principal ----

export async function runMonitorCycle(): Promise<MonitorResult> {
  // Publications publiées dans les 30 derniers jours avec un ID plateforme
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const { data: publications, error } = await supabase
    .from('social_publications')
    .select('id, plateforme, platform_post_id')
    .eq('statut', 'publie')
    .not('platform_post_id', 'is', null)
    .gte('published_at', since);

  if (error) throw new Error(`Erreur lecture publications : ${error.message}`);

  const pubs = (publications ?? []) as unknown as RecentPublication[];

  let newMentions  = 0;
  let opportunities = 0;
  let alertsSent   = 0;

  for (const pub of pubs) {
    if (!pub.platform_post_id) continue;

    let comments: Array<{ id: string; auteur: string; contenu: string }> = [];

    if (pub.plateforme === 'linkedin') {
      comments = await fetchLinkedInComments(pub.platform_post_id);
    } else if (pub.plateforme === 'instagram') {
      comments = await fetchInstagramComments(pub.platform_post_id);
    }
    // TikTok : API commentaires nécessite permissions spéciales, ignoré

    for (const comment of comments) {
      if (!comment.contenu.trim()) continue;

      // Déduplication par platform_mention_id
      const { data: existing } = await supabase
        .from('social_mentions')
        .select('id')
        .eq('platform_mention_id', comment.id)
        .maybeSingle();

      if (existing) continue;

      // Classification IA
      const classification = await classifyMention(comment.contenu, pub.plateforme);

      const shouldAlert = classification.opportunite || classification.sentiment === 'negatif';

      const { error: insertError } = await supabase.from('social_mentions').insert({
        publication_id:      pub.id,
        plateforme:          pub.plateforme,
        platform_mention_id: comment.id,
        auteur:              comment.auteur,
        contenu:             comment.contenu,
        sentiment:           classification.sentiment,
        opportunite:         classification.opportunite,
        raison:              classification.raison,
        alerted_at:          shouldAlert ? new Date().toISOString() : null,
      });

      if (insertError) {
        if (insertError.code !== '23505') {
          await supabase.from('alerts').insert({
            agent_name: 'SANJI',
            level:      'WARNING',
            message:    `Erreur insertion mention ${comment.id} : ${insertError.message}`,
          });
        }
        continue;
      }

      newMentions++;
      if (classification.opportunite) opportunities++;

      if (shouldAlert) {
        await alertSlack({
          plateforme:    pub.plateforme,
          auteur:        comment.auteur,
          contenu:       comment.contenu,
          sentiment:     classification.sentiment,
          opportunite:   classification.opportunite,
          raison:        classification.raison,
          publicationId: pub.id,
        });
        alertsSent++;
      }
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'SANJI',
    level:      'INFO',
    message:
      `Cycle monitor : ${pubs.length} publications, ${newMentions} nouvelles mentions, ` +
      `${opportunities} opportunité(s), ${alertsSent} alerte(s)`,
  });

  return {
    processed:    pubs.length,
    new_mentions: newMentions,
    opportunities,
    alerts_sent:  alertsSent,
  };
}

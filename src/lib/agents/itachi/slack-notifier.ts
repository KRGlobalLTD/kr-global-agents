import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PLATFORM_EMOJI: Record<string, string> = {
  linkedin: '🔗',
  twitter:  '🐦',
  blog:     '📝',
};

const LANGUE_LABEL: Record<string, string> = {
  fr: 'Français',
  en: 'English',
  ar: 'عربي',
};

export interface DraftNotificationInput {
  contentId:   string;
  plateforme:  string;
  langue:      string;
  titre:       string | null;
  contenu:     string;
  hashtags:    string[];
  datePrevue?: Date;
}

async function postToSlack(text: string, emoji: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_CONTENU;
  if (!webhookUrl) return;

  const res = await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, username: 'ITACHI', icon_emoji: emoji }),
  });

  if (!res.ok) {
    await supabase.from('alerts').insert({
      agent_name: 'ITACHI',
      level:      'WARNING',
      message:    `Slack #contenu webhook échoué : ${res.status}`,
    });
  }
}

export async function notifyDraft(input: DraftNotificationInput): Promise<void> {
  const { contentId, plateforme, langue, titre, contenu, hashtags, datePrevue } = input;

  const platformeLabel  = plateforme.charAt(0).toUpperCase() + plateforme.slice(1);
  const emoji           = PLATFORM_EMOJI[plateforme] ?? '💬';
  const langueLabel     = LANGUE_LABEL[langue] ?? langue;
  const apercu          = contenu.slice(0, 300) + (contenu.length > 300 ? '…' : '');
  const hashtagsStr     = hashtags.length > 0 ? hashtags.map(h => `#${h}`).join(' ') : '_aucun_';
  const dateStr         = datePrevue
    ? datePrevue.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '_Non planifié_';

  const lines = [
    `${emoji} *Nouveau draft à valider — ${platformeLabel}* (${langueLabel})`,
    ``,
    titre ? `*Titre :* ${titre}` : '',
    ``,
    `*Aperçu :*`,
    `> ${apercu}`,
    ``,
    `*Hashtags :* ${hashtagsStr}`,
    `*Date prévue :* ${dateStr}`,
    `*ID :* \`${contentId}\``,
    ``,
    `_Répondre ✅ pour approuver — ❌ pour rejeter_`,
  ].filter(l => l !== null) as string[];

  await postToSlack(lines.join('\n'), ':pencil2:');
}

export async function notifyApproved(contentId: string, titre: string): Promise<void> {
  await postToSlack(
    `✅ *Contenu approuvé — prêt à publier*\n*Titre :* ${titre}\n*ID :* \`${contentId}\``,
    ':white_check_mark:',
  );
}

export async function notifyRejected(contentId: string, raison?: string): Promise<void> {
  const msg = `❌ *Contenu rejeté*\n*ID :* \`${contentId}\`` +
    (raison ? `\n*Raison :* ${raison}` : '');
  await postToSlack(msg, ':x:');
}

export async function notifyPublished(contentId: string, plateforme: string, titre: string): Promise<void> {
  const emoji = PLATFORM_EMOJI[plateforme] ?? '💬';
  await postToSlack(
    `${emoji} *Contenu publié sur ${plateforme}*\n*Titre :* ${titre}\n*ID :* \`${contentId}\``,
    ':rocket:',
  );
}

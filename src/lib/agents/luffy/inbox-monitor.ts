import { createClient } from '@supabase/supabase-js';
import { classifyEmail, type IncomingEmail } from './email-classifier';
import { respondToEmail } from './email-responder';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types Zoho Mail API ----

interface ZohoTokenResponse {
  access_token: string;
  expires_in: number;
}

interface ZohoStatus {
  code: number;
}

interface ZohoMessage {
  messageId: string;
  folderId: string;
  subject: string;
  fromAddress: string;
  sender: string;       // display name / sender name
  receivedTime: string; // ms timestamp en string
}

interface ZohoMessagesResponse {
  status: ZohoStatus;
  data: ZohoMessage[];
}

interface ZohoContentData {
  content: string;
  mailId?: string;
}

interface ZohoContentResponse {
  status: ZohoStatus;
  data: ZohoContentData;
}

export interface MonitorResult {
  fetched: number;
  processed: number;
  errors: number;
}

// ---- Config ----

const ZOHO_MAIL_BASE = 'https://mail.zoho.com/api';
const ZOHO_AUTH_URL  = 'https://accounts.zoho.com/oauth/v2/token';

// ---- OAuth2 — rafraîchissement du token ----

async function refreshAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
    client_id:     process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
  });

  const response = await fetch(ZOHO_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Zoho OAuth refresh ${response.status}: ${err}`);
  }

  const data = (await response.json()) as ZohoTokenResponse;
  return data.access_token;
}

// ---- Appels Zoho Mail API ----

function zohoHeaders(token: string): Record<string, string> {
  return { Authorization: `Zoho-oauthtoken ${token}` };
}

async function fetchUnreadMessages(token: string): Promise<ZohoMessage[]> {
  const accountId = process.env.ZOHO_ACCOUNT_ID_!;
  const url = `${ZOHO_MAIL_BASE}/accounts/${accountId}/messages/view?status=unread&limit=20`;

  const response = await fetch(url, { headers: zohoHeaders(token) });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Zoho messages ${response.status}: ${err}`);
  }

  const data = (await response.json()) as ZohoMessagesResponse;
  return data.data ?? [];
}

async function fetchMessageContent(
  token: string,
  messageId: string,
  folderId: string
): Promise<string> {
  const accountId = process.env.ZOHO_ACCOUNT_ID_!;
  const url = `${ZOHO_MAIL_BASE}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/content`;

  const response = await fetch(url, { headers: zohoHeaders(token) });

  if (!response.ok) {
    throw new Error(`Zoho contenu message ${response.status}`);
  }

  const data = (await response.json()) as ZohoContentResponse;
  return data.data?.content ?? '';
}

async function markAsRead(
  token: string,
  messageId: string
): Promise<void> {
  const accountId = process.env.ZOHO_ACCOUNT_ID_!;
  const url = `${ZOHO_MAIL_BASE}/accounts/${accountId}/updatemessage`;

  // Non-blocking: deduplication via Supabase message_id handles reprocessing prevention
  fetch(url, {
    method: 'PUT',
    headers: { ...zohoHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'markAsRead', messageId: [messageId] }),
  }).catch(() => { /* intentionally silent */ });
}

// ---- Strip HTML ----

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---- Déduplication ----

async function isAlreadyProcessed(messageId: string): Promise<boolean> {
  const { data } = await supabase
    .from('prospects')
    .select('id')
    .eq('message_id', messageId)
    .maybeSingle();

  return data !== null;
}

// ---- Point d'entrée principal ----

export async function runInboxMonitor(): Promise<MonitorResult> {
  const token    = await refreshAccessToken();
  const messages = await fetchUnreadMessages(token);

  let processed = 0;
  let errors    = 0;

  for (const msg of messages) {
    // Ignorer les emails envoyés par LUFFY lui-même (boucle)
    if (msg.fromAddress === 'agent@krglobalsolutionsltd.com') {
      await markAsRead(token, msg.messageId);
      continue;
    }

    // Déduplication : déjà traité ?
    const alreadyDone = await isAlreadyProcessed(msg.messageId);
    if (alreadyDone) {
      await markAsRead(token, msg.messageId);
      continue;
    }

    try {
      const rawContent = await fetchMessageContent(token, msg.messageId, msg.folderId);
      const body       = stripHtml(rawContent);

      const email: IncomingEmail = {
        messageId:  msg.messageId,
        fromEmail:  msg.fromAddress,
        fromName:   msg.sender,
        subject:    msg.subject,
        body,
        receivedAt: new Date(parseInt(msg.receivedTime, 10)),
      };

      const result = await classifyEmail(email);
      await respondToEmail(email, result);
      await markAsRead(token, msg.messageId);

      processed++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erreur inconnue';
      errors++;

      await supabase.from('alerts').insert({
        agent_name: 'LUFFY',
        level: 'WARNING',
        message: `Erreur traitement email ${msg.messageId} : ${errMsg.slice(0, 150)}`,
      });

      // Ne pas marquer comme lu pour permettre une nouvelle tentative
    }
  }

  await supabase.from('alerts').insert({
    agent_name: 'LUFFY',
    level: 'INFO',
    message: `Cycle inbox : ${messages.length} email(s) récupérés, ${processed} traités, ${errors} erreurs`,
  });

  return { fetched: messages.length, processed, errors };
}

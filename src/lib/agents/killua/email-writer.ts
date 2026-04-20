import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export type EmailType = 'initial' | 'followup1' | 'followup2';

export interface ProspectProfile {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string | null;
  company: string | null;
  industry: string | null;
}

export interface GeneratedEmail {
  subject: string;
  html: string;
}

// ---- Réponse OpenRouter ----

interface OpenRouterMessage {
  content: string;
}

interface OpenRouterChoice {
  message: OpenRouterMessage;
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
}

// ---- Prompts ----

const SYSTEM_PROMPT = `Tu es KILLUA, l'agent de prospection de KR Global Solutions Ltd (UK).

À propos de KR Global Solutions Ltd :
- Agence basée à Londres, spécialisée en automatisation IA et développement digital
- Services : agents IA sur mesure, développement web/mobile, conseil en transformation digitale
- Clients : PME, startups, entreprises en croissance (France, UK, Benelux)

Rédige un email de prospection B2B professionnel en français.
Retourne UNIQUEMENT un JSON valide : { "subject": "...", "html": "..." }
Le champ "html" contient du HTML simple (<p>, <strong>, <ul>, <li>, <br>).
L'email doit être concis (150-200 mots max), personnalisé, sans jargon.
Ne jamais inventer de chiffres ou de références fictives.`;

function buildUserPrompt(
  prospect: ProspectProfile,
  type: EmailType
): string {
  const profile =
    `Prospect :\n` +
    `- Prénom : ${prospect.firstName}\n` +
    `- Poste : ${prospect.jobTitle ?? 'Non précisé'}\n` +
    `- Entreprise : ${prospect.company ?? 'Non précisée'}\n` +
    `- Secteur : ${prospect.industry ?? 'Non précisé'}\n`;

  const typeInstructions: Record<EmailType, string> = {
    initial:
      `Type : PREMIER CONTACT\n` +
      `Objectif : se présenter, créer de l'intérêt, proposer un échange de 15 min.\n` +
      `Approche : valeur ajoutée pour leur secteur, pas de pitch agressif.`,
    followup1:
      `Type : PREMIÈRE RELANCE (J+3)\n` +
      `Contexte : pas de réponse au premier email.\n` +
      `Objectif : relance courte et bienveillante, rappel de la valeur proposée.`,
    followup2:
      `Type : DERNIÈRE RELANCE (J+7)\n` +
      `Contexte : aucune réponse après deux emails.\n` +
      `Objectif : dernier message, laisser la porte ouverte, créer une légère urgence.`,
  };

  return `${profile}\n${typeInstructions[type]}`;
}

// ---- Appel OpenRouter ----

export async function writeOutreachEmail(
  prospect: ProspectProfile,
  type: EmailType
): Promise<GeneratedEmail> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kr-global.com',
      'X-Title':      'KILLUA — KR Global',
    },
    body: JSON.stringify({
      model:           'anthropic/claude-sonnet-4-5',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: buildUserPrompt(prospect, type) },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.7,
      max_tokens:      600,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${err}`);
  }

  const data  = (await response.json()) as OpenRouterResponse;
  const raw   = data.choices?.[0]?.message?.content ?? '{}';

  let parsed: { subject?: unknown; html?: unknown };
  try {
    parsed = JSON.parse(raw) as { subject?: unknown; html?: unknown };
  } catch {
    throw new Error(`JSON email invalide : ${raw.slice(0, 200)}`);
  }

  const subject = typeof parsed.subject === 'string' && parsed.subject.length > 0
    ? parsed.subject
    : `KR Global Solutions — ${type === 'initial' ? 'Collaboration' : 'Suite de notre échange'}`;

  const html = typeof parsed.html === 'string' && parsed.html.length > 0
    ? parsed.html
    : `<p>Bonjour ${prospect.firstName},</p><p>Message généré — contenu indisponible.</p>`;

  await supabase.from('alerts').insert({
    agent_name: 'KILLUA',
    level: 'INFO',
    message: `Email ${type} généré pour ${prospect.email} (${prospect.company ?? 'N/A'})`,
  });

  return { subject, html };
}

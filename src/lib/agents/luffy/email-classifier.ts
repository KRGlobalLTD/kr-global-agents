import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Types ----

export type Classification =
  | 'prospect_chaud'
  | 'prospect_froid'
  | 'client'
  | 'spam'
  | 'autre';

export interface IncomingEmail {
  messageId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  body: string;         // texte brut (HTML déjà strippé)
  receivedAt: Date;
}

export interface ClassificationResult {
  classification: Classification;
  name: string | null;
  company: string | null;
  need: string | null;
  urgency: 'haute' | 'normale' | 'faible';
  summary: string;
}

// ---- Réponse brute OpenRouter ----

interface OpenRouterMessage {
  content: string;
}

interface OpenRouterChoice {
  message: OpenRouterMessage;
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
}

// ---- Prompt système ----

const SYSTEM_PROMPT = `Tu es LUFFY, l'agent emails entrants de KR Global Solutions Ltd (UK).
Analyse l'email reçu et retourne UNIQUEMENT un objet JSON valide avec ces champs :

{
  "classification": "prospect_chaud" | "prospect_froid" | "client" | "spam" | "autre",
  "name": string | null,
  "company": string | null,
  "need": string | null,
  "urgency": "haute" | "normale" | "faible",
  "summary": string
}

Critères :
- prospect_chaud : demande de devis, projet urgent, budget évoqué, "je cherche une agence/prestataire"
- prospect_froid : question générale, prise d'info, curiosité sans projet défini
- client : mentionne une mission en cours, une facture KR Global, un livrable attendu
- spam : publicité, newsletter, phishing, cold email automatisé
- autre : RH, partenariat, presse, administratif

Retourne uniquement le JSON, sans markdown, sans commentaires.`;

// ---- Appel OpenRouter ----

async function callOpenRouter(email: IncomingEmail): Promise<ClassificationResult> {
  const userContent =
    `De : ${email.fromName} <${email.fromEmail}>\n` +
    `Objet : ${email.subject}\n\n` +
    `${email.body.slice(0, 3000)}`; // limite raisonnable pour le modèle

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kr-global.com',
      'X-Title':      'LUFFY — KR Global',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.0-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${err}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  const raw  = data.choices?.[0]?.message?.content ?? '{}';

  let parsed: Partial<ClassificationResult>;
  try {
    parsed = JSON.parse(raw) as Partial<ClassificationResult>;
  } catch {
    throw new Error(`JSON IA invalide : ${raw.slice(0, 200)}`);
  }

  const validClassifications: Classification[] = [
    'prospect_chaud', 'prospect_froid', 'client', 'spam', 'autre',
  ];
  const validUrgencies = ['haute', 'normale', 'faible'] as const;

  return {
    classification: validClassifications.includes(parsed.classification as Classification)
      ? (parsed.classification as Classification)
      : 'autre',
    name:    typeof parsed.name    === 'string' ? parsed.name    : null,
    company: typeof parsed.company === 'string' ? parsed.company : null,
    need:    typeof parsed.need    === 'string' ? parsed.need    : null,
    urgency: validUrgencies.includes(parsed.urgency as (typeof validUrgencies)[number])
      ? (parsed.urgency as 'haute' | 'normale' | 'faible')
      : 'normale',
    summary: typeof parsed.summary === 'string' ? parsed.summary : email.subject,
  };
}

// ---- Persistance Supabase ----

const STATUS_MAP: Partial<Record<Classification, string>> = {
  prospect_chaud: 'CHAUD',
  prospect_froid: 'FROID',
};

export async function saveProspect(
  email: IncomingEmail,
  result: ClassificationResult
): Promise<void> {
  const status = STATUS_MAP[result.classification];
  if (!status) return; // client / spam / autre → pas de prospect

  const displayName = result.name ?? (email.fromName || null);

  const { error } = await supabase.from('prospects').upsert(
    {
      message_id:     email.messageId,
      name:           displayName,
      contact_name:   displayName,
      email:          email.fromEmail,
      company:        result.company,
      status,
      need:           result.need,
      urgency:        result.urgency,
      summary:        result.summary,
      source:         'EMAIL',
      last_contact_at: email.receivedAt.toISOString(),
    },
    { onConflict: 'message_id', ignoreDuplicates: true }
  );

  if (error) throw new Error(`Erreur sauvegarde prospect : ${error.message}`);
}

// ---- Point d'entrée principal ----

export async function classifyEmail(email: IncomingEmail): Promise<ClassificationResult> {
  const result = await callOpenRouter(email);

  await supabase.from('alerts').insert({
    agent_name: 'LUFFY',
    level: 'INFO',
    message: `Email classifié : ${result.classification} | urgence=${result.urgency} | from=${email.fromEmail}`,
  });

  await saveProspect(email, result);

  return result;
}

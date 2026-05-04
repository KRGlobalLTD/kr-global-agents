import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BLACKLIST_THRESHOLD = 3.0;

// ---- Types ----

export type FreelancePlatform = 'upwork' | 'fiverr' | 'direct' | 'autre';

export interface FreelanceProfileInput {
  name:                  string;
  email:                 string;
  skills:                string[];
  hourly_rate?:          number;
  currency?:             string;
  platform:              FreelancePlatform;
  platform_profile_url?: string;
  bio?:                  string;
  portfolio_description?: string;
  platform_rating?:      number;    // note existante sur la plateforme (0–5)
  years_experience?:     number;
}

export interface ScoreDetail {
  competences_techniques: number;
  communication:          number;
  experience:             number;
  portfolio:              number;
  rapport_qualite_prix:   number;
  overall:                number;
}

export interface EvaluationResult {
  score:       number;
  detail:      ScoreDetail;
  strengths:   string[];
  weaknesses:  string[];
  recommendation: string;
  blacklisted: boolean;
}

export interface Freelance {
  id:                   string;
  name:                 string;
  email:                string;
  skills:               string[];
  hourly_rate:          number | null;
  currency:             string;
  platform:             FreelancePlatform;
  platform_profile_url: string | null;
  score:                number | null;
  score_detail:         ScoreDetail | null;
  blacklisted:          boolean;
  blacklist_reason:     string | null;
  blacklisted_at:       string | null;
  missions_completed:   number;
  bio:                  string | null;
  created_at:           string;
}

// ---- Types OpenRouter ----

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
}

// ---- Prompt d'évaluation ----

function buildEvaluationPrompt(input: FreelanceProfileInput): string {
  return (
    `Tu es CHOPPER, l'agent RH de KR Global Solutions Ltd (agence IA, Londres).\n` +
    `Évalue ce profil freelance et retourne UNIQUEMENT un JSON valide :\n` +
    `{\n` +
    `  "competences_techniques": <note 0-5>,\n` +
    `  "communication": <note 0-5>,\n` +
    `  "experience": <note 0-5>,\n` +
    `  "portfolio": <note 0-5>,\n` +
    `  "rapport_qualite_prix": <note 0-5>,\n` +
    `  "strengths": ["...", "..."],\n` +
    `  "weaknesses": ["...", "..."],\n` +
    `  "recommendation": "..."\n` +
    `}\n\n` +
    `Critères :\n` +
    `- competences_techniques : pertinence des compétences pour une agence IA/digital\n` +
    `- communication : qualité de la bio, clarté de l'expression\n` +
    `- experience : années d'expérience + missions complétées\n` +
    `- portfolio : qualité et pertinence du portfolio décrit\n` +
    `- rapport_qualite_prix : taux horaire vs niveau perçu\n` +
    `- strengths/weaknesses : 2 à 3 éléments chacun\n` +
    `- recommendation : 1 phrase de décision (recruter / à surveiller / déconseillé)`
  );
}

function buildProfileText(input: FreelanceProfileInput): string {
  const lines: string[] = [
    `Nom : ${input.name}`,
    `Plateforme : ${input.platform}`,
    `Compétences : ${input.skills.join(', ')}`,
  ];
  if (input.hourly_rate)         lines.push(`Taux horaire : ${input.hourly_rate} ${input.currency ?? 'EUR'}/h`);
  if (input.years_experience)    lines.push(`Expérience : ${input.years_experience} an(s)`);
  if (input.platform_rating)     lines.push(`Note plateforme : ${input.platform_rating}/5`);
  if (input.bio)                 lines.push(`Bio : ${input.bio.slice(0, 500)}`);
  if (input.portfolio_description) lines.push(`Portfolio : ${input.portfolio_description.slice(0, 500)}`);

  return lines.join('\n');
}

// ---- Appel Gemini via OpenRouter ----

async function callGemini(
  systemPrompt: string,
  userPrompt:   string
): Promise<Record<string, unknown>> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kr-global.com',
      'X-Title':      'CHOPPER - KR Global',
    },
    body: JSON.stringify({
      model:           'google/gemini-2.0-flash-001',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.3,
      max_tokens:      600,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${err}`);
  }

  const data  = (await response.json()) as OpenRouterResponse;
  const raw   = data.choices?.[0]?.message?.content ?? '{}';

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`JSON évaluation invalide : ${raw.slice(0, 200)}`);
  }
}

// ---- Parsing du résultat ----

function toScore(v: unknown, fallback = 3): number {
  if (typeof v !== 'number') return fallback;
  return Math.min(5, Math.max(0, Math.round(v * 10) / 10));
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter((s): s is string => typeof s === 'string');
}

function parseEvaluationResult(parsed: Record<string, unknown>): {
  detail: ScoreDetail;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  score: number;
} {
  const detail: ScoreDetail = {
    competences_techniques: toScore(parsed['competences_techniques']),
    communication:          toScore(parsed['communication']),
    experience:             toScore(parsed['experience']),
    portfolio:              toScore(parsed['portfolio']),
    rapport_qualite_prix:   toScore(parsed['rapport_qualite_prix']),
    overall:                0,
  };

  detail.overall = Math.round(
    ((detail.competences_techniques +
      detail.communication +
      detail.experience +
      detail.portfolio +
      detail.rapport_qualite_prix) / 5) * 10
  ) / 10;

  return {
    detail,
    score:          detail.overall,
    strengths:      toStringArray(parsed['strengths']),
    weaknesses:     toStringArray(parsed['weaknesses']),
    recommendation: typeof parsed['recommendation'] === 'string' ? parsed['recommendation'] : '',
  };
}

// ---- Évaluation + enregistrement ----

export async function evaluateAndRegister(input: FreelanceProfileInput): Promise<EvaluationResult> {
  const parsed = await callGemini(
    buildEvaluationPrompt(input),
    buildProfileText(input)
  );

  const { detail, score, strengths, weaknesses, recommendation } = parseEvaluationResult(parsed);
  const shouldBlacklist = score < BLACKLIST_THRESHOLD;

  // Upsert freelance (on_conflict par email)
  const { data, error } = await supabase
    .from('freelances')
    .upsert(
      {
        name:                  input.name,
        email:                 input.email,
        skills:                input.skills,
        hourly_rate:           input.hourly_rate    ?? null,
        currency:              input.currency       ?? 'EUR',
        platform:              input.platform,
        platform_profile_url:  input.platform_profile_url ?? null,
        bio:                   input.bio            ?? null,
        score,
        score_detail:          detail,
        blacklisted:           shouldBlacklist,
        blacklist_reason:      shouldBlacklist ? `Score automatique ${score}/5 (< ${BLACKLIST_THRESHOLD})` : null,
        blacklisted_at:        shouldBlacklist ? new Date().toISOString() : null,
      },
      { onConflict: 'email' }
    )
    .select('id')
    .single();

  if (error) throw new Error(`Erreur enregistrement freelance : ${error.message}`);

  const freelanceId = (data as { id: string }).id;

  const level = shouldBlacklist ? 'WARNING' : 'INFO';
  await supabase.from('alerts').insert({
    agent_name: 'CHOPPER',
    level,
    message:
      `Freelance ${input.name} (${input.email}) évalué : score=${score}/5` +
      (shouldBlacklist ? ' → BLACKLISTÉ automatiquement' : ''),
  });

  return { score, detail, strengths, weaknesses, recommendation, blacklisted: shouldBlacklist };
}

// ---- Blacklist manuelle ----

export async function blacklistFreelance(
  freelanceId: string,
  reason:      string
): Promise<void> {
  const { error } = await supabase
    .from('freelances')
    .update({
      blacklisted:      true,
      blacklist_reason: reason,
      blacklisted_at:   new Date().toISOString(),
    })
    .eq('id', freelanceId);

  if (error) throw new Error(`Erreur blacklist freelance : ${error.message}`);

  await supabase.from('alerts').insert({
    agent_name: 'CHOPPER',
    level:      'WARNING',
    message:    `Freelance id=${freelanceId} blacklisté manuellement : ${reason}`,
  });
}

// ---- Freelances disponibles ----

export async function getAvailableFreelances(skills?: string[]): Promise<Freelance[]> {
  let query = supabase
    .from('freelances')
    .select('*')
    .eq('blacklisted', false)
    .order('score', { ascending: false });

  if (skills && skills.length > 0) {
    // Filtre JSONB : au moins une compétence en commun
    query = query.overlaps('skills', skills);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture freelances : ${error.message}`);
  return (data ?? []) as unknown as Freelance[];
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { runGraph, type TaskType }   from '@/lib/langgraph/supervisor';
import { callOpenRouter }            from '@/lib/langgraph/openrouter';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Keyword routing ───────────────────────────────────────────────────────────

const ROUTES: [RegExp, TaskType, Record<string, unknown>][] = [
  [/chiffre.{0,20}affaires|facture|dépense|comptabilité|coût|budget|💰/i, 'accounting',      { action: 'generate_report' }],
  [/rapport|résumé|kpi|stats?|performances?|📊/i,                         'reporting',       { action: 'get_kpis' }],
  [/post|linkedin|twitter|contenu|marketing|rédige|génère.*post|✍️/i,     'marketing',       { action: 'track_performance' }],
  [/prospect|lead|acquisition|🎯/i,                                        'prospecting',     { action: 'scrape_leads' }],
  [/client|onboarding|accueil/i,                                           'onboarding',      { action: 'retention_cycle' }],
  [/statut|agents?|santé|infrastructure|services?|outils?|🤖/i,           'infrastructure',  { action: 'health_check' }],
  [/recherche|veille|concurrent|tendance|marché|🔍/i,                     'research',        { action: 'generate_report' }],
  [/email|inbox|mail/i,                                                    'email',           { action: 'process_email' }],
  [/social|instagram|publier|publication|📱/i,                            'social',          { action: 'get_calendar' }],
];

function routeMessage(message: string): [TaskType, Record<string, unknown>] {
  for (const [pattern, taskType, taskInput] of ROUTES) {
    if (pattern.test(message)) return [taskType, taskInput];
  }
  return ['supervisor', { action: 'check_agents' }];
}

// ── Response formatter ────────────────────────────────────────────────────────

async function formatResponse(
  userMessage: string,
  taskResult:  Record<string, unknown>,
  agentName:   string,
  taskType:    string,
  status:      string,
): Promise<string> {
  if (status === 'failed') {
    return `Désolé, l'agent ${agentName} a rencontré une erreur en traitant ta demande. Réessaie dans quelques instants.`;
  }

  const content = `Tu es HASHIRAMA, superviseur IA de KR Global Solutions Ltd (agence IA, Londres).
L'agent ${agentName} (tâche : ${taskType}) a retourné ce résultat :
${JSON.stringify(taskResult, null, 2).slice(0, 1500)}

L'utilisateur avait demandé : "${userMessage}"

Génère une réponse conversationnelle en français (4-6 phrases max), claire et professionnelle.
Mets en avant les informations les plus importantes du résultat.
Si le résultat est vide ou peu informatif, résume l'action effectuée et indique que tu collectes les données.
N'utilise jamais de JSON brut dans ta réponse — uniquement du texte naturel structuré.`;

  return callOpenRouter([{ role: 'user', content }]);
}

// ── POST — envoyer un message ─────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { message: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });
  }

  const { message } = body;
  if (!message?.trim()) {
    return NextResponse.json({ error: 'Message vide' }, { status: 400 });
  }

  const trimmed = message.trim();

  // Save user message
  await supabase.from('chat_history').insert({ role: 'user', message: trimmed });

  const [taskType, taskInput] = routeMessage(trimmed);

  try {
    const result   = await runGraph(taskType, taskInput);
    const response = await formatResponse(trimmed, result.task_result ?? {}, result.agent_name, taskType, result.status);

    await supabase.from('chat_history').insert({
      role:       'agent',
      agent_name: result.agent_name,
      message:    response,
      task_type:  taskType,
    });

    return NextResponse.json({
      agent_name: result.agent_name,
      response,
      task_type:  taskType,
    });
  } catch {
    const fallback = 'Je rencontre une difficulté technique momentanée. Réessaie dans un instant.';

    await supabase.from('chat_history').insert({
      role:       'agent',
      agent_name: 'HASHIRAMA',
      message:    fallback,
      task_type:  taskType,
    });

    return NextResponse.json({ agent_name: 'HASHIRAMA', response: fallback, task_type: taskType });
  }
}

// ── GET — charger l'historique ────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase
    .from('chat_history')
    .select('id, role, agent_name, message, task_type, created_at')
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) return NextResponse.json({ messages: [] });
  return NextResponse.json({ messages: data ?? [] });
}

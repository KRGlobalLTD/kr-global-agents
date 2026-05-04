import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { createClient } from '@supabase/supabase-js';

// ── State ────────────────────────────────────────────────────────────────────

export const KRGlobalState = Annotation.Root({
  /** Description libre de la tâche à exécuter */
  task: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  /** Nom de l'agent sélectionné par le supervisor */
  agent_name: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  /** Résultat retourné par l'agent */
  result: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  /** Statut du cycle : idle → routing → running → done | error */
  status: Annotation<'idle' | 'routing' | 'running' | 'done' | 'error'>({
    reducer: (_prev, next) => next,
    default: () => 'idle',
  }),
  /** Message d'erreur si status === 'error' */
  error: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
});

export type KRGlobalStateType = typeof KRGlobalState.State;

// ── Routing map ──────────────────────────────────────────────────────────────

type AgentNode = 'zoro' | 'nami' | 'luffy' | 'killua' | 'itachi';

/**
 * Mots-clés associés à chaque agent.
 * HASHIRAMA scanne le champ `task` et sélectionne le premier match.
 *
 * ZORO     — finance, comptabilité, facturation, TVA, UK
 * NAMI     — onboarding, client, rétention, CRM, email
 * LUFFY    — inbox, message, réponse, support, assistance
 * KILLUA   — prospection, lead, campagne, cold email, acquisition
 * ITACHI   — contenu, linkedin, twitter, blog, post, marketing
 */
const ROUTING_MAP: Record<AgentNode, string[]> = {
  zoro:    ['factur', 'finance', 'comptab', 'tva', 'uk', 'devis', 'paiement', 'stripe', 'coût'],
  nami:    ['onboard', 'client', 'rétention', 'retention', 'crm', 'séquence', 'sequence'],
  luffy:   ['inbox', 'message', 'réponse', 'reponse', 'support', 'assistance', 'ticket'],
  killua:  ['prospect', 'lead', 'campagne', 'campaign', 'cold', 'acquisition', 'email outreach'],
  itachi:  ['contenu', 'content', 'linkedin', 'twitter', 'blog', 'post', 'marketing', 'rédac'],
};

function routeTask(task: string): AgentNode {
  const lower = task.toLowerCase();
  for (const [agent, keywords] of Object.entries(ROUTING_MAP) as [AgentNode, string[]][]) {
    if (keywords.some(kw => lower.includes(kw))) return agent;
  }
  // Fallback : LUFFY gère les tâches non reconnues
  return 'luffy';
}

// ── Supabase logger ──────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function logAlert(agentName: string, level: 'INFO' | 'WARNING' | 'URGENT', message: string) {
  try {
    await getSupabase().from('alerts').insert({ agent_name: agentName, level, message });
  } catch {
    // log silencieux — ne doit pas faire crasher le graph
  }
}

// ── Nodes ────────────────────────────────────────────────────────────────────

/** HASHIRAMA — supervisor : route la tâche vers le bon agent */
async function supervisorNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const agent = routeTask(state.task);
  await logAlert('HASHIRAMA', 'INFO', `Routing "${state.task.slice(0, 80)}" → ${agent.toUpperCase()}`);
  return { agent_name: agent, status: 'routing' };
}

/** ZORO — finance, facturation, comptabilité */
async function zoroNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  await logAlert('ZORO', 'INFO', `Tâche reçue : ${state.task.slice(0, 80)}`);
  // TODO: brancher les modules zoro (invoice-generator, cost-tracker, uk-deadlines…)
  return {
    result:     `[ZORO] Tâche finance traitée : "${state.task}"`,
    status:     'done',
    agent_name: 'ZORO',
  };
}

/** NAMI — onboarding, rétention, CRM */
async function namiNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  await logAlert('NAMI', 'INFO', `Tâche reçue : ${state.task.slice(0, 80)}`);
  // TODO: brancher les modules nami (onboarding-flow, retention-sequence…)
  return {
    result:     `[NAMI] Tâche CRM traitée : "${state.task}"`,
    status:     'done',
    agent_name: 'NAMI',
  };
}

/** LUFFY — inbox, support, réponses */
async function luffyNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  await logAlert('LUFFY', 'INFO', `Tâche reçue : ${state.task.slice(0, 80)}`);
  // TODO: brancher les modules luffy (email-classifier, email-responder, inbox-monitor…)
  return {
    result:     `[LUFFY] Tâche inbox traitée : "${state.task}"`,
    status:     'done',
    agent_name: 'LUFFY',
  };
}

/** KILLUA — prospection, cold email, campagnes */
async function killuaNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  await logAlert('KILLUA', 'INFO', `Tâche reçue : ${state.task.slice(0, 80)}`);
  // TODO: brancher les modules killua (prospect-finder, campaign-manager, email-writer…)
  return {
    result:     `[KILLUA] Tâche prospection traitée : "${state.task}"`,
    status:     'done',
    agent_name: 'KILLUA',
  };
}

/** ITACHI — contenu marketing, LinkedIn, Twitter, blog */
async function itachiNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  await logAlert('ITACHI', 'INFO', `Tâche reçue : ${state.task.slice(0, 80)}`);
  // TODO: brancher les modules itachi (content-generator, content-scheduler…)
  return {
    result:     `[ITACHI] Tâche contenu traitée : "${state.task}"`,
    status:     'done',
    agent_name: 'ITACHI',
  };
}

// ── Conditional routing ──────────────────────────────────────────────────────

function selectAgent(state: KRGlobalStateType): AgentNode {
  return (state.agent_name as AgentNode) || 'luffy';
}

// ── Graph assembly ───────────────────────────────────────────────────────────

const graph = new StateGraph(KRGlobalState)
  // nodes
  .addNode('supervisor', supervisorNode)
  .addNode('zoro',       zoroNode)
  .addNode('nami',       namiNode)
  .addNode('luffy',      luffyNode)
  .addNode('killua',     killuaNode)
  .addNode('itachi',     itachiNode)
  // entrypoint
  .addEdge(START, 'supervisor')
  // routing conditionnel depuis supervisor
  .addConditionalEdges('supervisor', selectAgent, {
    zoro:   'zoro',
    nami:   'nami',
    luffy:  'luffy',
    killua: 'killua',
    itachi: 'itachi',
  })
  // chaque agent termine le cycle
  .addEdge('zoro',   END)
  .addEdge('nami',   END)
  .addEdge('luffy',  END)
  .addEdge('killua', END)
  .addEdge('itachi', END);

export const hashirama = graph.compile();

// ── Public helper ────────────────────────────────────────────────────────────

export async function runTask(task: string): Promise<KRGlobalStateType> {
  const result = await hashirama.invoke({ task, status: 'idle' });
  return result as KRGlobalStateType;
}

import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { createClient }  from '@supabase/supabase-js';
import { KRGlobalState, type KRGlobalStateType, type TaskType } from './state';
import { zoroNode }      from './agents/zoro';
import { namiNode }      from './agents/nami';
import { luffyNode }     from './agents/luffy';
import { killuaNode }    from './agents/killua';
import { itachiNode }    from './agents/itachi';
import { tsunadeNode }   from './agents/tsunade';
import { hashiramaNode } from './agents/hashirama';
import { garpNode }        from './agents/garp';
import { orochimaruNode }  from './agents/orochimaru';
import { sanjiNode }       from './agents/sanji';
import { robinNode }       from './agents/robin';
import { chopperNode }     from './agents/chopper';
import { brookNode }       from './agents/brook';
import { minatoNode }      from './agents/minato';
import { nejiNode }        from './agents/neji';
import { gaaraNode }       from './agents/gaara';

// ── Routing ───────────────────────────────────────────────────────────────────

const TASK_AGENT: Record<TaskType, string> = {
  accounting:   'zoro',
  onboarding:   'nami',
  email:        'luffy',
  prospecting:  'killua',
  marketing:    'itachi',
  finance:      'tsunade',
  supervisor:   'hashirama',
  reporting:      'garp',
  infrastructure: 'orochimaru',
  social:         'sanji',
  research:       'robin',
  support:        'chopper',
  knowledge:      'brook',
  optimization:   'minato',
  analytics:      'neji',
  maroc:          'gaara',
};

// ── Supervisor node ───────────────────────────────────────────────────────────

async function supervisorNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const agent = TASK_AGENT[state.task_type] ?? 'luffy';

  try {
    await createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
      .from('alerts')
      .insert({
        agent_name: 'HASHIRAMA',
        level:      'INFO',
        message:    `Routing task_type=${state.task_type} → ${agent.toUpperCase()}`,
      });
  } catch {
    // non-blocking
  }

  return {
    agent_name: agent,
    status:     'running',
    messages:   [new HumanMessage(`HASHIRAMA routing ${state.task_type} → ${agent}`)],
  };
}

function selectAgent(state: KRGlobalStateType): string {
  return state.agent_name || 'luffy';
}

// ── Graph ─────────────────────────────────────────────────────────────────────

const graph = new StateGraph(KRGlobalState)
  .addNode('supervisor', supervisorNode)
  .addNode('zoro',       zoroNode)
  .addNode('nami',       namiNode)
  .addNode('luffy',      luffyNode)
  .addNode('killua',     killuaNode)
  .addNode('itachi',     itachiNode)
  .addNode('tsunade',    tsunadeNode)
  .addNode('hashirama',  hashiramaNode)
  .addNode('garp',        garpNode)
  .addNode('orochimaru',  orochimaruNode)
  .addNode('sanji',       sanjiNode)
  .addNode('robin',       robinNode)
  .addNode('chopper',     chopperNode)
  .addNode('brook',       brookNode)
  .addNode('minato',      minatoNode)
  .addNode('neji',        nejiNode)
  .addNode('gaara',       gaaraNode)
  .addEdge(START, 'supervisor')
  .addConditionalEdges('supervisor', selectAgent, {
    zoro:      'zoro',
    nami:      'nami',
    luffy:     'luffy',
    killua:    'killua',
    itachi:    'itachi',
    tsunade:   'tsunade',
    hashirama: 'hashirama',
    garp:        'garp',
    orochimaru:  'orochimaru',
    sanji:       'sanji',
    robin:       'robin',
    chopper:     'chopper',
    brook:       'brook',
    minato:      'minato',
    neji:        'neji',
    gaara:       'gaara',
  })
  .addEdge('zoro',      END)
  .addEdge('nami',      END)
  .addEdge('luffy',     END)
  .addEdge('killua',    END)
  .addEdge('itachi',    END)
  .addEdge('tsunade',   END)
  .addEdge('hashirama', END)
  .addEdge('garp',       END)
  .addEdge('orochimaru', END)
  .addEdge('sanji',      END)
  .addEdge('robin',      END)
  .addEdge('chopper',    END)
  .addEdge('brook',      END)
  .addEdge('minato',     END)
  .addEdge('neji',       END)
  .addEdge('gaara',      END);

export const hashirama = graph.compile();

// ── Public API ────────────────────────────────────────────────────────────────

export async function runGraph(
  taskType:  TaskType,
  taskInput: Record<string, unknown> = {},
  metadata:  Record<string, unknown> = {},
): Promise<KRGlobalStateType> {
  return hashirama.invoke({
    task_type:  taskType,
    task_input: taskInput,
    status:     'pending',
    metadata,
  }) as Promise<KRGlobalStateType>;
}

// Re-export state types for consumers
export { KRGlobalState, type KRGlobalStateType, type TaskType } from './state';

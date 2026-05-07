import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

export type TaskType = 'accounting' | 'marketing' | 'email' | 'prospecting' | 'onboarding' | 'finance' | 'supervisor' | 'reporting' | 'infrastructure' | 'social' | 'research' | 'support' | 'knowledge' | 'optimization' | 'analytics';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export const KRGlobalState = Annotation.Root({
  task_type: Annotation<TaskType>({
    reducer:  (_prev, next) => next,
    default:  () => 'email',
  }),
  task_input: Annotation<Record<string, unknown>>({
    reducer:  (_prev, next) => next,
    default:  () => ({}),
  }),
  task_result: Annotation<Record<string, unknown>>({
    reducer:  (prev, next) => ({ ...prev, ...next }),
    default:  () => ({}),
  }),
  agent_name: Annotation<string>({
    reducer:  (_prev, next) => next,
    default:  () => '',
  }),
  status: Annotation<TaskStatus>({
    reducer:  (_prev, next) => next,
    default:  () => 'pending',
  }),
  error: Annotation<string | null>({
    reducer:  (_prev, next) => next,
    default:  () => null,
  }),
  messages: Annotation<BaseMessage[]>({
    reducer:  (prev, next) => [...prev, ...next],
    default:  () => [],
  }),
  metadata: Annotation<Record<string, unknown>>({
    reducer:  (prev, next) => ({ ...prev, ...next }),
    default:  () => ({}),
  }),
});

export type KRGlobalStateType = typeof KRGlobalState.State;

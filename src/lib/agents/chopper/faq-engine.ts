import { recall, remember }    from '@/lib/qdrant/memory';
import { COLLECTIONS }          from '@/lib/qdrant/collections';
import { getLLM }               from '@/lib/langchain/llm';
import { ChatPromptTemplate }   from '@langchain/core/prompts';
import { StringOutputParser }   from '@langchain/core/output_parsers';
import { createClient }         from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SUPPORT_SYSTEM = `Tu es l'assistant support de KR Global Solutions Ltd (agence IA, Londres UK).
Services : développement agents IA, automation business, cold outreach, gestion réseaux sociaux IA, consulting PME.
Réponds de façon concise, empathique et professionnelle. Si tu n'as pas de réponse précise, dis-le clairement et propose une escalade.`;

const supportChain = ChatPromptTemplate.fromMessages([
  ['system', SUPPORT_SYSTEM],
  ['human', '{input}'],
]).pipe(getLLM(false)).pipe(new StringOutputParser());

const contextChain = ChatPromptTemplate.fromMessages([
  ['system', SUPPORT_SYSTEM],
  ['human', '{input}'],
]).pipe(getLLM(false)).pipe(new StringOutputParser());

export async function findAnswer(question: string): Promise<string | null> {
  if (!question.trim()) return null;

  // 1. Recherche sémantique dans Qdrant kr_knowledge
  try {
    const results = await recall(COLLECTIONS.knowledge, question, {
      limit:    3,
      minScore: 0.65,
    });

    if (results.length > 0) {
      const context = results.map(r => r.text).join('\n\n');
      const answer  = await contextChain.invoke({
        input: `Question : ${question}\n\nBase de connaissance :\n${context}\n\nRéponds en utilisant ces informations.`,
      });
      return answer || null;
    }
  } catch {
    // Qdrant indisponible — fallback LLM direct
  }

  // 2. Génération LLM sans contexte Qdrant
  try {
    const answer = await supportChain.invoke({ input: question });
    return answer || null;
  } catch (err) {
    void supabase.from('alerts').insert({
      agent_name: 'CHOPPER',
      level:      'WARNING',
      message:    `findAnswer LLM erreur : ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
    });
    return null;
  }
}

export async function addToFAQ(question: string, answer: string): Promise<void> {
  if (!question.trim() || !answer.trim()) return;

  const id   = `faq-${Date.now()}`;
  const text = `Q: ${question}\nA: ${answer}`;

  try {
    await remember(COLLECTIONS.knowledge, {
      id,
      text,
      payload: {
        type:    'faq',
        question,
        answer,
        savedAt: new Date().toISOString(),
        source:  'CHOPPER',
      },
    });
  } catch {
    // Non-bloquant si Qdrant indisponible
  }

  void supabase.from('alerts').insert({
    agent_name: 'CHOPPER',
    level:      'INFO',
    message:    `FAQ kr_knowledge enrichie : "${question.slice(0, 80)}"`,
  });
}

export async function getClientContext(clientEmail: string): Promise<string> {
  if (!clientEmail) return '';

  try {
    const results = await recall(COLLECTIONS.clients, clientEmail, {
      limit:    3,
      minScore: 0.5,
    });
    if (!results.length) return '';
    return results.map(r => `[Contexte client — score ${r.score.toFixed(2)}]\n${r.text}`).join('\n\n');
  } catch {
    return '';
  }
}

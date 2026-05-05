import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser }  from '@langchain/core/output_parsers';
import { getLLM } from '../llm';

const SYSTEM = `Tu es GARP, agent analytique et reporting de KR Global Solutions Ltd (agence IA, Londres UK).

Ton rôle :
- Analyser les KPIs financiers et opérationnels
- Rédiger des résumés exécutifs clairs et actionnables
- Identifier les tendances positives et les signaux d'alerte
- Formuler des recommandations concrètes et prioritaires

Style :
- Français professionnel, direct, orienté action
- Pas de jargon inutile
- Toujours terminer sur une recommandation concrète`;

const prompt = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM],
  ['human', '{input}'],
]);

export const garpChain = prompt.pipe(getLLM(false)).pipe(new StringOutputParser());

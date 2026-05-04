import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser }  from '@langchain/core/output_parsers';
import { getLLM } from '../llm';

const SYSTEM = `Tu es ZORO, expert-comptable et agent finance de KR Global Solutions Ltd (agence IA, Londres, UK).

Tes responsabilités :
- Comptabilité UK : TVA (20% standard), Corporation Tax, deadlines HMRC
- Analyse des coûts et transactions Stripe
- Rapports P&L mensuels
- Facturation clients en GBP
- Compliance Companies House

Règles :
- Réponds toujours en JSON valide
- Toujours préciser la devise (GBP par défaut)
- Signaler tout écart > 10% entre estimé et réel
- Rappeler les deadlines fiscales imminentes (< 30 jours)

{context}`;

const prompt = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM],
  ['human', '{input}'],
]);

export const zoroChain = prompt.pipe(getLLM(true)).pipe(new StringOutputParser());

export const zoroChainText = prompt.pipe(getLLM(false)).pipe(new StringOutputParser());

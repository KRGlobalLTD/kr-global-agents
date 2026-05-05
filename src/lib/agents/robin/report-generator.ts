import { createClient } from '@supabase/supabase-js';
import { robinChain }   from '@/lib/langchain/chains/robin-chain';
import { researchAITrends } from './web-researcher';
import { trackCompetitors, compareWithKRGlobal } from './competitor-tracker';
import { indexResearchResults, searchKnowledge } from './knowledge-builder';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface IntelReport {
  week:             string;
  trends_count:     number;
  competitors_analyzed: number;
  knowledge_indexed:    number;
  narrative:            string;
  competitor_analysis:  string;
  top_opportunities:    string[];
  slack_sent:           boolean;
}

async function postSlack(text: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK;
  if (!webhook) return;
  await fetch(webhook, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text, username: 'ROBIN', icon_emoji: ':mag:' }),
  }).catch(() => undefined);
}

export async function generateIntelReport(): Promise<IntelReport> {
  const week = new Date().toISOString().slice(0, 10);

  // 1. Collect data in parallel
  const [trends, competitors] = await Promise.all([
    researchAITrends(),
    trackCompetitors(),
  ]);

  // 2. Index all research into Qdrant
  const indexed = await indexResearchResults(
    trends.map(t => ({ title: t.title, snippet: t.snippet, url: t.url, source: t.source })),
    'ai_trends_weekly',
  );

  // 3. Competitor analysis text
  const competitorAnalysis = compareWithKRGlobal(competitors);

  // 4. Find top opportunities via knowledge search
  const opportunities = await searchKnowledge('AI agency business opportunity UK SMB', 3);
  const topOpportunities = opportunities.map(o => o.content.slice(0, 150));

  // 5. LLM narrative
  const prompt =
    `Génère un rapport de veille stratégique hebdomadaire pour KR Global Solutions Ltd (agence IA, Londres).\n\n` +
    `Données collectées :\n` +
    `- ${trends.length} tendances IA analysées (Google, Reddit, Twitter)\n` +
    `- ${competitors.length} concurrents UK surveillés\n` +
    `- Top sources : ${[...new Set(trends.slice(0, 5).map(t => t.source))].join(', ')}\n\n` +
    `Analyse concurrentielle :\n${competitorAnalysis.slice(0, 800)}\n\n` +
    `Opportunités détectées :\n${topOpportunities.join('\n')}\n\n` +
    `Rédige un rapport exécutif de 4-5 phrases avec : 1 tendance clé, 1 menace concurrentielle, 2 actions recommandées pour KR Global.`;

  const narrative = await robinChain.invoke({ input: prompt }).catch(
    () => `Rapport veille semaine ${week} : ${trends.length} tendances analysées, ${competitors.length} concurrents surveillés.`,
  );

  // 6. Save report to Supabase
  await supabase.from('research_insights').insert({
    source:          'ROBIN_WEEKLY_REPORT',
    topic:           `weekly_report:${week}`,
    content:         narrative,
    relevance_score: 1.0,
    tags:            ['weekly_report', 'executive', week],
  });

  // 7. Send to Slack #general
  const slackText = [
    `:mag: *ROBIN — Rapport de veille hebdomadaire* (${week})`,
    ``,
    narrative,
    ``,
    `*Stats :*`,
    `• ${trends.length} tendances analysées | ${competitors.length} concurrents | ${indexed} insights indexés`,
    topOpportunities.length > 0 ? `• Opportunité : _${topOpportunities[0].slice(0, 120)}_` : '',
  ].filter(Boolean).join('\n');

  await postSlack(slackText);

  await supabase.from('alerts').insert({
    agent_name: 'ROBIN',
    level:      'INFO',
    message:    `Rapport veille ${week} généré — ${trends.length} tendances, ${indexed} indexés`,
  });

  return {
    week,
    trends_count:         trends.length,
    competitors_analyzed: competitors.length,
    knowledge_indexed:    indexed,
    narrative,
    competitor_analysis:  competitorAnalysis,
    top_opportunities:    topOpportunities,
    slack_sent:           !!process.env.SLACK_WEBHOOK,
  };
}

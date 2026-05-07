import { HumanMessage, AIMessage }              from '@langchain/core/messages';
import { createClient }                          from '@supabase/supabase-js';
import { type KRGlobalStateType }                from '../state';
import { nejiChain, nejiChainJson }              from '@/lib/langchain/chains/neji-chain';
import { analyzeContentPerformance, type Period } from '@/lib/agents/neji/content-analytics';
import { analyzeConversionFunnel }               from '@/lib/agents/neji/conversion-funnel';
import { auditURL, getRecentAudits }             from '@/lib/agents/neji/seo-auditor';
import { trackGrowth }                           from '@/lib/agents/neji/growth-tracker';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type NejiAction =
  | 'get_dashboard'
  | 'analyze_content'
  | 'conversion_funnel'
  | 'seo_audit'
  | 'growth_metrics'
  | 'generate_report'
  | 'get_seo_audits';

export async function nejiNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as NejiAction) ?? 'get_dashboard';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`NEJI action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {

      case 'get_dashboard': {
        const period = ((input['period'] as string) ?? 'month') as Period;

        const [content, funnel, growth] = await Promise.all([
          analyzeContentPerformance(period),
          analyzeConversionFunnel(period),
          trackGrowth(period),
        ]);

        const analysis = await nejiChain.invoke({
          context: '',
          input: `Génère un résumé exécutif du tableau de bord analytics KR Global (${period}) :
Contenu : ${JSON.stringify({ total_published: content.total_published, total_views: content.total_views, avg_engagement_rate: content.avg_engagement_rate, by_type: content.by_type })}
Funnel : ${JSON.stringify({ overall_conversion: funnel.overall_conversion, clients: funnel.stages.at(-1)?.count, total_revenue: funnel.total_revenue })}
Croissance : highlights=${JSON.stringify(growth.highlights)}, alerts=${JSON.stringify(growth.alerts)}
Donne 3 recommandations actionnables priorisées.`,
        });

        result = { period, content, funnel, growth, analysis };
        break;
      }

      case 'analyze_content': {
        const period = ((input['period'] as string) ?? 'month') as Period;
        const data   = await analyzeContentPerformance(period);

        const analysis = await nejiChainJson.invoke({
          context: '',
          input: `Analyse ces performances de contenu et génère des recommandations. Données : ${JSON.stringify(data)}. JSON : {"top_platform": "...", "best_performing_content": "...", "recommendations": [], "quick_wins": []}`,
        });

        result = { data, analysis };
        break;
      }

      case 'conversion_funnel': {
        const period = ((input['period'] as string) ?? 'month') as Period;
        const funnel = await analyzeConversionFunnel(period);

        const analysis = await nejiChain.invoke({
          context: '',
          input: `Analyse cet entonnoir de conversion KR Global et identifie les goulots d'étranglement : ${JSON.stringify(funnel)}. Donne des suggestions concrètes pour améliorer chaque étape.`,
        });

        result = { funnel, analysis };
        break;
      }

      case 'seo_audit': {
        const url      = (input['url']      as string | undefined) ?? '';
        const keywords = (input['keywords'] as string[] | undefined) ?? [];
        if (!url) throw new Error('url requise pour seo_audit');

        const audit = await auditURL(url, keywords);

        const analysis = await nejiChain.invoke({
          context: '',
          input: `Analyse cet audit SEO et explique les priorités d'amélioration : score=${audit.score}/100, problèmes=${JSON.stringify(audit.issues.slice(0, 8))}. Donne un plan d'action en 3 étapes.`,
        });

        result = { audit, analysis };
        break;
      }

      case 'growth_metrics': {
        const period = ((input['period'] as string) ?? 'month') as Period;
        const growth = await trackGrowth(period);

        const analysis = await nejiChainJson.invoke({
          context: '',
          input: `Analyse ces métriques de croissance et génère un rapport. Données : ${JSON.stringify(growth)}. JSON : {"overall_trend": "positive|negative|neutral", "key_driver": "...", "main_risk": "...", "action_required": []}`,
        });

        result = { growth, analysis };
        break;
      }

      case 'generate_report': {
        const period = ((input['period'] as string) ?? 'month') as Period;

        const [content, funnel, growth] = await Promise.all([
          analyzeContentPerformance(period),
          analyzeConversionFunnel(period),
          trackGrowth(period),
        ]);

        const report = await nejiChain.invoke({
          context: '',
          input: `Génère un rapport analytics complet pour KR Global Solutions Ltd (période: ${period}).

PERFORMANCES CONTENU :
- Publiés : ${content.total_published} | Vues : ${content.total_views} | Clics : ${content.total_clicks} | Conversions : ${content.total_conversions}
- Engagement moyen : ${content.avg_engagement_rate}%
- Par type : ${JSON.stringify(content.by_type)}

ENTONNOIR CONVERSION :
${content.total_published > 0 ? funnel.stages.map(s => `- ${s.name}: ${s.count} (${s.conversion}%)`).join('\n') : '- Pas de données suffisantes'}
- Revenu total : ${funnel.total_revenue}€ | Valeur client moyenne : ${funnel.avg_deal_value}€

CROISSANCE ${period.toUpperCase()} :
${growth.metrics.map(m => `- ${m.metric}: ${m.current} (${m.delta_pct > 0 ? '+' : ''}${m.delta_pct}%)`).join('\n')}

Génère un rapport structuré avec : résumé exécutif, performances clés, points d'amélioration prioritaires, objectifs pour la prochaine période.`,
        });

        // Sauvegarde le rapport
        await supabase.from('analytics_reports').insert({
          period,
          report_type: period === 'week' ? 'weekly' : 'monthly',
          data: { content, funnel, growth },
          summary: report.slice(0, 500),
        });

        result = { period, report, content, funnel, growth };
        break;
      }

      case 'get_seo_audits': {
        const limit  = (input['limit'] as number | undefined) ?? 10;
        const audits = await getRecentAudits(limit);
        result = { audits, count: audits.length };
        break;
      }

      default: {
        const reasoning = await nejiChain.invoke({ context: '', input: `Tâche NEJI : ${JSON.stringify(input)}` });
        result = { reasoning };
      }
    }

    return {
      agent_name:  'NEJI',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, new AIMessage(`NEJI completed action=${action}`)],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur NEJI inconnue';
    await supabase.from('alerts').insert({ agent_name: 'NEJI', level: 'WARNING', message: message.slice(0, 200) });
    return {
      agent_name: 'NEJI',
      status:     'failed',
      error:      message,
      messages:   [userMsg, new AIMessage(`NEJI error: ${message}`)],
    };
  }
}

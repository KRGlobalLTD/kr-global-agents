import { NextRequest, NextResponse } from 'next/server';
import { analyzeContentPerformance, type Period } from '@/lib/agents/neji/content-analytics';
import { analyzeConversionFunnel }                from '@/lib/agents/neji/conversion-funnel';
import { auditURL, getRecentAudits }              from '@/lib/agents/neji/seo-auditor';
import { trackGrowth }                            from '@/lib/agents/neji/growth-tracker';
import { createClient }                           from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const action = (body['action'] as string) ?? '';

  try {
    switch (action) {

      case 'get_dashboard': {
        const period = ((body['period'] as string) ?? 'month') as Period;
        const [content, funnel, growth] = await Promise.all([
          analyzeContentPerformance(period),
          analyzeConversionFunnel(period),
          trackGrowth(period),
        ]);
        return NextResponse.json({ agent_name: 'NEJI', period, content, funnel, growth });
      }

      case 'analyze_content': {
        const period = ((body['period'] as string) ?? 'month') as Period;
        const data   = await analyzeContentPerformance(period);
        return NextResponse.json({ agent_name: 'NEJI', period, data });
      }

      case 'conversion_funnel': {
        const period = ((body['period'] as string) ?? 'month') as Period;
        const funnel = await analyzeConversionFunnel(period);
        return NextResponse.json({ agent_name: 'NEJI', funnel });
      }

      case 'seo_audit': {
        const url      = body['url']      as string | undefined;
        const keywords = (body['keywords'] as string[] | undefined) ?? [];
        if (!url) return NextResponse.json({ error: 'url requise' }, { status: 400 });
        const audit = await auditURL(url, keywords);
        return NextResponse.json({ agent_name: 'NEJI', audit });
      }

      case 'growth_metrics': {
        const period = ((body['period'] as string) ?? 'month') as Period;
        const growth = await trackGrowth(period);
        return NextResponse.json({ agent_name: 'NEJI', growth });
      }

      case 'generate_report': {
        const period = ((body['period'] as string) ?? 'month') as Period;
        const [content, funnel, growth] = await Promise.all([
          analyzeContentPerformance(period),
          analyzeConversionFunnel(period),
          trackGrowth(period),
        ]);
        await supabase.from('analytics_reports').insert({
          period,
          report_type: period === 'week' ? 'weekly' : 'monthly',
          data:        { content, funnel, growth },
          summary:     `Rapport ${period} — ${content.total_published} contenus, ${funnel.stages.at(-1)?.count ?? 0} clients, ${funnel.total_revenue}€`,
        });
        return NextResponse.json({ agent_name: 'NEJI', period, content, funnel, growth, saved: true });
      }

      case 'get_seo_audits': {
        const limit  = (body['limit'] as number | undefined) ?? 10;
        const audits = await getRecentAudits(limit);
        return NextResponse.json({ agent_name: 'NEJI', audits, count: audits.length });
      }

      default:
        return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur NEJI inconnue';
    void supabase.from('alerts').insert({
      agent_name: 'NEJI',
      level:      'WARNING',
      message:    `API error action=${action} : ${message.slice(0, 200)}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const type   = searchParams.get('type')   ?? 'dashboard';
  const period = ((searchParams.get('period') ?? 'month') as Period);

  try {
    if (type === 'seo') {
      const limit  = parseInt(searchParams.get('limit') ?? '10', 10);
      const audits = await getRecentAudits(limit);
      return NextResponse.json({ agent_name: 'NEJI', audits, count: audits.length });
    }

    if (type === 'content') {
      const data = await analyzeContentPerformance(period);
      return NextResponse.json({ agent_name: 'NEJI', data });
    }

    if (type === 'funnel') {
      const funnel = await analyzeConversionFunnel(period);
      return NextResponse.json({ agent_name: 'NEJI', funnel });
    }

    if (type === 'growth') {
      const growth = await trackGrowth(period);
      return NextResponse.json({ agent_name: 'NEJI', growth });
    }

    // Default: full dashboard
    const [content, funnel, growth] = await Promise.all([
      analyzeContentPerformance(period),
      analyzeConversionFunnel(period),
      trackGrowth(period),
    ]);
    return NextResponse.json({ agent_name: 'NEJI', period, content, funnel, growth });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur lecture';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { calculateKPIs } from '@/lib/agents/garp/kpi-calculator';
import { buildReport }   from '@/lib/agents/garp/report-builder';
import { sendReport, sendKpiAlert } from '@/lib/agents/garp/slack-reporter';
import { createClient }  from '@supabase/supabase-js';
import type { KPIPeriod } from '@/lib/agents/garp/kpi-calculator';

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
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 });
  }

  const action = body['action'] as string;

  try {
    // ── generate_report ────────────────────────────────────────────────────────
    if (action === 'generate_report') {
      const period     = (body['period'] as KPIPeriod | undefined) ?? 'daily';
      const sendSlack  = body['send_slack'] !== false;

      const kpis   = await calculateKPIs(period);
      const report = await buildReport(kpis, period);

      if (sendSlack) {
        await sendReport(report);
        await supabase
          .from('garp_reports')
          .update({ slack_sent: true })
          .eq('id', report.id ?? '');
      }

      if (kpis.marge_pct < 0) {
        await sendKpiAlert(`Marge nette NEGATIVE : ${kpis.marge_nette.toFixed(2)}€ (${kpis.marge_pct.toFixed(1)}%)`);
      }
      if (kpis.taux_succes < 80) {
        await sendKpiAlert(`Taux de succès agents bas : ${kpis.taux_succes.toFixed(1)}% (seuil : 80%)`);
      }

      return NextResponse.json({
        report_id:  report.id,
        period,
        kpis,
        narrative:  report.narrative,
        slack_sent: sendSlack,
      });
    }

    // ── get_kpis ───────────────────────────────────────────────────────────────
    if (action === 'get_kpis') {
      const period = (body['period'] as KPIPeriod | undefined) ?? 'daily';
      const kpis   = await calculateKPIs(period);
      return NextResponse.json({ kpis });
    }

    // ── send_alert ─────────────────────────────────────────────────────────────
    if (action === 'send_alert') {
      const message = body['message'] as string | undefined;
      if (!message) {
        return NextResponse.json({ error: 'message requis' }, { status: 400 });
      }
      await sendKpiAlert(message);
      return NextResponse.json({ sent: true });
    }

    // ── get_reports ────────────────────────────────────────────────────────────
    if (action === 'get_reports') {
      const period = body['period'] as KPIPeriod | undefined;
      const limit  = Math.min((body['limit'] as number | undefined) ?? 10, 50);

      let query = supabase
        .from('garp_reports')
        .select('id, period, period_start, period_end, narrative, slack_sent, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (period) query = query.eq('period', period);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return NextResponse.json({ reports: data ?? [] });
    }

    return NextResponse.json(
      { error: `Action inconnue : ${action}. Valeurs acceptées : generate_report, get_kpis, send_alert, get_reports` },
      { status: 400 },
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    await supabase.from('alerts').insert({
      agent_name: 'GARP',
      level:      'WARNING',
      message:    `Erreur API action=${action} : ${message}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') as KPIPeriod | null;
  const limit  = Math.min(parseInt(searchParams.get('limit') ?? '10', 10), 50);

  let query = supabase
    .from('garp_reports')
    .select('id, period, period_start, period_end, narrative, slack_sent, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (period) query = query.eq('period', period);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ reports: data ?? [] });
}

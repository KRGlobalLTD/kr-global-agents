import { NextRequest, NextResponse }  from 'next/server';
import { buildExecutiveDashboard }   from '@/lib/agents/madara/executive-dashboard';
import { exportXeroInvoices,
         exportQuickBooksIIF,
         exportOdooJSON }            from '@/lib/agents/madara/erp-exporter';
import { generateBoardReport,
         getReportHistory }          from '@/lib/agents/madara/board-reporter';
import { forecastRevenue }           from '@/lib/agents/madara/forecaster';

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const action = (body['action'] as string) ?? '';

  try {
    switch (action) {

      case 'get_dashboard': {
        const kpis = await buildExecutiveDashboard(body['period'] as string | undefined);
        return NextResponse.json({ agent_name: 'MADARA', kpis });
      }

      case 'generate_report': {
        const kpis   = await buildExecutiveDashboard(body['period'] as string | undefined);
        const report = await generateBoardReport(kpis);
        return NextResponse.json({ agent_name: 'MADARA', report_id: report.report_id, kpis, narrative: report.narrative });
      }

      case 'get_history': {
        const reports = await getReportHistory((body['limit'] as number) ?? 12);
        return NextResponse.json({ agent_name: 'MADARA', reports, count: reports.length });
      }

      case 'export_xero': {
        const csv = await exportXeroInvoices(body['month'] as string | undefined);
        return NextResponse.json({ agent_name: 'MADARA', format: 'xero_csv', rows: csv.split('\n').length - 2, csv });
      }

      case 'export_quickbooks': {
        const iif = await exportQuickBooksIIF(body['month'] as string | undefined);
        return NextResponse.json({ agent_name: 'MADARA', format: 'quickbooks_iif', iif });
      }

      case 'export_odoo': {
        const records = await exportOdooJSON(body['month'] as string | undefined);
        return NextResponse.json({ agent_name: 'MADARA', format: 'odoo_json', records, count: records.length });
      }

      case 'forecast': {
        const forecast = await forecastRevenue((body['months'] as number) ?? 12);
        return NextResponse.json({ agent_name: 'MADARA', forecast });
      }

      default:
        return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });
    }

  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const url  = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'dashboard';

  try {
    if (type === 'dashboard') {
      const kpis = await buildExecutiveDashboard(url.searchParams.get('period') ?? undefined);
      return NextResponse.json({ agent_name: 'MADARA', kpis });
    }
    if (type === 'forecast') {
      const months   = parseInt(url.searchParams.get('months') ?? '12');
      const forecast = await forecastRevenue(months);
      return NextResponse.json({ agent_name: 'MADARA', forecast });
    }
    if (type === 'history') {
      const reports = await getReportHistory(parseInt(url.searchParams.get('limit') ?? '12'));
      return NextResponse.json({ agent_name: 'MADARA', reports, count: reports.length });
    }
    return NextResponse.json({ error: `Type inconnu : ${type}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

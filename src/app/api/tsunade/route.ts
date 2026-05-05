import { NextRequest, NextResponse } from 'next/server';
import { validateExpense, decideExpense, getPendingExpenses } from '@/lib/agents/tsunade/expense-validator';
import { calculateDividends, approveDividends, markDividendsPaid } from '@/lib/agents/tsunade/dividend-calculator';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}

export async function POST(req: NextRequest) {
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

      case 'validate_expense': {
        const description = body['description'] as string | undefined;
        const amount      = body['amount']      as number | undefined;
        if (!description || amount === undefined) {
          return NextResponse.json({ error: 'description et amount requis' }, { status: 400 });
        }
        const result = await validateExpense({
          description,
          amount,
          currency:    (body['currency']     as string) ?? 'EUR',
          category:    (body['category']     as string) ?? 'SAAS',
          requestedBy: (body['requested_by'] as string) ?? 'SYSTEM',
        });
        return NextResponse.json({ agent_name: 'TSUNADE', ...result });
      }

      case 'approve_expense': {
        const validationId = body['validation_id'] as string | undefined;
        if (!validationId) return NextResponse.json({ error: 'validation_id requis' }, { status: 400 });
        await decideExpense(
          validationId,
          (body['approved']    as boolean) ?? true,
          (body['approved_by'] as string)  ?? 'KARIM',
          body['reason']       as string | undefined
        );
        return NextResponse.json({ agent_name: 'TSUNADE', decided: true, validationId });
      }

      case 'get_pending': {
        const pending = await getPendingExpenses();
        return NextResponse.json({ agent_name: 'TSUNADE', pending, count: pending.length });
      }

      case 'calculate_dividends': {
        const now     = new Date();
        const quarter = ((body['quarter'] as number) ?? Math.ceil((now.getMonth() + 1) / 3)) as 1 | 2 | 3 | 4;
        const year    = (body['year'] as number) ?? now.getFullYear();
        const result  = await calculateDividends(quarter, year);
        return NextResponse.json({ agent_name: 'TSUNADE', ...result });
      }

      case 'approve_dividends': {
        const calculationId = body['calculation_id'] as string | undefined;
        if (!calculationId) return NextResponse.json({ error: 'calculation_id requis' }, { status: 400 });
        await approveDividends(calculationId);
        return NextResponse.json({ agent_name: 'TSUNADE', approved: true, calculationId });
      }

      case 'mark_paid': {
        const calculationId = body['calculation_id'] as string | undefined;
        if (!calculationId) return NextResponse.json({ error: 'calculation_id requis' }, { status: 400 });
        await markDividendsPaid(calculationId, body['notes'] as string | undefined);
        return NextResponse.json({ agent_name: 'TSUNADE', paid: true, calculationId });
      }

      default:
        return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur TSUNADE inconnue';
    void supabase.from('alerts').insert({
      agent_name: 'TSUNADE',
      level:      'WARNING',
      message:    `API error action=${action} : ${message.slice(0, 200)}`,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!verifyInternalToken(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') ?? 'pending';

  try {
    if (type === 'dividends') {
      const { data, error } = await supabase
        .from('dividend_calculations')
        .select('*')
        .order('year', { ascending: false })
        .order('quarter', { ascending: false })
        .limit(8);
      if (error) throw new Error(error.message);
      return NextResponse.json({ agent_name: 'TSUNADE', dividends: data ?? [] });
    }

    const pending = await getPendingExpenses();
    return NextResponse.json({ agent_name: 'TSUNADE', pending, count: pending.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur lecture';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

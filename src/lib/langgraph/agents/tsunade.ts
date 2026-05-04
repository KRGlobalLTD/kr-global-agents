import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { type KRGlobalStateType } from '../state';
import { tsunadeChain, tsunadeChainJson } from '@/lib/langchain/chains/tsunade-chain';
import { validateExpense, decideExpense, getPendingExpenses, type ExpenseRequest } from '@/lib/agents/tsunade/expense-validator';
import { calculateDividends, approveDividends, markDividendsPaid }                 from '@/lib/agents/tsunade/dividend-calculator';

type TsunadeAction =
  | 'validate_expense'
  | 'decide_expense'
  | 'get_pending'
  | 'calculate_dividends'
  | 'approve_dividends'
  | 'mark_paid'
  | 'analyze_expenses';

export async function tsunadeNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = (state.task_input['action'] as TsunadeAction) ?? 'get_pending';
  const input  = state.task_input;

  const userMsg = new HumanMessage(`TSUNADE action=${action} input=${JSON.stringify(input)}`);

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case 'validate_expense': {
        const req: ExpenseRequest = {
          description:  (input['description']   as string) ?? '',
          amount:       (input['amount']         as number) ?? 0,
          currency:     (input['currency']       as string) ?? 'EUR',
          category:     (input['category']       as string) ?? 'SAAS',
          requestedBy:  (input['requested_by']   as string) ?? 'SYSTEM',
        };
        if (!req.description) throw new Error('description requise');

        const validation = await validateExpense(req);

        const analysis = await tsunadeChainJson.invoke({
          context: '',
          input:   `Dépense validée : ${JSON.stringify(validation)}. Donne une recommandation courte sur cette décision et des risques éventuels. JSON : {"recommendation": "...", "risk_level": "low|medium|high"}`,
        });

        result = { validation, analysis };
        break;
      }

      case 'decide_expense': {
        const validationId = (input['validation_id'] as string) ?? '';
        const approved     = (input['approved']      as boolean) ?? false;
        const approvedBy   = (input['approved_by']   as string) ?? 'KARIM';
        const reason       = (input['reason']        as string | undefined);

        if (!validationId) throw new Error('validation_id requis');

        await decideExpense(validationId, approved, approvedBy, reason);
        result = { decided: true, validationId, approved, approvedBy };
        break;
      }

      case 'get_pending': {
        const pending = await getPendingExpenses();

        const summary = pending.length > 0
          ? await tsunadeChain.invoke({
              context: '',
              input:   `Résume ces ${pending.length} dépenses en attente et priorise celles à approuver en urgence : ${JSON.stringify(pending.slice(0, 10))}`,
            })
          : 'Aucune dépense en attente.';

        result = { pending, count: pending.length, summary };
        break;
      }

      case 'calculate_dividends': {
        const now     = new Date();
        const quarter = ((input['quarter'] as number) ?? Math.ceil((now.getMonth() + 1) / 3)) as 1 | 2 | 3 | 4;
        const year    = (input['year']    as number) ?? now.getFullYear();

        const divResult = await calculateDividends(quarter, year);

        const analysis = await tsunadeChain.invoke({
          context: '',
          input:   `Explique ce calcul de dividendes Q${quarter} ${year} en langage simple pour Karim et Raphaël : ${JSON.stringify(divResult.calculation)}`,
        });

        result = {
          calculation:  divResult.calculation,
          distributable: divResult.distributable,
          slack_sent:   divResult.slackAlertSent,
          analysis,
        };
        break;
      }

      case 'approve_dividends': {
        const calculationId = (input['calculation_id'] as string) ?? '';
        if (!calculationId) throw new Error('calculation_id requis');

        await approveDividends(calculationId);
        result = { approved: true, calculationId };
        break;
      }

      case 'mark_paid': {
        const calculationId = (input['calculation_id'] as string) ?? '';
        const notes         = (input['notes']          as string | undefined);
        if (!calculationId) throw new Error('calculation_id requis');

        await markDividendsPaid(calculationId, notes);
        result = { paid: true, calculationId, notes };
        break;
      }

      case 'analyze_expenses': {
        const pending = await getPendingExpenses();
        const analysis = await tsunadeChainJson.invoke({
          context: '',
          input:   `Analyse les dépenses en attente et génère un rapport de risque. Données : ${JSON.stringify(pending)}. JSON : {"total_pending": 0, "high_risk_count": 0, "recommendations": [], "urgent_action_required": false}`,
        });
        result = { analysis };
        break;
      }

      default: {
        const reasoning = await tsunadeChain.invoke({
          context: '',
          input:   `Tâche TSUNADE : ${JSON.stringify(input)}`,
        });
        result = { reasoning };
      }
    }

    return {
      agent_name:  'TSUNADE',
      status:      'completed',
      task_result: result,
      error:       null,
      messages:    [userMsg, new AIMessage(`TSUNADE completed action=${action}`)],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur TSUNADE inconnue';
    return {
      agent_name: 'TSUNADE',
      status:     'failed',
      error:      message,
      messages:   [userMsg, new AIMessage(`TSUNADE error: ${message}`)],
    };
  }
}

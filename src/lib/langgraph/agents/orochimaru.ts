import { createClient }       from '@supabase/supabase-js';
import { runHealthCheck }     from '@/lib/agents/orochimaru/health-checker';
import { runBackup }          from '@/lib/agents/orochimaru/backup-orchestrator';
import { validateSecrets }    from '@/lib/agents/orochimaru/secret-validator';
import {
  sendHealthAlert,
  sendDailyHealthReport,
  sendSecretAlert,
  logInfrastructure,
} from '@/lib/agents/orochimaru/alert-manager';
import { orochimaruChain }    from '@/lib/langchain/chains/orochimaru-chain';
import type { KRGlobalStateType } from '../state';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function log(level: string, message: string): Promise<void> {
  await supabase.from('alerts').insert({ agent_name: 'OROCHIMARU', level, message });
}

export async function orochimaruNode(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = state.task_input['action'] as string;

  try {
    // ── health_check ───────────────────────────────────────────────────────────
    if (action === 'health_check') {
      const report = await runHealthCheck();

      // Log chaque service dans infrastructure_logs
      for (const r of report.results) {
        await logInfrastructure(r.tool, r.status, r.responseTimeMs, r.error);
      }

      if (report.criticalDown.length > 0) {
        await sendHealthAlert(report);
      }

      await log(
        report.allUp ? 'INFO' : 'URGENT',
        `Health check : ${report.results.filter(r => r.status === 'up').length}/${report.results.length} UP` +
          (report.criticalDown.length > 0 ? ` — DOWN : ${report.criticalDown.join(', ')}` : ''),
      );

      return {
        agent_name:  'OROCHIMARU',
        status:      'completed',
        task_result: { report },
        error:       null,
      };
    }

    // ── validate_secrets ───────────────────────────────────────────────────────
    if (action === 'validate_secrets') {
      const result = await validateSecrets();

      if (!result.allPresent) {
        await sendSecretAlert(result);
        await log('URGENT', `Secrets manquants : ${result.missing.join(', ')}`);
      } else {
        await log('INFO', `Secrets validés : ${result.present.length} présents`);
      }

      return {
        agent_name:  'OROCHIMARU',
        status:      'completed',
        task_result: { secrets: result },
        error:       null,
      };
    }

    // ── generate_health_report ─────────────────────────────────────────────────
    if (action === 'generate_health_report') {
      const [healthReport, secretResult] = await Promise.all([
        runHealthCheck(),
        Promise.resolve(validateSecrets()),
      ]);

      const down     = healthReport.results.filter(r => r.status !== 'up');
      const prompt   =
        `Analyse ce rapport d'infrastructure de KR Global Solutions Ltd et génère un résumé exécutif.\n\n` +
        `Services vérifiés : ${healthReport.results.length}\n` +
        `Services UP : ${healthReport.results.filter(r => r.status === 'up').length}\n` +
        `Services DOWN/Dégradés : ${down.map(r => `${r.tool}(${r.status})`).join(', ') || 'aucun'}\n` +
        `Secrets manquants : ${secretResult.missing.join(', ') || 'aucun'}\n\n` +
        `Identifie les risques, recommande des actions correctives prioritaires.`;

      const narrative = await orochimaruChain.invoke({ input: prompt }).catch(
        () => `Infrastructure : ${healthReport.results.filter(r => r.status === 'up').length}/${healthReport.results.length} services UP.`,
      );

      // Rapport quotidien → Slack #general
      await sendDailyHealthReport(healthReport);
      if (healthReport.criticalDown.length > 0) await sendHealthAlert(healthReport);
      if (!secretResult.allPresent) await sendSecretAlert(secretResult);

      await log('INFO', `Rapport santé généré — narrative LLM envoyée`);

      return {
        agent_name:  'OROCHIMARU',
        status:      'completed',
        task_result: { health: healthReport, secrets: secretResult, narrative },
        error:       null,
      };
    }

    // ── backup ─────────────────────────────────────────────────────────────────
    if (action === 'backup') {
      const result = await runBackup();
      return {
        agent_name:  'OROCHIMARU',
        status:      result.success ? 'completed' : 'failed',
        task_result: { backup: result },
        error:       result.success ? null : (result.error ?? 'Backup échoué'),
      };
    }

    // ── send_alert ─────────────────────────────────────────────────────────────
    if (action === 'send_alert') {
      const message = state.task_input['message'] as string | undefined;
      if (!message) throw new Error('message requis pour send_alert');

      const webhook = process.env.SLACK_WEBHOOK_ERREURS;
      if (webhook) {
        await fetch(webhook, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ text: `:snake: *OROCHIMARU* : ${message}`, username: 'OROCHIMARU' }),
        });
      }
      await log('INFO', `Alerte envoyée : ${message}`);

      return {
        agent_name:  'OROCHIMARU',
        status:      'completed',
        task_result: { sent: true },
        error:       null,
      };
    }

    throw new Error(`Action inconnue : ${action}`);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log('WARNING', `Erreur OROCHIMARU action=${action} : ${message}`);

    return {
      agent_name: 'OROCHIMARU',
      status:     'failed',
      error:      message,
    };
  }
}

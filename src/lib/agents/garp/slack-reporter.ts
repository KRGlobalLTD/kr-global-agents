import type { GarpReport } from './report-builder';

async function post(webhook: string, payload: object): Promise<void> {
  await fetch(webhook, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
}

export async function sendReport(report: GarpReport): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK!;

  await post(webhook, { blocks: report.slack_blocks });
}

export async function sendKpiAlert(message: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_ALERTES!;

  await post(webhook, {
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:rotating_light: *Alerte KPI GARP*\n${message}` },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_${new Date().toLocaleString('fr-FR')}_` }],
      },
    ],
  });
}

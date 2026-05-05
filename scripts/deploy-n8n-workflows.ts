#!/usr/bin/env npx tsx
/**
 * deploy-n8n-workflows.ts
 * Crée et active les 6 workflows KR Global dans n8n via l'API REST.
 *
 * Usage :
 *   doppler run --project kr-global-agents --config dev -- npx tsx scripts/deploy-n8n-workflows.ts
 */

// ── Config ────────────────────────────────────────────────────────────────────

const N8N_URL     = (process.env.N8N_URL     ?? 'https://primary-production-fbc07.up.railway.app').replace(/\/$/, '');
const N8N_API_KEY = process.env.N8N_API_KEY  ?? '';
const APP_URL     = 'https://kr-global-agents.vercel.app';
const TOKEN       = process.env.INTERNAL_API_TOKEN ?? '';

const SLACK = {
  general:   process.env.SLACK_WEBHOOK           ?? '',
  alertes:   process.env.SLACK_WEBHOOK_ALERTES   ?? '',
  revenus:   process.env.SLACK_WEBHOOK_REVENUS   ?? '',
  depenses:  process.env.SLACK_WEBHOOK_DEPENSES  ?? '',
  erreurs:   process.env.SLACK_WEBHOOK_ERREURS   ?? '',
  prospects: process.env.SLACK_WEBHOOK_PROSPECTS ?? '',
  contenu:   process.env.SLACK_WEBHOOK_CONTENU   ?? '',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface N8nNode {
  id:          string;
  name:        string;
  type:        string;
  typeVersion: number;
  position:    [number, number];
  parameters:  Record<string, unknown>;
  disabled?:   boolean;
}

interface N8nWorkflowPayload {
  name:        string;
  nodes:       N8nNode[];
  connections: Record<string, unknown>;
  settings:    Record<string, unknown>;
}

interface N8nCreatedWorkflow {
  id:   string;
  name: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function n8nRequest<T>(
  method: string,
  path:   string,
  body?:  unknown,
): Promise<T> {
  const res = await fetch(`${N8N_URL}/api/v1${path}`, {
    method,
    headers: {
      'X-N8N-API-KEY': N8N_API_KEY,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`n8n ${method} ${path} → ${res.status}: ${text}`);

  return JSON.parse(text) as T;
}

// ── Node builders ─────────────────────────────────────────────────────────────

let _id = 1;
const uid = () => String(_id++).padStart(2, '0');

function scheduleTrigger(
  hour: number,
  minute = 0,
  everyMinutes?: number,
): N8nNode {
  const interval = everyMinutes
    ? [{ field: 'minutes', minutesInterval: everyMinutes }]
    : [{ field: 'days', triggerAtHour: hour, triggerAtMinute: minute }];

  return {
    id:          uid(),
    name:        'Trigger',
    type:        'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position:    [240, 300],
    parameters:  { rule: { interval } },
  };
}

function webhookTrigger(path: string): N8nNode {
  return {
    id:          uid(),
    name:        'Trigger',
    type:        'n8n-nodes-base.webhook',
    typeVersion: 2,
    position:    [240, 300],
    parameters:  {
      path,
      httpMethod:   'POST',
      responseMode: 'lastNode',
      responseData: 'allEntries',
    },
  };
}

function agentHttpRequest(taskType: string, taskInput: Record<string, unknown>): N8nNode {
  return {
    id:          uid(),
    name:        'Call Agent',
    type:        'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position:    [480, 300],
    parameters:  {
      method:          'POST',
      url:             `${APP_URL}/api/agent`,
      sendHeaders:     true,
      headerParameters: {
        parameters: [
          { name: 'x-internal-token', value: TOKEN },
          { name: 'Content-Type',     value: 'application/json' },
        ],
      },
      sendBody:        true,
      contentType:     'raw',
      rawContentType:  'application/json',
      body:            JSON.stringify({ task_type: taskType, task_input: taskInput }),
      options:         { response: { response: { neverError: true } } },
    },
  };
}

function ifSuccess(): N8nNode {
  return {
    id:          uid(),
    name:        'Check Result',
    type:        'n8n-nodes-base.if',
    typeVersion: 2.2,
    position:    [720, 300],
    parameters:  {
      conditions: {
        options:    { caseSensitive: false, leftValue: '', typeValidation: 'loose' },
        conditions: [
          {
            id:         uid(),
            leftValue:  '={{ $json.status }}',
            rightValue: 'completed',
            operator:   { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
    },
  };
}

function slackNotify(
  nodeName: string,
  webhookUrl: string,
  successMsg: string,
  errorMsg:   string,
  isSuccess:  boolean,
): N8nNode {
  const msg   = isSuccess ? successMsg : errorMsg;
  const posX  = isSuccess ? 960 : 960;
  const posY  = isSuccess ? 200 : 400;

  return {
    id:          uid(),
    name:        nodeName,
    type:        'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position:    [posX, posY],
    parameters:  {
      method:         'POST',
      url:            webhookUrl,
      sendBody:       true,
      contentType:    'raw',
      rawContentType: 'application/json',
      body:           JSON.stringify({ text: msg }),
      options:        {},
    },
  };
}

// ── Workflow builder ──────────────────────────────────────────────────────────

function buildWorkflow(cfg: {
  name:       string;
  trigger:    N8nNode;
  taskType:   string;
  taskInput:  Record<string, unknown>;
  slackUrl:   string;
  agentLabel: string;
}): N8nWorkflowPayload {
  const trigger  = cfg.trigger;
  const callNode = agentHttpRequest(cfg.taskType, cfg.taskInput);
  const ifNode   = ifSuccess();
  const okSlack  = slackNotify(
    'Slack — Succès',
    cfg.slackUrl,
    `✅ *${cfg.agentLabel}* — Tâche complétée avec succès\nRésultat : \`={{ JSON.stringify($json.task_result) }}\``,
    '',
    true,
  );
  const errSlack = slackNotify(
    'Slack — Erreur',
    SLACK.erreurs || cfg.slackUrl,
    '',
    `❌ *${cfg.agentLabel}* — Erreur\n\`={{ $json.error ?? 'Erreur inconnue' }}\``,
    false,
  );

  const connections: Record<string, unknown> = {
    [trigger.name]:    { main: [[{ node: callNode.name, type: 'main', index: 0 }]] },
    [callNode.name]:   { main: [[{ node: ifNode.name,   type: 'main', index: 0 }]] },
    [ifNode.name]:     {
      main: [
        [{ node: okSlack.name,  type: 'main', index: 0 }],
        [{ node: errSlack.name, type: 'main', index: 0 }],
      ],
    },
  };

  return {
    name:        cfg.name,
    nodes:       [trigger, callNode, ifNode, okSlack, errSlack],
    connections,
    settings:    { executionOrder: 'v1' },
  };
}

// ── Workflow definitions ──────────────────────────────────────────────────────

const WORKFLOWS: N8nWorkflowPayload[] = [
  buildWorkflow({
    name:       'ZORO — Rapport comptable quotidien',
    trigger:    scheduleTrigger(8, 0),
    taskType:   'accounting',
    taskInput:  { action: 'generate_report' },
    slackUrl:   SLACK.depenses,
    agentLabel: 'ZORO / Rapport comptable',
  }),

  buildWorkflow({
    name:       'HASHIRAMA — Rapport quotidien superviseur',
    trigger:    scheduleTrigger(9, 0),
    taskType:   'accounting',
    taskInput:  { action: 'generate_report' },
    slackUrl:   SLACK.general,
    agentLabel: 'HASHIRAMA / Rapport quotidien',
  }),

  buildWorkflow({
    name:       'NAMI — Onboarding nouveau client',
    trigger:    webhookTrigger('nami/new-client-v2'),
    taskType:   'onboarding',
    taskInput:  { action: 'send_welcome_email' },
    slackUrl:   SLACK.revenus,
    agentLabel: 'NAMI / Onboarding',
  }),

  buildWorkflow({
    name:       'LUFFY — Surveillance inbox (15 min)',
    trigger:    scheduleTrigger(0, 0, 15),
    taskType:   'email',
    taskInput:  { action: 'process_email' },
    slackUrl:   SLACK.alertes,
    agentLabel: 'LUFFY / Inbox',
  }),

  buildWorkflow({
    name:       'KILLUA — Prospecting quotidien',
    trigger:    scheduleTrigger(10, 0),
    taskType:   'prospecting',
    taskInput:  { action: 'scrape_leads' },
    slackUrl:   SLACK.prospects,
    agentLabel: 'KILLUA / Prospecting',
  }),

  buildWorkflow({
    name:       'ITACHI — Contenu LinkedIn quotidien',
    trigger:    scheduleTrigger(7, 0),
    taskType:   'marketing',
    taskInput:  {
      action:     'generate_content',
      plateforme: 'linkedin',
      langue:     'fr',
      sujet:      'automatisation IA pour PME',
    },
    slackUrl:   SLACK.contenu,
    agentLabel: 'ITACHI / Contenu LinkedIn',
  }),

  buildWorkflow({
    name:       'ROBIN — Rapport veille hebdomadaire (lundi 06h30)',
    trigger:    scheduleTrigger(6, 30),
    taskType:   'research',
    taskInput:  { action: 'generate_report' },
    slackUrl:   SLACK.general,
    agentLabel: 'ROBIN / Rapport Veille',
  }),

  buildWorkflow({
    name:       'ROBIN — Tendances IA quotidiennes (11h00)',
    trigger:    scheduleTrigger(11, 0),
    taskType:   'research',
    taskInput:  { action: 'research_ai_trends' },
    slackUrl:   SLACK.general,
    agentLabel: 'ROBIN / Tendances IA',
  }),

  buildWorkflow({
    name:       'SANJI — Publication LinkedIn (09h00)',
    trigger:    scheduleTrigger(9, 0),
    taskType:   'social',
    taskInput:  { action: 'publish_due', platform: 'linkedin' },
    slackUrl:   SLACK.contenu,
    agentLabel: 'SANJI / LinkedIn',
  }),

  buildWorkflow({
    name:       'SANJI — Publication Twitter (12h00)',
    trigger:    scheduleTrigger(12, 0),
    taskType:   'social',
    taskInput:  { action: 'publish_due', platform: 'twitter' },
    slackUrl:   SLACK.contenu,
    agentLabel: 'SANJI / Twitter',
  }),

  buildWorkflow({
    name:       'OROCHIMARU — Health check (6h)',
    trigger:    scheduleTrigger(0, 0, 360),
    taskType:   'infrastructure',
    taskInput:  { action: 'health_check' },
    slackUrl:   SLACK.erreurs,
    agentLabel: 'OROCHIMARU / Health Check',
  }),

  buildWorkflow({
    name:       'OROCHIMARU — Rapport santé quotidien (06h00)',
    trigger:    scheduleTrigger(6, 0),
    taskType:   'infrastructure',
    taskInput:  { action: 'generate_health_report' },
    slackUrl:   SLACK.general,
    agentLabel: 'OROCHIMARU / Rapport Santé',
  }),
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 Déploiement des workflows n8n — KR Global\n');
  console.log(`   Instance : ${N8N_URL}`);
  console.log(`   App      : ${APP_URL}\n`);

  // Validation
  if (!N8N_API_KEY) {
    console.error('❌ N8N_API_KEY manquante.');
    console.error('   → Crée une clé sur : ' + N8N_URL + '/settings/api');
    console.error('   → Ajoute-la : doppler secrets set N8N_API_KEY="ta-clé" --project kr-global-agents --config dev');
    process.exit(1);
  }
  if (!TOKEN) {
    console.error('❌ INTERNAL_API_TOKEN manquant dans Doppler.');
    process.exit(1);
  }

  // Test connectivité
  console.log('🔌 Test connectivité n8n...');
  try {
    await n8nRequest<unknown>('GET', '/workflows?limit=1');
    console.log('   ✓ Connecté\n');
  } catch (err) {
    console.error(`   ✗ Impossible de se connecter : ${(err as Error).message}`);
    process.exit(1);
  }

  // Déploiement
  const results: { name: string; id: string; url: string }[] = [];

  for (const workflow of WORKFLOWS) {
    process.stdout.write(`📋 ${workflow.name}...`);

    try {
      // 1. Créer
      const created = await n8nRequest<N8nCreatedWorkflow>('POST', '/workflows', workflow);

      // 2. Activer
      await n8nRequest('POST', `/workflows/${created.id}/activate`);

      const url = `${N8N_URL}/workflow/${created.id}`;
      results.push({ name: workflow.name, id: created.id, url });
      console.log(` ✅ id=${created.id}`);
    } catch (err) {
      console.log(` ❌ ${(err as Error).message}`);
    }
  }

  // Résumé
  console.log('\n─────────────────────────────────────────────────');
  console.log(`✅ ${results.length}/${WORKFLOWS.length} workflows déployés et activés\n`);
  for (const r of results) {
    console.log(`   ${r.name}`);
    console.log(`   ${r.url}\n`);
  }

  if (results.length < WORKFLOWS.length) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n💥 Erreur fatale :', err);
  process.exit(1);
});

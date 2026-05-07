'use client';

import { useState } from 'react';
import type { AgentStat } from '@/app/api/dashboard/stats/route';
import { AgentAvatar } from './AgentAvatar';

// ── Static agent definitions ──────────────────────────────────────────────────

interface AgentDef {
  name:        string;
  role:        string;
  description: string;
  modules:     string[];
  tables:      string[];
  apis:        string[];
  actions:     string[];
  endpoint:    string;
}

const AGENT_DEFS: Record<string, AgentDef> = {
  HASHIRAMA: {
    name:        'HASHIRAMA',
    role:        'Superviseur général',
    description: 'Supervise tous les agents, génère les rapports quotidiens, évalue les dépenses selon les seuils d\'approbation et alerte en temps réel si un agent est inactif ou en erreur.',
    modules:     ['supervisor.ts', 'agent-monitor.ts', 'report-generator.ts', 'daily-report.ts', 'slack-notifier.ts'],
    tables:      ['agents_status', 'alerts', 'daily_reports'],
    apis:        ['Slack webhooks (#general, #alertes)'],
    actions:     ['daily_report', 'check_agents', 'monitor_agents', 'agent_update', 'reactivate_agent'],
    endpoint:    'POST /api/hashirama',
  },
  ZORO: {
    name:        'ZORO',
    role:        'Comptabilité UK',
    description: 'Génère les factures PDF (upload R2), synchronise les transactions Stripe, produit les rapports P&L mensuels, surveille les deadlines fiscales UK et envoie les relances paiement (email + SMS).',
    modules:     ['cost-tracker.ts', 'invoice-generator.ts', 'report-generator.ts', 'stripe-sync.ts', 'payment-reminder.ts', 'uk-deadlines.ts'],
    tables:      ['transactions', 'invoices', 'monthly_reports', 'uk_deadlines', 'couts_par_entite', 'alerts'],
    apis:        ['Stripe REST', 'Cloudflare R2 (S3 Sig v4)', 'Twilio SMS', 'Resend'],
    actions:     ['track_expense', 'sync_stripe', 'generate_report', 'get_costs', 'generate_invoice'],
    endpoint:    'POST /api/zoro',
  },
  TSUNADE: {
    name:        'TSUNADE',
    role:        'Finances avancées',
    description: 'Valide les dépenses avec seuils d\'approbation (< 50 € auto-approuvé, 50–200 € validation Slack, > 200 € bloqué). Calcule et approuve les dividendes trimestriels pour les fondateurs.',
    modules:     ['expense-validator.ts', 'dividend-calculator.ts'],
    tables:      ['expense_validations', 'dividend_calculations', 'alerts'],
    apis:        ['Slack webhooks (#depenses, #alertes)'],
    actions:     ['validate_expense', 'decide_expense', 'get_pending', 'calculate_dividends', 'approve_dividends', 'mark_paid'],
    endpoint:    'POST /api/tsunade',
  },
  NAMI: {
    name:        'NAMI',
    role:        'Onboarding clients',
    description: 'Déclenché automatiquement par webhook Stripe. Crée le client en base, envoie la séquence email d\'onboarding (J+0 bienvenue, J+1 brief projet, J+7 statut, J+30 NPS) et gère la rétention.',
    modules:     ['onboarding-flow.ts', 'email-templates.ts', 'retention-sequence.ts'],
    tables:      ['clients', 'alerts'],
    apis:        ['Stripe REST', 'Resend'],
    actions:     ['payment_confirmed', 'send_welcome_email', 'generate_contract', 'retention_cycle'],
    endpoint:    'POST /api/nami/stripe-webhook',
  },
  LUFFY: {
    name:        'LUFFY',
    role:        'Emails entrants',
    description: 'Surveille la boîte Zoho Mail en polling, classifie chaque email (prospect_chaud / prospect_froid / client / spam / autre) via LLM, répond automatiquement aux prospects et alerte sur Slack #prospects.',
    modules:     ['inbox-monitor.ts', 'email-classifier.ts', 'email-responder.ts'],
    tables:      ['prospects', 'alerts'],
    apis:        ['Zoho Mail OAuth2', 'Resend', 'OpenRouter — gemini-2.0-flash'],
    actions:     ['classify', 'monitor', 'respond'],
    endpoint:    'POST /api/luffy',
  },
  ROBIN: {
    name:        'ROBIN',
    role:        'Support client',
    description: 'Crée et gère les tickets de support entrants, rédige les réponses automatiques via LLM, escalade les tickets complexes à l\'équipe humaine et suit la résolution.',
    modules:     ['ticket-handler.ts', 'auto-responder.ts'],
    tables:      ['tickets', 'alerts'],
    apis:        ['Resend', 'OpenRouter'],
    actions:     ['create_ticket', 'respond', 'escalate', 'resolve'],
    endpoint:    'POST /api/robin',
  },
  KILLUA: {
    name:        'KILLUA',
    role:        'Prospecting B2B',
    description: 'Scrape des prospects B2B ciblés via Apollo.io (déduplication Supabase), rédige les emails de cold outreach personnalisés et gère les séquences de campagnes Instantly.ai.',
    modules:     ['prospect-finder.ts', 'email-writer.ts', 'campaign-manager.ts'],
    tables:      ['prospects', 'campaigns', 'alerts'],
    apis:        ['Apollo.io REST', 'OpenRouter (rédaction emails)', 'Instantly.ai'],
    actions:     ['find_prospects', 'run_campaign', 'create_campaign', 'send_email', 'mark_replied'],
    endpoint:    'POST /api/killua',
  },
  ITACHI: {
    name:        'ITACHI',
    role:        'Marketing & Contenu',
    description: 'Génère du contenu LinkedIn / Twitter / blog via LLM multi-modèle (gemini pour posts courts, kimi-k2 pour articles longs), planifie les publications, soumet les drafts à validation Slack #contenu et suit les performances.',
    modules:     ['content-generator.ts', 'content-scheduler.ts', 'performance-tracker.ts', 'slack-notifier.ts'],
    tables:      ['content', 'content_metrics', 'couts_par_entite', 'alerts'],
    apis:        ['OpenRouter (gemini + kimi-k2)', 'Slack webhook #contenu'],
    actions:     ['generate_content', 'schedule_post', 'approve', 'publish', 'archive', 'track_performance', 'weekly_report'],
    endpoint:    'POST /api/itachi',
  },
  SANJI: {
    name:        'SANJI',
    role:        'Réseaux sociaux',
    description: 'Publie du contenu sur LinkedIn et Instagram via leurs APIs respectives, monitore les mentions sur les réseaux sociaux et scrappe les tendances via Apify.',
    modules:     ['social-publisher.ts', 'social-monitor.ts'],
    tables:      ['social_publications', 'social_mentions', 'alerts'],
    apis:        ['LinkedIn API', 'Instagram Graph API', 'Apify (Reddit/Twitter scraping)'],
    actions:     ['publish', 'monitor'],
    endpoint:    'POST /api/sanji',
  },
  OROCHIMARU: {
    name:        'OROCHIMARU',
    role:        'Infrastructure & Health',
    description: 'Vérifie la santé de tous les services externes (OpenRouter, Supabase, Stripe, Zoho, Apollo, Resend, Twilio, Slack, R2, LinkedIn, Instagram) et orchestre les backups Supabase réguliers.',
    modules:     ['health-checker.ts', 'backup-orchestrator.ts'],
    tables:      ['tool_status', 'backups', 'alerts'],
    apis:        ['Tous les services externes (11 APIs)'],
    actions:     ['health_check', 'backup'],
    endpoint:    'POST /api/orochimaru',
  },
  CHOPPER: {
    name:        'CHOPPER',
    role:        'Freelances & Missions',
    description: 'Évalue et recrute des freelances via Upwork, gère le cycle de vie des missions (création → publication → assignation → clôture), génère et envoie les contrats NDA/mission.',
    modules:     ['freelance-evaluator.ts', 'mission-manager.ts', 'contract-generator.ts'],
    tables:      ['freelances', 'missions', 'contracts', 'alerts'],
    apis:        ['Upwork API', 'Resend (envoi contrats)'],
    actions:     ['create_mission', 'publish_mission', 'assign_freelance', 'evaluate', 'blacklist', 'generate_contract', 'sign_contract'],
    endpoint:    'POST /api/chopper',
  },
};

// ── Sectors ───────────────────────────────────────────────────────────────────

interface Sector {
  id:     string;
  label:  string;
  color:  string;
  accent: string;
  agents: string[];
}

const SECTORS: Sector[] = [
  {
    id:     'finance',
    label:  'Finance & Comptabilité',
    color:  'rgba(5,150,105,0.07)',
    accent: '#059669',
    agents: ['ZORO', 'TSUNADE'],
  },
  {
    id:     'clients',
    label:  'Relations Clients',
    color:  'rgba(37,99,235,0.07)',
    accent: '#2563eb',
    agents: ['NAMI', 'LUFFY', 'ROBIN'],
  },
  {
    id:     'commercial',
    label:  'Commercial & Marketing',
    color:  'rgba(217,119,6,0.07)',
    accent: '#d97706',
    agents: ['KILLUA', 'ITACHI', 'SANJI'],
  },
  {
    id:     'infra',
    label:  'Infrastructure & RH',
    color:  'rgba(220,38,38,0.07)',
    accent: '#dc2626',
    agents: ['OROCHIMARU', 'CHOPPER'],
  },
];

// ── Agent node ────────────────────────────────────────────────────────────────

function AgentNode({
  name,
  status,
  onClick,
}: {
  name:    string;
  status:  'active' | 'idle' | 'error';
  onClick: () => void;
}) {
  const isActive = status === 'active';
  const isError  = status === 'error';
  const def      = AGENT_DEFS[name];

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 group cursor-pointer bg-transparent border-0 p-0"
      title={def?.role ?? name}
    >
      <div className="relative">
        {isActive && (
          <span
            className="absolute rounded-full animate-ping"
            style={{ inset: '-6px', background: '#34d399', opacity: 0.25 }}
          />
        )}
        <div
          className="relative rounded-full transition-transform duration-200 group-hover:scale-110"
          style={{
            padding: '2px',
            background: isActive
              ? 'linear-gradient(135deg, #34d399, #059669)'
              : isError
              ? 'linear-gradient(135deg, #f87171, #dc2626)'
              : 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))',
          }}
        >
          <div className="rounded-full overflow-hidden flex-shrink-0" style={{ width: 40, height: 40 }}>
            <AgentAvatar name={name} size={40} />
          </div>
        </div>
        <span
          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
          style={{
            background:  isActive ? '#34d399' : isError ? '#f87171' : '#475569',
            borderColor: '#0a0a0a',
          }}
        />
      </div>

      <span className="text-[11px] font-bold text-slate-300 group-hover:text-white transition-colors leading-none">
        {name}
      </span>
      {def && (
        <span className="text-[9px] text-slate-600 max-w-[76px] text-center leading-tight">
          {def.role}
        </span>
      )}
    </button>
  );
}

// ── Detail section ────────────────────────────────────────────────────────────

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500 mb-2">
        {title}
      </p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

// ── Agent modal ───────────────────────────────────────────────────────────────

function AgentModal({
  name,
  agentStat,
  onClose,
}: {
  name:      string;
  agentStat: AgentStat | undefined;
  onClose:   () => void;
}) {
  const def = AGENT_DEFS[name];
  if (!def) return null;

  const status = agentStat?.status ?? 'idle';

  const statusCfg = {
    active: { color: '#34d399', bg: 'rgba(52,211,153,0.12)',  label: 'En cours d\'exécution', pulse: true  },
    idle:   { color: '#64748b', bg: 'rgba(100,116,139,0.12)', label: 'En attente',            pulse: false },
    error:  { color: '#f87171', bg: 'rgba(248,113,113,0.12)', label: 'Erreur détectée',       pulse: false },
  }[status];

  const gradientBorder = status === 'active'
    ? 'linear-gradient(135deg, #34d399, #059669)'
    : status === 'error'
    ? 'linear-gradient(135deg, #f87171, #dc2626)'
    : 'rgba(255,255,255,0.1)';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border flex flex-col overflow-hidden"
        style={{
          background:   '#0d0d0d',
          borderColor:  'rgba(255,255,255,0.1)',
          maxHeight:    '88vh',
          boxShadow:    '0 25px 60px rgba(0,0,0,0.6)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-4 p-5 border-b"
          style={{ borderColor: 'rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="rounded-full flex-shrink-0"
              style={{ padding: '2.5px', background: gradientBorder }}
            >
              <div className="rounded-full overflow-hidden" style={{ width: 48, height: 48 }}>
                <AgentAvatar name={name} size={48} />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-black text-white text-base tracking-wide">{def.name}</h3>
                <span
                  className="flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: statusCfg.bg, color: statusCfg.color }}
                >
                  {statusCfg.pulse && (
                    <span
                      className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
                      style={{ background: statusCfg.color }}
                    />
                  )}
                  {statusCfg.label}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{def.role}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white text-xl leading-none flex-shrink-0 transition-colors"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex flex-col gap-5 p-5">
          {/* Live stats */}
          {agentStat && (
            <div className="grid grid-cols-3 gap-2">
              {([
                { label: 'Tâches today', value: String(agentStat.taskCount) },
                { label: 'Taux succès',  value: `${agentStat.successRate}%` },
                {
                  label: 'Dernière exec',
                  value: agentStat.lastRun
                    ? new Date(agentStat.lastRun).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                    : '—',
                },
              ] as const).map(({ label, value }) => (
                <div
                  key={label}
                  className="rounded-xl p-3 text-center"
                  style={{
                    background:   'rgba(255,255,255,0.03)',
                    border:       '1px solid rgba(255,255,255,0.07)',
                  }}
                >
                  <div className="text-[9px] text-slate-500 mb-1 leading-none">{label}</div>
                  <div className="text-sm font-black text-white">{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Description */}
          <p className="text-sm text-slate-300 leading-relaxed">{def.description}</p>

          {/* Last error */}
          {agentStat?.lastError && (
            <div
              className="rounded-lg px-3 py-2.5 text-xs text-red-300 leading-relaxed"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}
            >
              <span className="font-bold">Dernière erreur : </span>
              {agentStat.lastError}
            </div>
          )}

          {/* Detail grid */}
          <div className="grid grid-cols-2 gap-4">
            <DetailSection title="Modules">
              {def.modules.map(m => (
                <span key={m} className="text-[11px] text-slate-400 font-mono">{m}</span>
              ))}
            </DetailSection>

            <DetailSection title="APIs externes">
              {def.apis.map(a => (
                <span key={a} className="text-[11px] text-slate-400">{a}</span>
              ))}
            </DetailSection>

            <DetailSection title="Actions disponibles">
              <div className="flex flex-wrap gap-1">
                {def.actions.map(a => (
                  <span
                    key={a}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}
                  >
                    {a}
                  </span>
                ))}
              </div>
            </DetailSection>

            <DetailSection title="Tables Supabase">
              {def.tables.map(t => (
                <span key={t} className="text-[11px] text-slate-400 font-mono">{t}</span>
              ))}
            </DetailSection>
          </div>

          {/* Endpoint */}
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500 mb-1.5">
              Endpoint
            </p>
            <code
              className="block text-xs font-mono px-3 py-2 rounded-lg"
              style={{
                background:  'rgba(255,255,255,0.04)',
                color:       '#94a3b8',
                border:      '1px solid rgba(255,255,255,0.07)',
              }}
            >
              {def.endpoint}
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface OrchestrationMapProps {
  agents: Record<string, AgentStat>;
}

export function OrchestrationMap({ agents }: OrchestrationMapProps) {
  const [selected, setSelected] = useState<string | null>(null);

  function getStatus(name: string): AgentStat['status'] {
    return agents[name]?.status ?? 'idle';
  }

  return (
    <div className="relative w-full select-none">

      {/* ── HASHIRAMA — top centre ── */}
      <div className="flex justify-center">
        <div className="flex flex-col items-center gap-3">
          <div
            className="px-4 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-[0.14em]"
            style={{
              borderColor: 'rgba(124,58,237,0.5)',
              background:  'rgba(124,58,237,0.08)',
              color:       '#a78bfa',
            }}
          >
            Supervision centrale
          </div>
          <AgentNode
            name="HASHIRAMA"
            status={getStatus('HASHIRAMA')}
            onClick={() => setSelected('HASHIRAMA')}
          />
        </div>
      </div>

      {/* ── Connector SVG (desktop only) ── */}
      <div className="hidden xl:block relative mx-auto" style={{ maxWidth: '900px', height: '64px' }}>
        <svg
          width="100%"
          height="64"
          viewBox="0 0 900 64"
          preserveAspectRatio="none"
        >
          {/* Vertical drop from HASHIRAMA */}
          <line x1="450" y1="0" x2="450" y2="28"
            stroke="rgba(124,58,237,0.45)" strokeWidth="1.5" strokeDasharray="5,4" />
          {/* Main horizontal bus */}
          <line x1="113" y1="28" x2="787" y2="28"
            stroke="rgba(255,255,255,0.09)" strokeWidth="1.5" />
          {/* Junction dots */}
          <circle cx="113" cy="28" r="3.5" fill="rgba(5,150,105,0.7)" />
          <circle cx="338" cy="28" r="3.5" fill="rgba(37,99,235,0.7)" />
          <circle cx="563" cy="28" r="3.5" fill="rgba(217,119,6,0.7)" />
          <circle cx="787" cy="28" r="3.5" fill="rgba(220,38,38,0.7)" />
          {/* Drops to sectors */}
          <line x1="113" y1="28" x2="113" y2="64"
            stroke="rgba(5,150,105,0.5)" strokeWidth="1.5" strokeDasharray="5,4" />
          <line x1="338" y1="28" x2="338" y2="64"
            stroke="rgba(37,99,235,0.5)" strokeWidth="1.5" strokeDasharray="5,4" />
          <line x1="563" y1="28" x2="563" y2="64"
            stroke="rgba(217,119,6,0.5)" strokeWidth="1.5" strokeDasharray="5,4" />
          <line x1="787" y1="28" x2="787" y2="64"
            stroke="rgba(220,38,38,0.5)" strokeWidth="1.5" strokeDasharray="5,4" />
        </svg>
      </div>

      {/* Mobile arrow */}
      <div className="flex justify-center xl:hidden my-4">
        <div className="flex flex-col items-center gap-0.5">
          <div className="w-px h-8" style={{ background: 'rgba(124,58,237,0.4)' }} />
          <span className="text-[9px] uppercase tracking-widest text-slate-600">supervise</span>
          <div className="w-px h-8" style={{ background: 'rgba(124,58,237,0.4)' }} />
        </div>
      </div>

      {/* ── Sector cards ── */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3"
        style={{ maxWidth: '900px', margin: '0 auto' }}
      >
        {SECTORS.map(sector => (
          <div
            key={sector.id}
            className="rounded-2xl border flex flex-col gap-5 p-5"
            style={{
              background:  sector.color,
              borderColor: `${sector.accent}2a`,
            }}
          >
            {/* Sector label */}
            <div className="flex items-center gap-2">
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: sector.accent }}
              />
              <span
                className="text-[9px] font-black uppercase tracking-[0.14em] leading-tight"
                style={{ color: sector.accent }}
              >
                {sector.label}
              </span>
            </div>

            {/* Agents */}
            <div className="flex flex-wrap justify-around gap-x-3 gap-y-5">
              {sector.agents.map(agentName => (
                <AgentNode
                  key={agentName}
                  name={agentName}
                  status={getStatus(agentName)}
                  onClick={() => setSelected(agentName)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Modal ── */}
      {selected !== null && (
        <AgentModal
          name={selected}
          agentStat={agents[selected]}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

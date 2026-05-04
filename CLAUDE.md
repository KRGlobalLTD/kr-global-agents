> **IMPORTANT — Next.js** : Cette version contient des breaking changes. Lire le guide dans
> `node_modules/next/dist/docs/` avant d'écrire du code. Respecter les notices de dépréciation.

---

# KR Global Solutions Ltd — Documentation complète du projet

## 1. VISION

**KR Global Solutions Ltd** est une agence IA basée à Londres (UK).

- **Fondateurs** : Karim Hammouche + Raphaël — supervisent le système ~1h/jour
- **Modèle** : 28 agents IA autonomes qui gèrent les opérations quotidiennes
- **Objectif mois 6** : 5 000 € de revenus récurrents mensuels
- **Expansion prévue** : Maroc → France
- **Horizon** : SaaS + White Label (phase 5)

---

## 2. STACK TECHNIQUE

### Couches principales

| Couche | Outil | Version / Notes |
|---|---|---|
| Frontend + API | **Next.js** | 16.2.3 (App Router) |
| Langage | **TypeScript** | strict mode |
| Orchestration agents | **LangGraph** | ^1.2.9 |
| Logique agents | **LangChain** | @langchain/core ^1.1.44 |
| Base de données | **Supabase** | @supabase/supabase-js ^2.102.1 |
| Déploiement | **Vercel** | auto-deploy depuis `main` |
| Secrets | **Doppler** | projet `kr-global-agents`, env `dev` / `prd` |

### Services externes

| Service | Rôle | Variable Doppler |
|---|---|---|
| **OpenRouter** | LLM gateway — modèle `google/gemini-2.0-flash-001` | `OPENROUTER_API_KEY` |
| **Cloudflare R2** | Stockage PDF factures (bucket `kr-global-invoices`) | `R2_*` |
| **Zoho Mail OAuth2** | Email sortant (inbox monitor + réponses) | `ZOHO_*` |
| **Stripe** | Paiements + webhooks onboarding | `STRIPE_*` |
| **Resend** | Emails transactionnels (onboarding, relances) | `RESEND_API_KEY` |
| **Apollo.io** | Scraping prospects B2B | `APOLLO_API_KEY_` |
| **Instantly.ai** | Cold email automation | *(via KILLUA)* |
| **Apify** | Scraping Reddit / Twitter | *(via SANJI)* |
| **Twilio** | SMS relances paiement | `TWILIO_*` |
| **LinkedIn API** | Publication posts | `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN` |
| **Instagram API** | Publication posts | `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID` |
| **Upwork** | Sourcing freelances | `UPWORK_ACCESS_TOKEN` |
| **Slack** | 7 webhooks notifications | `SLACK_WEBHOOK_*` |
| **Qdrant** | Mémoire vectorielle / RAG | *(semaine 3)* |
| **n8n** | Workflows / triggers | *(semaine 2)* |

### Slack webhooks

| Variable | Canal | Usage |
|---|---|---|
| `SLACK_WEBHOOK` | #general | Alertes générales HASHIRAMA |
| `SLACK_WEBHOOK_ALERTES` | #alertes | Erreurs critiques |
| `SLACK_WEBHOOK_REVENUS` | #revenus | Paiements Stripe reçus |
| `SLACK_WEBHOOK_DEPENSES` | #depenses | Dépenses enregistrées |
| `SLACK_WEBHOOK_ERREURS` | #erreurs | Erreurs agents |
| `SLACK_WEBHOOK_PROSPECTS` | #prospects | Nouveaux leads qualifiés |
| `SLACK_WEBHOOK_CONTENU` | #contenu | Drafts ITACHI à valider |

---

## 3. ARCHITECTURE LANGGRAPH

### Endpoint unifié

```
POST /api/agent
Headers : x-internal-token: <INTERNAL_API_TOKEN>
Body    : { task_type, task_input, metadata? }
```

### Routing HASHIRAMA

```
START → supervisor (HASHIRAMA)
              ↓ route par task_type
  accounting   → ZORO   → END
  onboarding   → NAMI   → END
  email        → LUFFY  → END
  prospecting  → KILLUA → END
  marketing    → ITACHI → END
```

### État partagé `KRGlobalState`

```typescript
{
  task_type:   TaskType        // 'accounting'|'marketing'|'email'|'prospecting'|'onboarding'
  task_input:  Record<string, unknown>
  task_result: Record<string, unknown>  // merge (prev + next)
  agent_name:  string
  status:      'pending'|'running'|'completed'|'failed'
  error:       string | null
  messages:    BaseMessage[]   // concaténation
  metadata:    Record<string, unknown>
}
```

### Logs

Chaque exécution est loggée dans **`agent_tasks`** (pré-log `running` → post-log `completed/failed`).
Chaque agent écrit dans **`alerts`** (level: INFO / WARNING / URGENT).

---

## 4. AGENTS CONSTRUITS

### HASHIRAMA — Superviseur

**Rôle** : Supervise tous les agents, génère les rapports quotidiens, évalue les dépenses, alerte si un agent est inactif.

**Modules** (`src/lib/agents/hashirama/`)
- `supervisor.ts` — `evaluateSpending()`, `updateAgentStatus()`, `checkAllAgents()`, `getAllAgentStatuses()`
- `agent-monitor.ts` — `runMonitorCycle()`, `reactivateAgent()`
- `report-generator.ts` — `generateAndSendDailyReport()`
- `daily-report.ts` — `generateDailyReport()`
- `slack-notifier.ts` — `sendDailyReport()`, `sendAlert()`, `sendValidationRequest()`

**Tables Supabase** : `agents_status`, `alerts`, `daily_reports`

**Endpoint** : `POST /api/hashirama`
| Action | Description |
|---|---|
| `daily_report` | Génère et envoie le rapport quotidien Slack |
| `check_agents` | Vérifie le statut de tous les agents |
| `monitor_agents` | Cycle de surveillance complet |
| `agent_update` | Met à jour le statut d'un agent |
| `reactivate_agent` | Réactive un agent inactif |

**Seuils dépenses** : < 50€ auto | 50-200€ validation Slack | > 200€ bloqué

---

### ZORO — Comptabilité UK

**Rôle** : Factures, suivi des coûts, rapports P&L, deadlines fiscales UK, relances paiement.

**Modules** (`src/lib/agents/zoro/`)
- `cost-tracker.ts` — `trackExpense()`, `getCurrentMonthCosts()`
- `invoice-generator.ts` — `generateInvoice()`, `getNextInvoiceNumber()` (PDF pur Node.js, upload R2)
- `report-generator.ts` — `generateMonthlyReport()`, `sendMonthlyReport()`
- `stripe-sync.ts` — `syncStripeTransactions()`, `handleStripeWebhookEvent()`
- `payment-reminder.ts` — `processPaymentReminders()`, `markInvoicePaid()` (email Resend + SMS Twilio)
- `uk-deadlines.ts` — `checkDeadlines()`, `markDeadlineCompleted()`, `getUpcomingDeadlines()`

**LangGraph node** : `src/lib/langgraph/agents/zoro.ts`
Actions : `track_cost` | `generate_report` | `generate_invoice` | `sync_stripe`

**Tables Supabase** : `transactions`, `invoices`, `monthly_reports`, `uk_deadlines`, `alerts`, `couts_par_entite`

**APIs** : Stripe REST, Cloudflare R2 (S3 sig v4), Twilio SMS, Resend

**Endpoint** : `POST /api/zoro`
| Action | Description |
|---|---|
| `track_expense` | Enregistre une dépense |
| `sync_stripe` | Synchronise les transactions Stripe |
| `generate_report` | Génère le rapport P&L mensuel |
| `get_costs` | Récupère les coûts du mois |

**Schema SQL** : `src/lib/db/zoro-schema.sql` *(+ migrations UK deadlines)*

---

### NAMI — Onboarding clients

**Rôle** : Déclenché par webhook Stripe. Crée le client en base, envoie la séquence email d'onboarding, gère la rétention.

**Modules** (`src/lib/agents/nami/`)
- `onboarding-flow.ts` — `triggerOnboarding(paymentIntentId)` (pivot central)
- `email-templates.ts` — `sendWelcomeEmail()` (J+0), `sendProjectBriefEmail()` (J+1), `sendStatusUpdateEmail()` (J+7), `sendNpsEmail()` (J+30)
- `retention-sequence.ts` — `runRetentionCycle()`, `markClientCompleted()`

**LangGraph node** : `src/lib/langgraph/agents/nami.ts`
Actions : `send_welcome_email` | `payment_confirmed` | `generate_contract` | `retention_cycle`

**Tables Supabase** : `clients`, `alerts`

**APIs** : Stripe REST (récupérer PaymentIntent), Resend (emails)

**Endpoint** : `POST /api/nami/stripe-webhook` *(webhook Stripe signé)*

**Schema SQL** : `src/lib/db/nami-schema.sql`

---

### LUFFY — Emails entrants

**Rôle** : Surveille la boîte Zoho Mail, classifie les emails, répond automatiquement, alerte sur Slack #prospects.

**Modules** (`src/lib/agents/luffy/`)
- `inbox-monitor.ts` — `runInboxMonitor()` (polling Zoho Mail OAuth2, déduplication)
- `email-classifier.ts` — `classifyEmail()`, `saveProspect()` (classification : prospect_chaud / prospect_froid / client / spam / autre)
- `email-responder.ts` — `respondToEmail()` (réponse via Resend)

**LangGraph node** : `src/lib/langgraph/agents/luffy.ts`
Actions : `classify_email` | `process_email` | `route_to_agent`

**Tables Supabase** : `prospects`, `alerts`

**APIs** : Zoho Mail OAuth2, Resend, OpenRouter (gemini-2.0-flash-001)

**Endpoint** : `POST /api/luffy`
| Action | Description |
|---|---|
| `classify` | Classifie un email reçu |
| `monitor` | Lance un cycle de surveillance inbox |

**Schema SQL** : `src/lib/db/luffy-schema.sql`

---

### KILLUA — Prospecting

**Rôle** : Trouve des prospects B2B via Apollo.io, rédige les emails de cold outreach, gère les campagnes.

**Modules** (`src/lib/agents/killua/`)
- `prospect-finder.ts` — `findProspects(campaignId, filters)` (Apollo.io, déduplication Supabase)
- `email-writer.ts` — `writeOutreachEmail(prospect, type)` (initial / followup1 / followup2)
- `campaign-manager.ts` — `runCampaignCycle()`, `createCampaign()`, `getCampaignStats()`

**LangGraph node** : `src/lib/langgraph/agents/killua.ts`
Actions : `scrape_leads` | `send_outreach` | `track_prospect`

**Tables Supabase** : `prospects`, `campaigns`, `alerts`

**APIs** : Apollo.io REST, OpenRouter (email writing), Instantly.ai

**Endpoint** : `POST /api/killua`
| Action | Description |
|---|---|
| `find_prospects` | Scrape Apollo.io selon filtres |
| `run_campaign` | Exécute le cycle d'une campagne |
| `create_campaign` | Crée une nouvelle campagne |
| `send_email` | Envoie un email de prospection |
| `mark_replied` | Marque un prospect comme ayant répondu |

**Schema SQL** : `src/lib/db/killua-schema.sql`

---

### ITACHI — Marketing & Contenu

**Rôle** : Génère du contenu LinkedIn/Twitter/blog via LLM, planifie les posts, envoie les drafts sur Slack #contenu pour validation, suit les performances.

**Modules** (`src/lib/agents/itachi/`)
- `content-generator.ts` — `generateContent(req)` (routing modèle : post→gemini, article→kimi-k2, strategie→claude)
- `content-scheduler.ts` — `scheduleContent()`, `approveContent()`, `publishContent()`, `archiveContent()`, `getPendingApproval()`
- `performance-tracker.ts` — `trackMetrics()`, `getContentMetrics()`, `generateWeeklyReport()`
- `slack-notifier.ts` — `notifyDraft()`, `notifyApproved()`, `notifyRejected()`, `notifyPublished()`

**LangGraph node** : `src/lib/langgraph/agents/itachi.ts`
Actions : `generate_content` | `schedule_post` | `track_performance`

**Tables Supabase** : `content`, `content_metrics`, `couts_par_entite`, `alerts`

**APIs** : OpenRouter (multi-modèle), Slack webhook #contenu

**Endpoints** :
- `POST /api/itachi` — endpoint unifié (generate / schedule / approve / publish / archive / track / get_metrics / weekly_report)
- `POST /api/itachi/generate` — `{ sujet, plateforme, langue, ton }` → `{ content_id, contenu, hashtags }`
- `POST /api/itachi/schedule` — `{ content_id, date_prevue }`
- `GET /api/itachi/performance` — stats globales par plateforme
- `POST /api/itachi/performance` — enregistre des métriques

**Mapping plateforme → modèle** :
- `linkedin` → post / moyen / gemini-2.0-flash-001
- `twitter` → post / court / gemini-2.0-flash-001
- `blog` → article / long / moonshotai/kimi-k2

**Schema SQL** : `src/lib/db/itachi-schema.sql` (tables : `content`, `content_metrics`, `couts_par_entite`)

---

### ROBIN — Support client *(Phase 1 bonus)*

**Rôle** : Crée et gère les tickets de support, répond automatiquement, escalade si nécessaire.

**Modules** (`src/lib/agents/robin/`)
- `ticket-handler.ts` — `createTicket()`, `getOpenTickets()`, `updateTicketStatus()`
- `auto-responder.ts` — `respondToTicket()`, `escalateTicket()`, `sendManualResponse()`

**Tables** : `tickets`, `alerts`
**Endpoint** : `POST /api/robin` (actions : `create_ticket` | `respond` | `escalate` | `resolve`)
**Schema SQL** : `src/lib/db/robin-schema.sql`

---

### SANJI — Réseaux sociaux *(Phase 1 bonus)*

**Rôle** : Publie du contenu sur LinkedIn et Instagram, monitore les mentions.

**Modules** (`src/lib/agents/sanji/`)
- `social-publisher.ts` — `publishContent(input)` (LinkedIn API + Instagram API)
- `social-monitor.ts` — `runMonitorCycle()` (détection mentions)

**Tables** : `social_publications`, `social_mentions`, `alerts`
**Endpoint** : `POST /api/sanji` (actions : `publish` | `monitor`)
**Schema SQL** : `src/lib/db/sanji-schema.sql`

---

### CHOPPER — Freelances & Missions *(Phase 1 bonus)*

**Rôle** : Évalue et recrute des freelances, gère les missions, génère les contrats NDA/mission.

**Modules** (`src/lib/agents/chopper/`)
- `freelance-evaluator.ts` — `evaluateAndRegister()`, `blacklistFreelance()`, `getAvailableFreelances()`
- `mission-manager.ts` — `createMission()`, `publishMission()`, `assignFreelance()`, `updateMissionStatus()`, `getOpenMissions()`
- `contract-generator.ts` — `generateContract()`, `sendContract()`, `markContractSigned()`

**Tables** : `freelances`, `missions`, `contracts`, `alerts`
**Endpoint** : `POST /api/chopper` (9 actions : create_mission, publish_mission, assign_freelance, update_mission, evaluate, blacklist, generate_contract, send_contract, sign_contract)
**Schema SQL** : `src/lib/db/chopper-schema.sql`

---

### OROCHIMARU — Infrastructure *(Phase 1 bonus)*

**Rôle** : Vérifie la santé de tous les outils externes, orchestre les backups Supabase.

**Modules** (`src/lib/agents/orochimaru/`)
- `health-checker.ts` — `runHealthCheck()`, `getLatestToolStatuses()` (vérifie : OpenRouter, Supabase, Stripe, Zoho, Apollo, Resend, Twilio, Slack, R2, LinkedIn, Instagram)
- `backup-orchestrator.ts` — `runBackup()`, `getLastBackup()`

**Tables** : `tool_status`, `backups`, `alerts`
**Endpoint** : `POST /api/orochimaru` (actions : `health_check` | `backup`)
**Schema SQL** : `src/lib/db/orochimaru-schema.sql`

---

### TSUNADE — Finances avancées *(Phase 1 bonus)*

**Rôle** : Valide les dépenses avec seuils d'approbation, calcule les dividendes trimestriels.

**Modules** (`src/lib/agents/tsunade/`)
- `expense-validator.ts` — `validateExpense()`, `decideExpense()`, `getPendingExpenses()`
- `dividend-calculator.ts` — `calculateDividends()`, `approveDividends()`, `markDividendsPaid()`

**Tables** : `expense_validations`, `dividend_calculations`, `alerts`
**Schema SQL** : `src/lib/db/tsunade-schema.sql`

---

## 5. FICHIERS LANGGRAPH

```
src/lib/langgraph/
├── state.ts          KRGlobalState — état partagé (Annotation.Root)
├── openrouter.ts     callOpenRouter(), systemPrompt() — utilitaire partagé
├── supervisor.ts     HASHIRAMA graph : StateGraph + routing + runGraph()
└── agents/
    ├── zoro.ts       Node ZORO  — branche cost-tracker, invoice-generator, report-generator
    ├── nami.ts       Node NAMI  — branche onboarding-flow, retention-sequence + OpenRouter contracts
    ├── luffy.ts      Node LUFFY — branche email-classifier, email-responder
    ├── killua.ts     Node KILLUA — branche prospect-finder, email-writer, campaign-manager
    └── itachi.ts     Node ITACHI — branche content-generator, content-scheduler, performance-tracker

src/app/api/agent/route.ts   Endpoint unifié POST + GET avec log agent_tasks
```

### Utilisation

```typescript
import { runGraph } from '@/lib/langgraph/supervisor';

const result = await runGraph('marketing', {
  action:     'generate_content',
  sujet:      'automatisation IA pour PME',
  plateforme: 'linkedin',
  langue:     'fr',
});
// result.agent_name → 'ITACHI'
// result.status     → 'completed'
// result.task_result → { content_id, titre, contenu, hashtags }
```

---

## 6. TABLES SUPABASE

| Table | Agent(s) | Description |
|---|---|---|
| `agent_tasks` | HASHIRAMA / API unifié | Log de toutes les exécutions LangGraph |
| `agents_status` | HASHIRAMA | Statut temps réel de chaque agent |
| `alerts` | Tous | Logs INFO / WARNING / URGENT de tous les agents |
| `backups` | OROCHIMARU | Historique des backups Supabase |
| `campaigns` | KILLUA | Campagnes de prospection cold email |
| `clients` | NAMI | Clients onboardés via Stripe |
| `content` | ITACHI | Contenus générés (draft→approuvé→publié) |
| `content_metrics` | ITACHI | Métriques de performance par contenu |
| `contracts` | CHOPPER | Contrats NDA / mission freelances |
| `couts_par_entite` | ITACHI / ZORO | Coûts IA ventilés par entité cliente |
| `daily_reports` | HASHIRAMA | Rapports quotidiens |
| `dividend_calculations` | TSUNADE | Calculs dividendes trimestriels |
| `expense_validations` | TSUNADE | Dépenses en attente d'approbation |
| `freelances` | CHOPPER | Base freelances évalués |
| `invoices` | ZORO | Factures générées |
| `missions` | CHOPPER | Missions freelances |
| `monthly_reports` | ZORO | Rapports P&L mensuels |
| `prospects` | KILLUA / LUFFY | Prospects B2B |
| `social_mentions` | SANJI | Mentions détectées |
| `social_publications` | SANJI | Posts publiés sur les réseaux |
| `tickets` | ROBIN | Tickets support clients |
| `tool_status` | OROCHIMARU | Santé des services externes |
| `transactions` | ZORO | Transactions financières (Stripe + manual) |
| `uk_deadlines` | ZORO | Deadlines fiscales UK (Companies House, HMRC…) |

---

## 7. VARIABLES DOPPLER

Projet : `kr-global-agents` — Config : `dev` (synced → Vercel "Encrypted")

| Variable | Service |
|---|---|
| `INTERNAL_API_TOKEN` | Auth header toutes les routes API (`x-internal-token`) |
| `OPENROUTER_API_KEY` | OpenRouter LLM gateway |
| `OPENROUTER_MODEL` | Modèle par défaut (`google/gemini-2.0-flash-001`) |
| `SUPABASE_URL` | Supabase — URL projet |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase — clé service (server-side only) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase — URL publique (client) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase — clé anonyme (client) |
| `APP_URL` | URL de l'app (`https://kr-global-agents.vercel.app`) |
| `STRIPE_SECRET_KEY` | Stripe API |
| `STRIPE_PUBLISHABLE_KEY` | Stripe front-end |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature |
| `NAMI_STRIPE_WEBHOOK_SECRET` | Webhook Stripe dédié NAMI |
| `RESEND_API_KEY` | Resend email transactionnel |
| `ZOHO_CLIENT_ID` | Zoho Mail OAuth2 |
| `ZOHO_CLIENT_SECRET` | Zoho Mail OAuth2 |
| `ZOHO_REFRESH_TOKEN` | Zoho Mail OAuth2 |
| `ZOHO_ACCOUNT_ID_` | Zoho Mail account ID |
| `ZOHO_API_DOMAIN_` | Zoho Mail API domain |
| `KR_EMAIL` | Adresse email KR Global |
| `R2_ACCOUNT_ID` | Cloudflare R2 |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 |
| `R2_BUCKET_NAME` | Cloudflare R2 (kr-global-invoices) |
| `R2_PUBLIC_URL` | URL publique R2 |
| `APOLLO_API_KEY_` | Apollo.io prospecting |
| `UPWORK_ACCESS_TOKEN` | Upwork sourcing freelances |
| `LINKEDIN_ACCESS_TOKEN` | LinkedIn API publication |
| `LINKEDIN_AUTHOR_URN` | LinkedIn author URN |
| `INSTAGRAM_ACCESS_TOKEN` | Instagram API |
| `INSTAGRAM_ACCOUNT_ID` | Instagram account ID |
| `SLACK_WEBHOOK` | Slack #general |
| `SLACK_WEBHOOK_ALERTES` | Slack #alertes |
| `SLACK_WEBHOOK_REVENUS` | Slack #revenus |
| `SLACK_WEBHOOK_DEPENSES` | Slack #depenses |
| `SLACK_WEBHOOK_ERREURS` | Slack #erreurs |
| `SLACK_WEBHOOK_PROSPECTS` | Slack #prospects |
| `SLACK_WEBHOOK_CONTENU` | Slack #contenu |
| `TWILIO_ACCOUNT_SID` | Twilio SMS |
| `TWILIO_AUTH_TOKEN` | Twilio SMS |
| `TWILIO_PHONE_NUMBER` | Twilio numéro expéditeur |

---

## 8. ROADMAP

### Phase 1 — Infrastructure (✅ Terminé)

| Semaine | Chantier | Statut |
|---|---|---|
| S1 | LangGraph — state, supervisor, 5 nodes agents | ✅ Terminé |
| S2 | n8n — remplacement Make.com (triggers workflows) | ⏳ Planifié |
| S3 | Qdrant — mémoire vectorielle, RAG, contexte clients | ⏳ Planifié |
| S4 | LangChain — outils internes agents (tools, chains) | ⏳ Planifié |

**Agents Phase 1 construits** : HASHIRAMA, ZORO, NAMI, LUFFY, KILLUA, ITACHI, ROBIN, SANJI, CHOPPER, OROCHIMARU, TSUNADE

### Phase 2 — Agents 7-12 *(mois 2)*

GARP (legal & compliance UK), agents Maroc, agents France, agent Analytics, agent SEO, agent Pricing

### Phase 3 — Agents 13-19 *(mois 3)*

Agents spécialisés par verticale (SaaS, e-commerce, immobilier), agent Client Success, agent Upsell

### Phase 4 — Agents 20-26 *(mois 4-5)*

Agents partenaires, agent White Label, agent Reporting exécutif, intégrations ERP

### Phase 5 — Agents 27-28 + Produit *(mois 6)*

- Agent SaaS orchestrateur
- Agent White Label multi-tenant
- Lancement SaaS : 5 000 €/mois récurrents
- Expansion Maroc + France opérationnelle

---

## 9. CONSTRUIRE UN NOUVEL AGENT

### Étapes (dans l'ordre)

**1. Modules métier**
```bash
mkdir src/lib/agents/<nom>/
# Créer : <action1>.ts, <action2>.ts, etc.
# Chaque fichier exporte des fonctions async typées
```

**2. Schema SQL**
```bash
# Créer src/lib/db/<nom>-schema.sql
# Exécuter dans Supabase SQL Editor (pas via migration auto)
```

**3. Node LangGraph**
```bash
# Créer src/lib/langgraph/agents/<nom>.ts
# Pattern :
export async function <nom>Node(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = state.task_input['action'] as string;
  try {
    // switch(action) → appel modules métier
    return { agent_name: 'NOM', status: 'completed', task_result: result, error: null };
  } catch (err) {
    return { agent_name: 'NOM', status: 'failed', error: err.message };
  }
}
```

**4. Brancher dans le supervisor**
```typescript
// src/lib/langgraph/supervisor.ts
// 1. Ajouter le task_type dans state.ts : TaskType
// 2. Importer le node
// 3. Ajouter .addNode('<nom>', <nom>Node)
// 4. Ajouter dans TASK_AGENT : { '<task_type>': '<nom>' }
// 5. Ajouter .addConditionalEdges entrée + .addEdge sortie → END
```

**5. Route API dédiée** *(optionnel si endpoint unifié suffit)*
```bash
# Créer src/app/api/<nom>/route.ts
# Pattern : verifyInternalToken → switch(action) → appel modules
```

**6. Variables Doppler**
```bash
doppler secrets set MA_CLE="valeur" --project kr-global-agents --config dev
# Puis syncer vers Vercel depuis le dashboard Doppler
```

**7. Push et test**
```bash
git add -A && git commit -m "feat: agent NOM — description" && git push
# Attendre redéploiement Vercel (~30-60s)
curl -X POST https://kr-global-agents.vercel.app/api/agent \
  -H "x-internal-token: <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "task_type": "<task_type>", "task_input": { "action": "<action>" } }'
```

---

## 10. RÈGLES DU PROJET

### Workflow

- **Un agent à la fois**, testé avant de passer au suivant
- **Push GitHub = déploiement automatique Vercel** (branch `main`)
- SQL exécuté **directement dans Supabase SQL Editor** (jamais via migration auto)
- Secrets gérés dans **Doppler**, syncés vers Vercel en mode **"Encrypted"**
- Claude Code : toujours utiliser le mode **"accept edits"**

### Conventions TypeScript

- **Pas de `any`** — utiliser `unknown` avec cast explicite
- Pas de commentaires sauf si le WHY est non-obvious
- Chaque node LangGraph retourne `Partial<KRGlobalStateType>`
- **Jamais throw** hors du node — toujours `return { status: 'failed', error: message }`
- **Logs systématiques** : `supabase.from('alerts').insert({ agent_name, level, message })`
- **Secrets** : uniquement via `process.env.*` — jamais hardcodés
- Headers HTTP : uniquement ASCII (pas de tirets longs —, pas de caractères > 255)

### Sécurité API

- Toutes les routes : vérification `x-internal-token` via `verifyInternalToken(req)`
- Webhook Stripe NAMI : signature HMAC `NAMI_STRIPE_WEBHOOK_SECRET`
- Variables sensibles : jamais dans le code, jamais dans les logs

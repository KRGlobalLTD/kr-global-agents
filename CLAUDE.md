> **IMPORTANT — Next.js** : Cette version contient des breaking changes. Lire le guide dans
> `node_modules/next/dist/docs/` avant d'écrire du code. Respecter les notices de dépréciation.

---

# KR Global Solutions Ltd — Documentation Complète V4
> Mise à jour automatique : mai 2026 — Claude Code

---

## 1. VISION & OBJECTIFS

**KR Global Solutions Ltd** est une agence IA basée à Londres (UK).

| Élément | Valeur |
|---|---|
| Fondateurs | Karim Hammouche + Raphaël |
| Supervision | ~1h/jour (système autonome) |
| Modèle | 13 agents IA autonomes (Phase 1 complète) |
| Objectif mois 6 | 5 000 € revenus récurrents mensuels |
| Expansion | Maroc → France → White Label |
| Horizon Phase 5 | SaaS multi-tenant |

---

## 2. STACK TECHNIQUE COMPLÈTE

### Couches principales

| Couche | Outil | Version | Statut |
|---|---|---|---|
| Frontend + API | **Next.js** | 16.2.3 (App Router) | ✅ configuré |
| Langage | **TypeScript** | strict mode | ✅ configuré |
| Orchestration agents | **LangGraph** | @langchain/langgraph ^1.2.9 | ✅ configuré |
| Logique agents | **LangChain** | @langchain/core ^1.1.44 | ✅ configuré |
| LangChain community | **@langchain/community** | ^1.1.27 | ✅ configuré |
| Base de données | **Supabase** | @supabase/supabase-js ^2.102.1 | ✅ configuré |
| Mémoire vectorielle | **Qdrant Cloud** | REST API | ✅ configuré |
| Embeddings | **Jina AI** | jina-embeddings-v3 (1024d) | ✅ configuré |
| Déploiement | **Vercel** | auto-deploy depuis `main` | ✅ configuré |
| Secrets | **Doppler** | projet `kr-global-agents`, env `dev`/`prd` | ✅ configuré |
| Orchestration workflows | **n8n** | Railway auto-hébergé | ✅ 21 workflows actifs |
| Auth dashboard | **NextAuth** | Email + password | ✅ configuré |

### Services externes

| Service | Rôle | Statut |
|---|---|---|
| **OpenRouter** | LLM gateway — `google/gemini-2.0-flash-001` | ✅ configuré |
| **Cloudflare R2** | Stockage PDF factures + images sociales | ✅ configuré |
| **Zoho Mail OAuth2** | Inbox monitoring + réponses LUFFY | ✅ configuré |
| **Stripe** | Paiements + webhooks onboarding NAMI | ✅ configuré |
| **Resend** | Emails transactionnels (bienvenue, relances) | ✅ configuré |
| **Apollo.io** | Scraping prospects B2B | ✅ configuré |
| **Twilio** | SMS relances paiement | ✅ configuré |
| **LinkedIn API** | Publication posts | ⚠️ token à renouveler |
| **Instagram API** | Publication posts | ⚠️ token à renouveler |
| **Publer API** | Planification multi-plateforme SANJI | ✅ configuré |
| **Replicate** | Génération images flux-pro (SANJI) | ✅ configuré |
| **Upwork** | Sourcing freelances | ✅ configuré |
| **Slack** | 7 webhooks notifications | ✅ configuré |
| **Qdrant** | Mémoire vectorielle / RAG (kr_knowledge) | ✅ configuré |
| **Jina AI** | Embeddings multilingues 1024d | ✅ configuré |
| **Instantly.ai** | Cold email automation (KILLUA) | ✅ configuré |
| **Apify** | Scraping Reddit / Twitter | ⚠️ à tester |

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

## 3. ARCHITECTURE

### Endpoint unifié LangGraph

```
POST /api/agent
Headers : x-internal-token: <INTERNAL_API_TOKEN>
Body    : { task_type, task_input, metadata? }
```

### Routing HASHIRAMA — supervisor.ts

```
task_type      → agent node
─────────────────────────────
accounting     → ZORO
onboarding     → NAMI
email          → LUFFY
prospecting    → KILLUA
marketing      → ITACHI
finance        → TSUNADE
supervisor     → HASHIRAMA
reporting      → GARP
infrastructure → OROCHIMARU
social         → SANJI
research       → ROBIN
support        → CHOPPER
knowledge      → BROOK
```

### État partagé `KRGlobalState` — state.ts

```typescript
TaskType = 'accounting' | 'marketing' | 'email' | 'prospecting' | 'onboarding'
         | 'finance' | 'supervisor' | 'reporting' | 'infrastructure'
         | 'social' | 'research' | 'support' | 'knowledge'

KRGlobalStateType = {
  task_type:   TaskType
  task_input:  Record<string, unknown>
  task_result: Record<string, unknown>   // merge (prev + next)
  agent_name:  string
  status:      'pending' | 'running' | 'completed' | 'failed'
  error:       string | null
  messages:    BaseMessage[]
  metadata:    Record<string, unknown>
}
```

### LangChain chains (`src/lib/langchain/chains/`)

| Chain | Agent | Description |
|---|---|---|
| `brook-chain.ts` | BROOK | Expert knowledge management KR Global |
| `chopper-chain.ts` | CHOPPER | Expert RH freelances + support |
| `garp-chain.ts` | GARP | Expert reporting KPI |
| `hashirama-chain.ts` | HASHIRAMA | Superviseur général |
| `itachi-chain.ts` | ITACHI | Expert marketing contenu |
| `killua-chain.ts` | KILLUA | Expert prospection B2B |
| `luffy-chain.ts` | LUFFY | Expert classification emails |
| `nami-chain.ts` | NAMI | Expert onboarding clients |
| `orochimaru-chain.ts` | OROCHIMARU | Expert infrastructure |
| `robin-chain.ts` | ROBIN | Expert veille stratégique |
| `sanji-chain.ts` | SANJI | Expert réseaux sociaux |
| `tsunade-chain.ts` | TSUNADE | Expert finances UK |
| `zoro-chain.ts` | ZORO | Expert comptabilité UK |

### Qdrant collections

| Collection | Dim | Modèle | Usage |
|---|---|---|---|
| `kr_knowledge` | 1024 | jina-embeddings-v3 | BROOK knowledge base + ROBIN veille |
| `kr_clients` | 1024 | jina-embeddings-v3 | Profils clients |
| `kr_prospects` | 1024 | jina-embeddings-v3 | Prospects B2B |
| `kr_content` | 1024 | jina-embeddings-v3 | Contenus ITACHI |
| `kr_emails` | 1024 | jina-embeddings-v3 | Emails classifiés LUFFY |

### Supabase tables

| Table | Agent(s) | Description |
|---|---|---|
| `agent_tasks` | HASHIRAMA / API unifié | Log de toutes les exécutions LangGraph |
| `agents_status` | HASHIRAMA | Statut temps réel chaque agent |
| `alerts` | Tous | Logs INFO / WARNING / URGENT |
| `backups` | OROCHIMARU | Historique backups Supabase |
| `campaigns` | KILLUA | Campagnes cold email |
| `clients` | NAMI | Clients onboardés via Stripe |
| `content` | ITACHI | Contenus (draft→approuvé→publié) |
| `content_metrics` | ITACHI | Métriques performance contenu |
| `contracts` | CHOPPER | Contrats NDA / mission freelances |
| `couts_par_entite` | ITACHI / ZORO | Coûts IA ventilés par client |
| `daily_reports` | HASHIRAMA | Rapports quotidiens |
| `dividend_calculations` | TSUNADE | Calculs dividendes trimestriels |
| `expense_validations` | TSUNADE | Dépenses en attente d'approbation |
| `freelances` | CHOPPER | Base freelances évalués |
| `invoices` | ZORO | Factures générées (PDF R2) |
| `knowledge_documents` | BROOK | Docs knowledge base (procédures, templates…) |
| `missions` | CHOPPER | Missions freelances |
| `monthly_reports` | ZORO | Rapports P&L mensuels |
| `prompt_versions` | BROOK | Versions des prompts agents (rollback) |
| `prospects` | KILLUA / LUFFY | Prospects B2B |
| `research_insights` | ROBIN | Insights veille indexés |
| `sanji_scheduled_posts` | SANJI | Posts planifiés via Publer |
| `social_mentions` | SANJI | Mentions détectées |
| `social_publications` | SANJI | Posts publiés (LinkedIn, Instagram) |
| `tickets` | CHOPPER | Tickets support clients |
| `tool_status` | OROCHIMARU | Santé des services externes |
| `transactions` | ZORO | Transactions financières (Stripe + manual) |
| `uk_deadlines` | ZORO | Deadlines fiscales UK |

---

## 4. AGENTS — STATUT COMPLET

### HASHIRAMA — Superviseur ✅

**task_type** : `supervisor`
**Modules** (`src/lib/agents/hashirama/`) :
- `supervisor.ts` — `evaluateSpending()`, `updateAgentStatus()`, `checkAllAgents()`, `getAllAgentStatuses()`
- `agent-monitor.ts` — `runMonitorCycle()`, `reactivateAgent()`
- `report-generator.ts` — `generateAndSendDailyReport()`
- `daily-report.ts` — `generateDailyReport()`
- `slack-notifier.ts` — `sendDailyReport()`, `sendAlert()`, `sendValidationRequest()`

**Endpoint** : `POST /api/hashirama`
| Action | Description |
|---|---|
| `daily_report` | Génère et envoie le rapport quotidien |
| `check_agents` | Vérifie le statut de tous les agents |
| `monitor_agents` | Cycle de surveillance complet |
| `agent_update` | Met à jour le statut d'un agent |
| `reactivate_agent` | Réactive un agent inactif |

**Tables** : `agents_status`, `alerts`, `daily_reports`
**Seuils dépenses** : < 50€ auto | 50-200€ validation Slack | > 200€ bloqué

---

### ZORO — Comptabilité UK ✅

**task_type** : `accounting`
**Modules** (`src/lib/agents/zoro/`) :
- `cost-tracker.ts` — `trackExpense()`, `getCurrentMonthCosts()`
- `invoice-generator.ts` — `generateInvoice()`, PDF natif Node.js → upload R2 (Sig V4)
- `report-generator.ts` — `generateMonthlyReport()`, `sendMonthlyReport()`
- `stripe-sync.ts` — `syncStripeTransactions()`, `handleStripeWebhookEvent()`
- `payment-reminder.ts` — `processPaymentReminders()`, `markInvoicePaid()` (Resend + Twilio SMS)
- `uk-deadlines.ts` — `checkDeadlines()`, `markDeadlineCompleted()`, `getUpcomingDeadlines()`

**Endpoint** : `POST /api/zoro`
| Action | Description |
|---|---|
| `track_expense` | Enregistre une dépense |
| `sync_stripe` | Synchronise les transactions Stripe |
| `generate_report` | Génère rapport P&L mensuel |
| `get_costs` | Récupère les coûts du mois |

**Tables** : `transactions`, `invoices`, `monthly_reports`, `uk_deadlines`, `couts_par_entite`
**APIs** : Stripe REST, Cloudflare R2 (S3 Sig V4 natif), Twilio SMS, Resend

---

### NAMI — Onboarding clients ✅

**task_type** : `onboarding`
**Modules** (`src/lib/agents/nami/`) :
- `onboarding-flow.ts` — `triggerOnboarding(paymentIntentId)`
- `email-templates.ts` — `sendWelcomeEmail()` (J+0), `sendProjectBriefEmail()` (J+1), `sendStatusUpdateEmail()` (J+7), `sendNpsEmail()` (J+30)
- `retention-sequence.ts` — `runRetentionCycle()`, `markClientCompleted()`

**Endpoint** : `POST /api/nami/stripe-webhook` *(webhook Stripe signé HMAC)*
**Tables** : `clients`, `alerts`
**APIs** : Stripe REST, Resend

---

### LUFFY — Emails entrants ✅

**task_type** : `email`
**Modules** (`src/lib/agents/luffy/`) :
- `inbox-monitor.ts` — `runInboxMonitor()` (polling Zoho Mail OAuth2, déduplication)
- `email-classifier.ts` — `classifyEmail()`, `saveProspect()` (5 classifications)
- `email-responder.ts` — `respondToEmail()` (Resend) — `extractEmail()` retire brackets Zoho

**Endpoint** : `POST /api/luffy`
| Action | Description |
|---|---|
| `monitor` | Lance cycle surveillance inbox |
| `classify` | Classifie un email reçu |

**Classifications** : `prospect_chaud` | `prospect_froid` | `client` | `spam` | `autre`
**Tables** : `prospects`, `alerts`
**APIs** : Zoho Mail OAuth2, Resend, OpenRouter (gemini-2.0-flash-001)
**Fix critique** : `extractEmail()` retire les brackets `<email@domain.com>` retournés par Zoho

---

### KILLUA — Prospecting B2B ✅

**task_type** : `prospecting`
**Modules** (`src/lib/agents/killua/`) :
- `prospect-finder.ts` — `findProspects(campaignId, filters)` (Apollo.io)
- `email-writer.ts` — `writeOutreachEmail(prospect, type)` (initial / followup1 / followup2)
- `campaign-manager.ts` — `runCampaignCycle()`, `createCampaign()`, `getCampaignStats()`
- `reddit-scraper.ts` — scraping Reddit pour leads

**Endpoint** : `POST /api/killua`
| Action | Description |
|---|---|
| `find_prospects` | Scrape Apollo.io |
| `run_campaign` | Exécute cycle d'une campagne |
| `create_campaign` | Crée une nouvelle campagne |
| `send_email` | Envoie un email de prospection |
| `scrape_reddit` | Scrape subreddit pour leads |
| `mark_replied` | Marque un prospect comme ayant répondu |

**Tables** : `prospects`, `campaigns`, `alerts`
**APIs** : Apollo.io REST, OpenRouter, Instantly.ai

---

### ITACHI — Marketing & Contenu ✅

**task_type** : `marketing`
**Modules** (`src/lib/agents/itachi/`) :
- `content-generator.ts` — `generateContent(req)` (routing modèle par plateforme)
- `content-scheduler.ts` — `scheduleContent()`, `approveContent()`, `publishContent()`, `archiveContent()`
- `performance-tracker.ts` — `trackMetrics()`, `getContentMetrics()`, `generateWeeklyReport()`
- `slack-notifier.ts` — `notifyDraft()`, `notifyApproved()`, `notifyPublished()`
- `calendar-planner.ts` — planification éditoriale
- `podcast-scripter.ts` — scripts podcasts
- `seasonal-planner.ts` — contenu saisonnier
- `seo-writer.ts` — articles SEO optimisés
- `social-formatter.ts` — formatage multi-plateforme
- `youtube-scripter.ts` — scripts YouTube

**Endpoints** :
- `POST /api/itachi` — 8 actions : `generate`, `schedule`, `approve`, `publish`, `archive`, `track`, `get_metrics`, `weekly_report`
- `POST /api/itachi/generate` — `{ sujet, plateforme, langue, ton }`
- `POST /api/itachi/schedule` — `{ content_id, date_prevue }`
- `GET /api/itachi/performance` — stats par plateforme

**Mapping plateforme → modèle** :
- `linkedin`, `twitter` → `google/gemini-2.0-flash-001`
- `blog` → `moonshotai/kimi-k2`

**Tables** : `content`, `content_metrics`, `couts_par_entite`, `alerts`

---

### GARP — Reporting KPI ✅

**task_type** : `reporting`
**Modules** (`src/lib/agents/garp/`) :
- `kpi-calculator.ts` — `calculateKPIs(period)` (daily / weekly / monthly)
- `report-builder.ts` — `buildReport(kpis)` — narration exécutive
- `slack-reporter.ts` — `sendReport()`, `sendKpiAlert()`

**Endpoint** : `POST /api/garp`
| Action | Description |
|---|---|
| `generate_report` | Génère rapport KPI complet |
| `get_kpis` | Retourne KPIs calculés |
| `send_alert` | Envoie alerte KPI Slack |
| `get_reports` | Liste rapports historiques |

**Tables** : lit `transactions`, `invoices`, `campaigns`, `content`, `agents_status`, `alerts`
**APIs** : Slack webhooks

---

### OROCHIMARU — Infrastructure ✅

**task_type** : `infrastructure`
**Modules** (`src/lib/agents/orochimaru/`) :
- `health-checker.ts` — `runHealthCheck()`, `getLatestToolStatuses()` (11 services)
- `backup-orchestrator.ts` — `runBackup()`, `getLastBackup()`
- `alert-manager.ts` — gestion alertes infrastructure
- `secret-validator.ts` — validation variables Doppler

**Endpoint** : `POST /api/orochimaru`
| Action | Description |
|---|---|
| `health_check` | Vérifie tous les services externes |
| `backup` | Orchestre backup Supabase |
| `validate_secrets` | Valide les variables Doppler |
| `generate_health_report` | Rapport santé complet |
| `send_alert` | Envoie alerte infrastructure |

**Services vérifiés** : OpenRouter, Supabase, Stripe, Zoho, Apollo, Resend, Twilio, Slack, R2, LinkedIn, Instagram
**Tables** : `tool_status`, `backups`, `alerts`
**Variable requise** : `N8N_URL=https://primary-production-fbc07.up.railway.app`

---

### SANJI — Réseaux sociaux ✅

**task_type** : `social`
**Modules** (`src/lib/agents/sanji/`) :
- `social-publisher.ts` — publication LinkedIn API + Instagram API (legacy direct)
- `social-monitor.ts` — `runMonitorCycle()` (mentions)
- `format-adapter.ts` — adaptation contenu 6 plateformes Publer
- `image-generator.ts` — `generateAndUploadImage()` (Replicate flux-pro → R2)
- `scheduler.ts` — créneaux optimaux Paris timezone par plateforme
- `publisher.ts` — `publishApprovedContent()` batch Publer
- `performance-tracker.ts` — `fetchPublerAnalytics()`, `sendWeeklyReport()`
- `calendar-manager.ts` — gestion calendrier éditorial
- `content-adapter.ts` — adaptation contenu ITACHI → SANJI

**6 plateformes Publer** : `linkedin_company`, `linkedin_karim`, `linkedin_raphael`, `instagram`, `tiktok`, `facebook`

**Endpoints** :
- `POST /api/sanji` — `publish` | `monitor`
- `POST /api/sanji/publish` — auth `x-sanji-secret` — `publish_one` | `publish_approved`
- `GET|POST /api/sanji/performance` — stats Publer + `send_report`
- `POST /api/sanji/test` — dry-run sans publication ni génération image

**Tables** : `social_publications`, `social_mentions`, `sanji_scheduled_posts`, `alerts`
**APIs** : LinkedIn API, Instagram API, Publer API, Replicate (flux-pro), Cloudflare R2
**Note** : tokens LinkedIn/Instagram à créer quand comptes KR Global ouverts

---

### ROBIN — Veille & Research ✅

**task_type** : `research`
**Modules** (`src/lib/agents/robin/`) :
- `web-researcher.ts` — `researchTopic()`, `scrapeReddit()`, `researchAITrends()`
- `competitor-tracker.ts` — `trackCompetitors()`, `compareWithKRGlobal()`
- `knowledge-builder.ts` — `addKnowledge()`, `searchKnowledge()`, `indexResearchResults()` (Qdrant kr_knowledge)
- `report-generator.ts` — `generateIntelReport()`
- `auto-responder.ts` — réponses automatiques
- `ticket-handler.ts` — gestion tickets liés à la veille

**Endpoint** : `POST /api/robin`
| Action | Description |
|---|---|
| `research_topic` | Recherche sur un sujet |
| `track_competitors` | Analyse concurrentielle |
| `build_knowledge` | Indexe contenu dans Qdrant |
| `search_knowledge` | Recherche sémantique |
| `generate_report` | Rapport veille hebdomadaire |
| `research_ai_trends` | Tendances IA du marché |

**Tables** : `research_insights`, `alerts`
**APIs** : Qdrant (kr_knowledge), OpenRouter, Jina AI

---

### CHOPPER — Freelances & Support ✅

**task_type** : `support`
**Modules** (`src/lib/agents/chopper/`) :
- `freelance-evaluator.ts` — `evaluateAndRegister()`, `blacklistFreelance()`, `getAvailableFreelances()`
- `mission-manager.ts` — `createMission()`, `publishMission()`, `assignFreelance()`, `updateMissionStatus()`
- `contract-generator.ts` — `generateContract()`, `sendContract()`, `markContractSigned()`
- `escalation-manager.ts` — escalade tickets urgents vers Karim
- `faq-engine.ts` — base FAQ réponses automatiques
- `ticket-manager.ts` — `createTicket()`, `getOpenTickets()`, `updateTicketStatus()`

**Endpoint** : `POST /api/chopper`
| Action | Description |
|---|---|
| `create_mission` | Crée une mission freelance |
| `publish_mission` | Publie sur Upwork |
| `assign_freelance` | Assigne un freelance |
| `update_mission` | Met à jour statut mission |
| `evaluate` | Évalue et enregistre un freelance |
| `blacklist` | Blackliste un freelance |
| `generate_contract` | Génère NDA ou contrat mission |
| `send_contract` | Envoie le contrat (Resend) |
| `sign_contract` | Marque contrat signé |
| `answer_question` | Répond via FAQ |
| `create_ticket` | Crée ticket support |
| `resolve_ticket` | Résout un ticket |
| `escalate` | Escalade vers Karim |
| `get_open_tickets` | Liste tickets ouverts |
| `add_faq` | Ajoute entrée FAQ |

**Tables** : `freelances`, `missions`, `contracts`, `tickets`, `alerts`
**APIs** : Upwork, Resend

---

### TSUNADE — Finances avancées ✅

**task_type** : `finance`
**Modules** (`src/lib/agents/tsunade/`) :
- `expense-validator.ts` — `validateExpense()`, `decideExpense()`, `getPendingExpenses()`
- `dividend-calculator.ts` — `calculateDividends()`, `approveDividends()`, `markDividendsPaid()`

**Endpoint** : `POST /api/tsunade` / `GET /api/tsunade?type=pending|dividends`
| Action | Description |
|---|---|
| `validate_expense` | Valide une dépense (3 seuils) |
| `approve_expense` | Approuve/rejette une dépense pending |
| `get_pending` | Liste dépenses en attente |
| `calculate_dividends` | Calcule dividendes trimestriels |
| `approve_dividends` | Approuve la distribution |
| `mark_paid` | Marque dividendes payés |

**Seuils** : < 50€ auto-approuvé | 50-200€ logged | > 200€ email Karim requis
**UK Corp Tax** : 19% (≤ 50k£ annualisé) / marginal / 25% (≥ 250k£) — 20% retained earnings min
**Répartition dividendes** : Karim 50% / Raphaël 50%
**Tables** : `expense_validations`, `dividend_calculations`, `alerts`
**APIs** : Resend (email Karim sur > 200€)

---

### BROOK — Knowledge Base ✅

**task_type** : `knowledge`
**Modules** (`src/lib/agents/brook/`) :
- `knowledge-manager.ts` — `addDocument()`, `searchKnowledge()` (RAG), `getDocument()`, `listDocuments()`, `ragContext()`
- `prompt-archiver.ts` — `savePromptVersion()`, `getPromptHistory()`, `getActivePrompt()`, `rollback()`
- `template-manager.ts` — `getTemplate()`, `saveTemplate()`, `listTemplates()` (12 types)

**Endpoint** : `POST /api/brook` / `GET /api/brook?type=documents|templates|prompts`
| Action | Description |
|---|---|
| `add_document` | Indexe doc dans Supabase + Qdrant |
| `search_knowledge` | Recherche sémantique RAG |
| `get_document` | Récupère un document par ID |
| `list_documents` | Liste par catégorie |
| `get_template` | Récupère un template |
| `save_template` | Sauvegarde un template |
| `list_templates` | Liste tous les templates |
| `archive_prompt` | Archive version prompt agent |
| `get_prompt_history` | Historique versions prompt |
| `rollback_prompt` | Rollback vers version précédente |
| `answer_question` | Répond via RAG + LLM |

**Catégories** : `procedures` | `templates` | `decisions` | `prompts` | `guides`
**Templates disponibles** : email_welcome, email_followup, email_relance, email_onboarding, email_nps, contrat_nda, contrat_mission, brief_client, facture, rapport_mensuel, cold_email, cold_followup
**Tables** : `knowledge_documents`, `prompt_versions`, `alerts`
**APIs** : Qdrant (kr_knowledge, 1024d), Jina AI, OpenRouter

---

## 5. WORKFLOWS N8N — 21 ACTIFS

Instance : `https://primary-production-fbc07.up.railway.app`

| # | Workflow | Trigger | task_type → action | Slack |
|---|---|---|---|---|
| 1 | ZORO — Rapport comptable | 08h00 | accounting → generate_report | #depenses |
| 2 | HASHIRAMA — Rapport superviseur | 09h00 | accounting → generate_report | #general |
| 3 | NAMI — Onboarding client | Webhook `/nami/new-client-v2` | onboarding → send_welcome_email | #revenus |
| 4 | LUFFY — Surveillance inbox | Toutes les 15 min | email → process_email | #alertes |
| 5 | KILLUA — Prospecting quotidien | 10h00 | prospecting → run_campaign | #prospects |
| 6 | ITACHI — Contenu LinkedIn | 07h00 | marketing → generate_content | #contenu |
| 7 | ROBIN — Rapport veille hebdo | Lundi 06h30 | research → generate_report | #general |
| 8 | ROBIN — Tendances IA | 11h00 | research → research_ai_trends | #general |
| 9 | SANJI — Publication LinkedIn | 09h00 | social → publish_due | #contenu |
| 10 | SANJI — Publication Twitter | 12h00 | social → publish_due | #contenu |
| 11 | KILLUA — Scraping r/SaaS | 14h00 | prospecting → scrape_reddit | #prospects |
| 12 | KILLUA — Scraping r/smallbusiness | 15h00 | prospecting → scrape_reddit | #prospects |
| 13 | KILLUA — Scraping r/digitalnomad | 16h00 | prospecting → scrape_reddit | #prospects |
| 14 | KILLUA — Scraping r/freelance | 16h30 | prospecting → scrape_reddit | #prospects |
| 15 | CHOPPER — Check tickets ouverts | Toutes les 2h | support → get_open_tickets | #alertes |
| 16 | OROCHIMARU — Health check | Toutes les 6h | infrastructure → health_check | #erreurs |
| 17 | OROCHIMARU — Rapport santé | 06h00 | infrastructure → generate_health_report | #general |
| 18 | TSUNADE — Dividendes trimestriels | 07h00 (1er du mois) | finance → calculate_dividends | #revenus |
| 19 | TSUNADE — Dépenses en attente | Toutes les 4h | finance → get_pending | #depenses |
| 20 | BROOK — Indexation hebdomadaire | Lundi 07h30 | knowledge → weekly_index | #general |
| 21 | BROOK — Nouveau document | Webhook `/brook/document` | knowledge → add_document | #general |

**Redéploiement** :
```bash
doppler run --project kr-global-agents --config dev -- npx tsx scripts/deploy-n8n-workflows.ts
```

---

## 6. VARIABLES DOPPLER

Projet : `kr-global-agents` — Config : `dev` (synced → Vercel "Encrypted")

| Variable | Service | Statut |
|---|---|---|
| `INTERNAL_API_TOKEN` | Auth header toutes routes API | ✅ |
| `OPENROUTER_API_KEY` | OpenRouter LLM gateway | ✅ |
| `OPENROUTER_MODEL` | `google/gemini-2.0-flash-001` | ✅ |
| `SUPABASE_URL` | Supabase URL projet | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase clé service | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL publique client | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase clé anonyme client | ✅ |
| `APP_URL` | `https://kr-global-agents.vercel.app` | ✅ |
| `STRIPE_SECRET_KEY` | Stripe API | ✅ |
| `STRIPE_PUBLISHABLE_KEY` | Stripe front-end | ✅ |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature | ✅ |
| `NAMI_STRIPE_WEBHOOK_SECRET` | Webhook Stripe NAMI | ✅ |
| `RESEND_API_KEY` | Resend email transactionnel | ✅ |
| `ZOHO_CLIENT_ID` | Zoho Mail OAuth2 | ✅ |
| `ZOHO_CLIENT_SECRET` | Zoho Mail OAuth2 | ✅ |
| `ZOHO_REFRESH_TOKEN` | Zoho Mail OAuth2 | ✅ |
| `ZOHO_ACCOUNT_ID_` | Zoho Mail account ID | ✅ |
| `ZOHO_API_DOMAIN_` | Zoho Mail API domain | ✅ |
| `KR_EMAIL` | Adresse email KR Global | ✅ |
| `KARIM_EMAIL` | Email Karim (alertes TSUNADE > 200€) | ✅ |
| `R2_ACCOUNT_ID` | Cloudflare R2 | ✅ |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 | ✅ |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 | ✅ |
| `R2_BUCKET_NAME` | `kr-global-invoices` | ✅ |
| `R2_PUBLIC_URL` | URL publique R2 | ✅ |
| `APOLLO_API_KEY_` | Apollo.io prospecting | ✅ |
| `UPWORK_ACCESS_TOKEN` | Upwork freelances | ✅ |
| `LINKEDIN_ACCESS_TOKEN` | LinkedIn API | ⚠️ à renouveler |
| `LINKEDIN_AUTHOR_URN` | LinkedIn author URN | ✅ |
| `INSTAGRAM_ACCESS_TOKEN` | Instagram API | ⚠️ à renouveler |
| `INSTAGRAM_ACCOUNT_ID` | Instagram account ID | ✅ |
| `PUBLER_API_KEY` | Publer planification sociale | ✅ |
| `REPLICATE_API_KEY` | Génération images flux-pro | ✅ |
| `SANJI_WEBHOOK_SECRET` | Auth webhook `/api/sanji/publish` | ✅ |
| `SLACK_WEBHOOK` | Slack #general | ✅ |
| `SLACK_WEBHOOK_ALERTES` | Slack #alertes | ✅ |
| `SLACK_WEBHOOK_REVENUS` | Slack #revenus | ✅ |
| `SLACK_WEBHOOK_DEPENSES` | Slack #depenses | ✅ |
| `SLACK_WEBHOOK_ERREURS` | Slack #erreurs | ✅ |
| `SLACK_WEBHOOK_PROSPECTS` | Slack #prospects | ✅ |
| `SLACK_WEBHOOK_CONTENU` | Slack #contenu | ✅ |
| `TWILIO_ACCOUNT_SID` | Twilio SMS | ✅ |
| `TWILIO_AUTH_TOKEN` | Twilio SMS | ✅ |
| `TWILIO_PHONE_NUMBER` | Twilio expéditeur | ✅ |
| `QDRANT_URL` | Qdrant Cloud URL | ✅ |
| `QDRANT_API_KEY` | Qdrant Cloud clé | ✅ |
| `JINA_API_KEY` | Jina AI embeddings | ✅ |
| `N8N_URL` | `https://primary-production-fbc07.up.railway.app` | ✅ |
| `N8N_API_KEY` | n8n API REST key | ✅ |
| `NEXTAUTH_SECRET` | Clé NextAuth dashboard | ✅ |
| `NEXTAUTH_URL` | URL dashboard auth | ✅ |

---

## 7. URLS IMPORTANTES

| Ressource | URL |
|---|---|
| **Dashboard** | `https://kr-global-agents.vercel.app/dashboard` |
| **Chat** | `https://kr-global-agents.vercel.app/dashboard/chat` |
| **Login** | `https://kr-global-agents.vercel.app/login` |
| **API unifié** | `https://kr-global-agents.vercel.app/api/agent` |
| **n8n** | `https://primary-production-fbc07.up.railway.app` |
| **Supabase** | `https://supabase.com/dashboard/project/uqjliemmwqfzahzxialj` |
| **Doppler** | `https://dashboard.doppler.com/workplace/projects/kr-global-agents` |
| **Vercel** | `https://vercel.com/krgloballtd/kr-global-agents` |
| **GitHub** | `https://github.com/KRGlobalLTD/kr-global-agents` |

---

## 8. RÈGLES DU PROJET

### Workflow de développement

- **Un agent à la fois**, testé avant de passer au suivant
- **Push GitHub = déploiement automatique Vercel** (branch `main`)
- SQL exécuté **via MCP Supabase** (`apply_migration` pour DDL, project `uqjliemmwqfzahzxialj`)
- Secrets gérés dans **Doppler**, syncés vers Vercel en mode **"Encrypted"**
- Claude Code : toujours utiliser le mode **"accept edits"**
- **Ne pas relire les fichiers déjà en contexte** — utiliser offsets/limits si nécessaire

### Conventions TypeScript

- **Pas de `any`** — utiliser `unknown` avec cast explicite
- Pas de commentaires sauf WHY non-obvious
- Chaque node LangGraph retourne `Partial<KRGlobalStateType>`
- **Jamais throw** hors du node — toujours `return { status: 'failed', error: message }`
- **Logs systématiques** : `supabase.from('alerts').insert({ agent_name, level, message })`
- **Secrets** : uniquement via `process.env.*` — jamais hardcodés
- Headers HTTP : uniquement ASCII (pas de tirets longs, pas de chars > 255)

### Sécurité API

- Toutes les routes : `x-internal-token` via `verifyInternalToken(req)`
- SANJI publish : `x-sanji-secret` via `SANJI_WEBHOOK_SECRET`
- Webhook Stripe NAMI : signature HMAC `NAMI_STRIPE_WEBHOOK_SECRET`
- Dashboard : NextAuth email + password

### Infrastructure Qdrant — règles critiques

- **Collection `kr_knowledge`** : 1024 dimensions, `jina-embeddings-v3`
- **`ensureCollection`** : ignore 409 (collection déjà existante) — idempotent depuis mai 2026
- **Ne jamais** utiliser `jina-embeddings-v2-base-multilingual` — déprécié par Jina
- **Provider actif** : Jina AI si `JINA_API_KEY` présent, sinon OpenRouter (1536d)
- Si la collection doit être recrée : DELETE puis PUT via l'API Qdrant directement

### R2 et PDF — règles critiques

- Génération PDF : natif Node.js (pas de `@aws-sdk/client-s3` — non installé)
- Upload R2 : AWS Sig V4 manuel — pattern dans `src/lib/agents/zoro/invoice-generator.ts`
- Images sociales : upload vers `social-images/` dans le bucket R2

---

## 9. RÈGLE CRITIQUE — VALIDATION AVANT NEXT AGENT

**Format rapport obligatoire avant de passer à l'agent suivant :**

```
✅ Agent : NOM
✅ TypeScript : zéro erreur (npx tsc --noEmit)
✅ Endpoint : testé en live Vercel (curl + TOKEN Doppler)
✅ Workflow n8n : actif (X/21)
✅ Tables Supabase : créées via MCP apply_migration
→ PRÊT pour l'agent suivant
```

**En cas de blocage :**

```
❌ Agent : NOM
❌ Problème : description précise
🔧 Solution : étapes de résolution
🛠️ Outils nécessaires : liste
⏳ En attente de : action Karim (ex: créer compte LinkedIn)
```

---

## 10. ROADMAP

### Phase 1 — Infrastructure ✅ COMPLÈTE (mai 2026)

**13 agents opérationnels** — **21 workflows n8n** :

| Agent | Rôle | Statut |
|---|---|---|
| HASHIRAMA | Superviseur | ✅ |
| ZORO | Comptabilité UK | ✅ |
| NAMI | Onboarding clients | ✅ |
| LUFFY | Emails entrants | ✅ |
| KILLUA | Prospecting B2B | ✅ |
| ITACHI | Marketing & Contenu | ✅ |
| GARP | Reporting KPI | ✅ |
| SANJI | Réseaux sociaux (Publer) | ✅ |
| ROBIN | Veille & Research | ✅ |
| CHOPPER | Freelances & Support | ✅ |
| OROCHIMARU | Infrastructure & Health | ✅ |
| TSUNADE | Finances avancées | ✅ |
| BROOK | Knowledge Base & RAG | ✅ |

### Phase 2 — Agents 14-19 *(mois 2)*

- Analytics avancés (SEO, dashboards comportementaux)
- Agents Maroc (arabe + darija)
- Agents France (conformité RGPD)
- Agent Pricing dynamique

### Phase 3 — Agents 20-24 *(mois 3)*

- Agents spécialisés par verticale (SaaS, e-commerce, immobilier)
- Agent Client Success
- Agent Upsell automatisé

### Phase 4 — Agents 25-27 *(mois 4-5)*

- Agents partenaires
- Agent White Label
- Agent Reporting exécutif + intégrations ERP

### Phase 5 — Agent 28 + SaaS *(mois 6)*

- Agent SaaS orchestrateur multi-tenant
- Lancement produit SaaS : objectif 5 000 €/mois récurrents
- Expansion Maroc + France opérationnelle

---

## 11. COMMENT CONSTRUIRE UN NOUVEL AGENT

### Étapes dans l'ordre

**1. Vérifier ce qui existe**
```bash
find src -name "*<nom>*" 2>/dev/null
ls src/lib/agents/<nom>/ 2>/dev/null
```

**2. Modules métier**
```bash
mkdir src/lib/agents/<nom>/
# Créer : <action1>.ts, <action2>.ts, etc.
# Exporter des fonctions async typées — pas de throw, retourner les erreurs
```

**3. Schema SQL (via MCP Supabase)**
```
Tool: mcp__claude_ai_Supabase__apply_migration
project_id: uqjliemmwqfzahzxialj
name: <nom>_schema
query: CREATE TABLE IF NOT EXISTS ...
```

**4. LangChain chain**
```typescript
// src/lib/langchain/chains/<nom>-chain.ts
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser }  from '@langchain/core/output_parsers';
import { getLLM } from '../llm';

const prompt = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  ['human', '{input}'],
]);

export const <nom>Chain = prompt.pipe(getLLM(false)).pipe(new StringOutputParser());
```

**5. Node LangGraph**
```typescript
// src/lib/langgraph/agents/<nom>.ts
export async function <nom>Node(state: KRGlobalStateType): Promise<Partial<KRGlobalStateType>> {
  const action = state.task_input['action'] as string;
  try {
    if (action === 'mon_action') {
      const result = await maFonction();
      return { agent_name: 'NOM', status: 'completed', task_result: result, error: null };
    }
    throw new Error(`Action inconnue : ${action}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from('alerts').insert({ agent_name: 'NOM', level: 'WARNING', message });
    return { agent_name: 'NOM', status: 'failed', error: message };
  }
}
```

**6. Brancher dans supervisor.ts**
```typescript
// state.ts : ajouter '<task_type>' dans TaskType
// supervisor.ts :
import { <nom>Node } from './agents/<nom>';
// TASK_AGENT : { '<task_type>': '<nom>' }
// .addNode('<nom>', <nom>Node)
// .addConditionalEdges : ajouter '<nom>': '<nom>'
// .addEdge('<nom>', END)
```

**7. Route API dédiée**
```typescript
// src/app/api/<nom>/route.ts
function verifyInternalToken(req: NextRequest): boolean {
  return req.headers.get('x-internal-token') === process.env.INTERNAL_API_TOKEN;
}
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyInternalToken(req)) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  // switch(action) → appel modules
}
```

**8. Variables Doppler**
```bash
doppler secrets set MA_CLE="valeur" --project kr-global-agents --config dev
# Syncer depuis dashboard Doppler → Vercel (mode Encrypted)
```

**9. Workflows n8n**
```typescript
// Ajouter dans scripts/deploy-n8n-workflows.ts → array WORKFLOWS
buildWorkflow({
  name:       'NOM — Description (heure)',
  trigger:    scheduleTrigger(HH, MM),   // ou webhookTrigger('chemin')
  taskType:   '<task_type>',
  taskInput:  { action: '<action>' },
  slackUrl:   SLACK.canal,
  agentLabel: 'NOM / Description',
})
// Puis redéployer :
// doppler run --project kr-global-agents --config dev -- npx tsx scripts/deploy-n8n-workflows.ts
```

**10. Validation et push**
```bash
npx tsc --noEmit          # Zéro erreur obligatoire
git add -A && git commit -m "feat: NOM — description" && git push
# Attendre ~30-60s (Vercel auto-deploy)
# Tester en live :
TOKEN=$(doppler secrets get INTERNAL_API_TOKEN --plain --project kr-global-agents --config dev)
curl -s -X POST https://kr-global-agents.vercel.app/api/<nom> \
  -H "x-internal-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"mon_action"}'
```

---

## 12. HISTORIQUE DES DÉCISIONS

| Date | Décision | Raison |
|---|---|---|
| Avril 2026 | Architecture LangGraph + LangChain | Orchestration agents complexes, état partagé typé |
| Avril 2026 | n8n sur Railway (vs Make.com) | Plus flexible, auto-hébergé, pas de limites opérations |
| Avril 2026 | Qdrant Cloud London | Mémoire vectorielle longue durée, RGPD, faible latence UK |
| Avril 2026 | Jina AI pour embeddings | Multilingue FR/EN/AR, 1024d, plan gratuit |
| Avril 2026 | Publer API pour SANJI | Planification multi-réseau, analytics intégrés, 6 plateformes |
| Avril 2026 | Replicate flux-pro pour images | Qualité professionnelle, pay-per-use, pas de GPU à gérer |
| Avril 2026 | Dashboard PWA NextAuth | Accès sécurisé Karim + Raphaël, supervision ~1h/jour |
| Mai 2026 | Migration Jina v2 → v3 | `jina-embeddings-v2-base-multilingual` déprécié, v3 = 1024d |
| Mai 2026 | BROOK knowledge base | Centralisation documentation, RAG, versioning prompts agents |
| Mai 2026 | R2 upload natif Sig V4 | `@aws-sdk/client-s3` non installé — pattern crypto Node.js réutilisé depuis ZORO |
| Mai 2026 | `ensureCollection` idempotent | Évite crash 409 Qdrant quand collection déjà créée |
| Mai 2026 | KILLUA : `run_campaign` vs `scrape_leads` | `scrape_leads` nécessite `campaign_id`, `run_campaign` gère le cycle complet |

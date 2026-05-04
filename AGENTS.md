<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# KR Global Solutions Ltd — Architecture V4

## Stack technique cible

| Couche | Outil | Rôle |
|---|---|---|
| Déclencheur | **n8n** | Workflows automatisés (remplace Make.com) |
| Orchestration | **LangGraph** | Graph multi-agents, routing conditionnel |
| Logique agents | **LangChain** | Chains, tools, prompts internes |
| Mémoire | **Qdrant** | Mémoire vectorielle, RAG, contexte clients |
| Base de données | **Supabase** | Leads, clients, ventes, logs |
| Frontend / API | **Next.js 16** | App Router + API routes |
| Déploiement | **Vercel** | CI/CD automatique depuis main |
| Secrets | **Doppler** | Projet `kr-global-agents`, env `dev` / `prd` |

## LLM & APIs

- **Modèle principal** : `google/gemini-2.0-flash` via OpenRouter (`https://openrouter.ai/api/v1`)
- **OpenRouter key** : `OPENROUTER_API_KEY` (Doppler)
- **Auth API interne** : header `x-internal-token: INTERNAL_API_TOKEN`

## Agents construits

| Agent | Domaine | Statut | Route API |
|---|---|---|---|
| **HASHIRAMA** | Superviseur LangGraph | ✅ Complet | `POST /api/agent` |
| **ZORO** | Comptabilité UK, factures, Stripe | ✅ Complet | `task_type: accounting` |
| **NAMI** | Onboarding clients, emails, contrats | ✅ Complet | `task_type: onboarding` |
| **LUFFY** | Emails entrants, classification, routing | ✅ Complet | `task_type: email` |
| **KILLUA** | Prospecting, Apollo, cold email | ✅ Complet | `task_type: prospecting` |
| **ITACHI** | Marketing, LinkedIn/Twitter/blog | ✅ Complet + LangGraph | `task_type: marketing` |

## Structure fichiers LangGraph

```
src/lib/langgraph/
  state.ts          — KRGlobalState (task_type, task_input, task_result, agent_name, status, error, messages, metadata)
  openrouter.ts     — Utilitaire fetch OpenRouter partagé
  supervisor.ts     — HASHIRAMA : StateGraph + routing conditionnel + runGraph()
  agents/
    zoro.ts         — Node ZORO (track_cost, generate_report, sync_stripe, generate_invoice)
    nami.ts         — Node NAMI (send_welcome_email, generate_contract, payment_confirmed)
    luffy.ts        — Node LUFFY (process_email, classify_email, route_to_agent)
    killua.ts       — Node KILLUA (scrape_leads, send_outreach, track_prospect)
    itachi.ts       — Node ITACHI (generate_content, schedule_post, track_performance)
```

## Endpoint API unifié

```
POST /api/agent
Headers : x-internal-token: <INTERNAL_API_TOKEN>
Body    : { task_type, task_input, metadata? }

task_type → agent :
  accounting   → ZORO
  onboarding   → NAMI
  email        → LUFFY
  prospecting  → KILLUA
  marketing    → ITACHI
```

## Migration en cours

| Semaine | Chantier | Statut |
|---|---|---|
| S1 | LangGraph — migration tous agents | 🔄 En cours |
| S2 | n8n — remplacement Make.com | ⏳ Planifié |
| S3 | Qdrant — mémoire vectorielle | ⏳ Planifié |
| S4 | LangChain — logique interne agents | ⏳ Planifié |

## Roadmap

- **28 agents** total planifiés
- **Expansion géographique** : Maroc + France
- **SaaS** : lancement prévu mois 6

## Conventions de code

- TypeScript strict — pas de `any`, préférer `unknown` avec cast explicite
- Pas de commentaires sauf si le WHY est non-obvious
- Chaque agent node retourne `Partial<KRGlobalStateType>`
- Errors : toujours retourner `{ status: 'failed', error: message }` — jamais throw hors du node
- Logs : toujours écrire dans `supabase.from('alerts')` avec `agent_name` + `level` + `message`
- Secrets : lire depuis `process.env.*` uniquement — jamais hardcoder

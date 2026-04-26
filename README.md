# whatsapp-agent

Self-hosted WhatsApp dashboard with Shopify order follow-up and an OpenRouter-powered conversational agent.

> **Heads-up:** this project uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial WhatsApp Web client. Connecting your number violates WhatsApp's Terms of Service and carries a real risk of account ban. Use with a dedicated business number you can afford to lose, and stay at low volume.

## Features

- **Link a WhatsApp number** via QR (Baileys multi-device, auth state encrypted in Postgres).
- **WhatsApp Web–style inbox**: live chat list and conversation pane, real-time updates over SSE.
- **Shared team account**: any logged-in user (email + password) can read and reply.
- **Reusable templates** with `{{variable}}` substitution.
- **Shopify follow-up**: `orders/create` webhook → schedules a follow-up message after a configurable delay if the customer hasn't replied.
- **Conversational agent** powered by OpenRouter:
  - Configurable system prompt and model.
  - Memory: last N messages of the conversation.
  - **Debounce / desfase**: messages from the same contact arriving within a configurable window are batched into a single LLM call.
- **Open source**, MIT license.

## Architecture

```
apps/web   — Next.js 16 App Router dashboard, Auth.js (credentials).        Vercel
apps/worker — Hono + Baileys + pg-boss, owns the WhatsApp WebSocket.        Railway
packages/db — Drizzle ORM schema and migrations.                            Postgres (Railway)
packages/shared — Zod schemas and types shared between web and worker.
```

```
   Browser ──HTTPS──► Vercel (Next.js)
                        │       │
                        │       └─SSE proxy─► Railway worker ──► WhatsApp WebSocket
                        │                       │  ▲
                        └────HTTPS (Bearer)─────┘  └── Shopify webhook (HMAC)
                                                   │
                                                   ▼
                                       Postgres (Railway)
```

The worker runs as a long-lived Node service so the Baileys WebSocket stays open. Vercel proxies `/api/*` to the worker with a shared bearer token; SSE is also proxied, so the browser only ever talks to the Vercel domain.

## Local development

Requirements: Node 22+, pnpm 10+, a Postgres 14+ instance.

```bash
# 1. Clone & install
git clone https://github.com/<you>/whatsapp-agent
cd whatsapp-agent
pnpm install

# 2. Configure
cp .env.example .env
#   - DATABASE_URL=postgresql://...
#   - WORKER_API_TOKEN=$(openssl rand -hex 32)
#   - WA_AUTH_KEY=$(openssl rand -base64 32)
#   - AUTH_SECRET=$(openssl rand -base64 32)
#   - OPENROUTER_API_KEY=sk-or-v1-...
#   - SHOPIFY_WEBHOOK_SECRET=...

# 3. Apply schema and seed admin user
pnpm db:push
pnpm db:seed   # prints generated admin password

# 4. Run web (3000) + worker (3001)
pnpm dev
```

Open http://localhost:3000, log in with the seeded credentials, go to **Conexión** and scan the QR.

### Useful scripts

| | |
|---|---|
| `pnpm dev` | Run web and worker in parallel |
| `pnpm dev:web` / `pnpm dev:worker` | Run one at a time |
| `pnpm db:generate` | Create a new migration from schema changes |
| `pnpm db:push` | Apply schema to the DB without a migration file |
| `pnpm db:migrate` | Apply generated migrations |
| `pnpm db:seed` | Seed admin user, default templates, and agent settings |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm typecheck` | Typecheck every workspace |
| `pnpm build` | Production build (web + worker) |

## Deployment

### 1. Postgres (Railway)

Add a Postgres plugin in Railway. Note the `DATABASE_URL`.

### 2. Worker (Railway)

- Create a new Railway service from the same GitHub repo.
- Root directory: repo root (Railway will read `railway.json`).
- Environment variables:
  - `DATABASE_URL`
  - `PORT` (Railway sets this automatically)
  - `WEB_ORIGIN=https://<your-vercel-app>.vercel.app`
  - `WORKER_API_TOKEN` (shared with Vercel)
  - `WA_AUTH_KEY` (32 random bytes, base64)
  - `OPENROUTER_API_KEY`
  - `SHOPIFY_WEBHOOK_SECRET`
  - `LOG_LEVEL=info`
- Apply migrations once: `pnpm db:push` against the production `DATABASE_URL` (run from your machine).

### 3. Web (Vercel)

- Import the repo into Vercel.
- **Root Directory:** `apps/web` (Vercel reads `apps/web/vercel.json`, which calls `pnpm` at the monorepo root).
- Environment variables:
  - `DATABASE_URL`
  - `AUTH_SECRET`
  - `WORKER_URL=https://<railway-worker>.up.railway.app`
  - `NEXT_PUBLIC_WORKER_URL` (same value)
  - `WORKER_API_TOKEN`

### 4. Shopify webhook

In your Shopify admin → Settings → Notifications → Webhooks, add:

- Event: **Order creation**
- Format: JSON
- URL: `https://<railway-worker>.up.railway.app/shopify/webhook`
- Use the same `SHOPIFY_WEBHOOK_SECRET` configured on the worker.

## How the agent works

1. A message arrives for a contact whose `agent_mode` is `true`.
2. The worker pushes it into an in-memory buffer keyed by contact and (re)starts a debounce timer (`agent_settings.debounce_ms`).
3. When the timer fires, the worker:
   - Loads the last `memory_window` messages of the conversation.
   - Calls OpenRouter (`agent_settings.model`) with the system prompt and the chat history.
   - Sends the model's reply back over WhatsApp, with a brief simulated typing pause.
   - Records the run in `agent_runs` (prompt, response, tokens) for audit.

A contact enters `agent_mode` automatically when:

- The Shopify follow-up fires (no response from the customer after `followup_delay_ms`), OR
- The customer replies to the first confirmation message AND `activate_agent_on_confirm` is enabled, OR
- A user toggles "Agente: ON" from the inbox.

## Risks of unofficial WhatsApp clients

Baileys is reverse-engineered. Meta actively detects unofficial clients and may:

- Show "your account may be at risk" warnings.
- Permanently ban the number with no appeal.
- Break the protocol unannounced (Baileys then needs to update).

If you need a guaranteed channel, migrate to the official **WhatsApp Cloud API**. The worker contract (send/receive, status, events) is small enough that a Cloud API adapter can replace Baileys without touching the dashboard.

## License

MIT — see [LICENSE](./LICENSE).

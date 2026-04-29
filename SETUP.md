# AgriCycle — Local Setup Guide

This guide walks you through running **AgriCycle** on your own machine after
exporting the project as a ZIP from Replit.

The Replit environment automatically provides a managed PostgreSQL database and
some environment secrets. Outside Replit you must provide them yourself.
The biggest one is the **database** — without it the API server will not start.

---

## 1. Prerequisites

Install these on your laptop first:

| Tool          | Version    | Why                                                   |
| ------------- | ---------- | ----------------------------------------------------- |
| **Node.js**   | 20 or 22   | Runtime for both the React app and the Express API    |
| **pnpm**      | 9 or 10    | Workspace package manager (this is a pnpm monorepo)   |
| **Git**       | any        | Optional, but recommended                              |

Install pnpm globally once:

```bash
npm install -g pnpm
```

Verify everything:

```bash
node -v     # should print v20.x or v22.x
pnpm -v     # should print 9.x or 10.x
```

---

## 2. Install dependencies

From the **project root** (the folder that contains `pnpm-workspace.yaml`):

```bash
pnpm install
```

This installs every package across the monorepo (`artifacts/agricycle`,
`artifacts/api-server`, `lib/db`, etc.) in one go.

---

## 3. Pick a PostgreSQL database

The project uses **PostgreSQL** with **Drizzle ORM**. You have three options —
**Option A is by far the easiest** if you have never set up a database before.

### Option A — Neon (recommended, no install, free)

[Neon](https://neon.tech) gives you a free serverless PostgreSQL database in
under a minute. Nothing to install on your computer.

1. Go to <https://neon.tech> and sign up (Google / GitHub login is fine).
2. Click **"Create project"** — defaults are OK (region = closest to you,
   Postgres 16+).
3. On the project dashboard, copy the **connection string** that looks like:
   ```
   postgresql://USER:PASSWORD@ep-xxxxx.region.aws.neon.tech/neondb?sslmode=require
   ```
4. Save it — you will paste it into `.env` in step 4.

### Option B — Local PostgreSQL via Docker

If you already have Docker Desktop installed:

```bash
docker run --name agricycle-pg \
  -e POSTGRES_PASSWORD=agricycle \
  -e POSTGRES_DB=agricycle \
  -p 5432:5432 \
  -d postgres:16
```

Connection string:

```
postgresql://postgres:agricycle@localhost:5432/agricycle
```

To stop / restart later:

```bash
docker stop  agricycle-pg
docker start agricycle-pg
```

### Option C — Native PostgreSQL install

Install PostgreSQL 14+ from <https://www.postgresql.org/download/>, then create
a database:

```bash
createdb agricycle
```

Connection string (adjust user/password):

```
postgresql://postgres:YOUR_PASSWORD@localhost:5432/agricycle
```

---

## 4. Create your `.env` file

Create a file called **`.env`** in the **project root** with the following
contents. Replace the database URL with the one from step 3.

```bash
# ─── Required ──────────────────────────────────────────────
# PostgreSQL connection string from step 3
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME

# Google Gemini API key for crop residue image analysis.
# Get one free at https://aistudio.google.com/app/apikey
GOOGLE_API_KEY=your_gemini_api_key_here

# ─── Optional ──────────────────────────────────────────────
# Port the API server listens on (defaults to 8080)
PORT=8080

# Web Push (browser notifications) — leave blank to disable
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
```

> **Tip:** Most shells and Node tooling auto-load `.env` from the current
> working directory. If yours does not, install `dotenv-cli` once
> (`pnpm add -wD dotenv-cli`) and prefix commands with
> `pnpm dotenv -- <command>`.

---

## 5. Create the database tables

The schema lives in `lib/db/src/schema/`. Push it to your database:

```bash
pnpm --filter @workspace/db push
```

If that command asks you to confirm destructive changes (it usually won't on a
fresh database), use:

```bash
pnpm --filter @workspace/db push-force
```

You should see Drizzle creating tables like `users`, `pickup_requests`,
`factory_demands`, `negotiations`, `load_offers`, `notifications`, etc.

---

## 6. Start the app

You need **two terminals** running side-by-side.

**Terminal 1 — API server (port 8080):**
```bash
pnpm --filter @workspace/api-server run dev
```

**Terminal 2 — Web app (Vite dev server):**
```bash
pnpm --filter @workspace/agricycle run dev
```

Vite will print a local URL (usually <http://localhost:5173/agricycle>).
Open it in your browser.

---

## 7. First login

The app uses phone + password authentication. Use the **Sign up** screen to
create your first account (try roles: farmer, aggregator, factory). Data lives
in your own PostgreSQL database, so each role you create is yours alone.

---

## Common issues

| Error                                                          | Fix                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL must be set...`                                   | Your `.env` file is missing or in the wrong folder. Put it in the project root.      |
| `password authentication failed for user "postgres"`            | Wrong password in the connection string. Double-check step 3.                         |
| `relation "users" does not exist`                               | You skipped `pnpm --filter @workspace/db push`.                                      |
| `Server is missing GOOGLE_API_KEY`                              | Add `GOOGLE_API_KEY` to `.env` (see step 4).                                         |
| `EADDRINUSE: address already in use :::8080`                    | Another app is using port 8080. Set `PORT=8090` in `.env`.                           |
| Browser shows the page but API calls fail with CORS / 404       | Make sure **both** terminals from step 6 are running.                                |

---

## Project layout (quick reference)

```
.
├── artifacts/
│   ├── agricycle/        # React + Vite frontend
│   ├── api-server/       # Express 5 REST API
│   └── mockup-sandbox/   # (dev only — UI variant playground)
├── lib/
│   └── db/               # Drizzle ORM schema + connection pool
├── SETUP.md              # ← this file
├── package.json
├── pnpm-workspace.yaml
└── replit.md             # Notes specific to the Replit environment
```

That's it. Once steps 1 → 6 are done you have a fully working local copy of
AgriCycle, identical to what runs on Replit.

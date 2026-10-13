# Whisper

Push-to-talk voice dictation for the team. Hold a shortcut anywhere on your
computer, speak, let go — what you said is typed into whatever app you were
using. Gmail, Slack, Notion, your IDE, anywhere a cursor blinks.

> **Internal use only.** The installer is unsigned and distribution is through
> our private GitHub repo. Do not distribute outside the team.

## How it's put together

Two deployables, one repository, shared types so they cannot drift:

```
shared/   @whisper/shared  — the wire contract (Session, Settings, Profile, …)
server/   @whisper/server  — Fastify API: auth, per-user data, AI proxy.
                             Runs on our infra next to Postgres. Holds ALL secrets.
app/      @whisper/app     — Electron desktop client (React + Tailwind).
                             Talks ONLY to our API over HTTPS. Contains NO keys.
```

The dictation pipeline lives server-side (`POST /dictate`): the client uploads
finished WAV audio; the server transcribes it (Groq Whisper, OpenAI-compatible
— switching providers is an env var), filters Whisper's silence
hallucinations, optionally polishes the text with an instruct LLM, stores a
history row (unless the user turned that off) and returns the final text. The
client puts it on the clipboard, pastes it, and restores your old clipboard
afterwards.

## Prerequisites

- **Node 22.12+** (24 LTS recommended) and npm 10+
- **Docker** (for local Postgres / deployment) — *or* any Postgres 13+
- A **Groq API key** (free tier works): <https://console.groq.com>

## Backend — local development

```bash
npm install                          # once, at the repo root

cp server/.env.example server/.env   # then edit:
#   GROQ_API_KEY=gsk_...
#   JWT_ACCESS_SECRET / JWT_REFRESH_SECRET  (openssl rand -hex 32, two DIFFERENT values)

docker compose up -d db              # Postgres 17 on localhost:5432
npm run migrate                      # applies server/migrations/*.sql (idempotent)

# First admin — this replaces any sign-up flow; there is none by design:
npm run create-user -- --email you@omadligroup.com --password temp1234 --name "Your Name" --admin

npm run dev:server                   # API on http://localhost:8080
```

Verify it end to end (health, login, refresh rotation, a real `/dictate` call
with generated audio, stats):

```bash
npm run smoke -- --url http://localhost:8080 --email you@omadligroup.com --password temp1234
```

To verify just the AI half (key validity, live model IDs, transcription and
cleanup params) without Postgres:

```bash
npm run groq-check --workspace @whisper/server
```

Add teammates the same way (`create-user` without `--admin`), or from the
app's **Settings → Team** panel once you're signed in as an admin.

## Backend — deploying on Coolify

1. **Create the app** from this repo. Build pack: *Dockerfile*. The Dockerfile
   is at the **repo root**, so Coolify's defaults are already right:
   Base Directory `/`, Dockerfile Location `/Dockerfile`.
2. **Attach Postgres**: add a Coolify Postgres resource (17-alpine), copy its
   internal connection string.
3. **Set the environment variables** from `server/.env.example`:
   `DATABASE_URL`, `GROQ_API_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
   `TRANSCRIPTION_PROVIDER=groq`, `PORT=8080`, `CORS_ORIGIN=*`. Set
   `DATABASE_SSL=true` only if your Postgres requires TLS.
4. **Expose it** at your domain (e.g. `https://whisper.agent.omadligrouphq.com`) — Coolify
   terminates TLS. Health check path: `/health`.
5. **Run the migration once** (container terminal):
   `node server/dist/cli/migrate.js`
6. **Create the admin** (same terminal):
   `node server/dist/cli/create-user.js --email you@omadligroup.com --password temp1234 --admin`

Model IDs are pinned but overridable via env (`CLEANUP_MODEL`, …). The API
logs a warning at boot when a configured model vanishes from the provider's
list — Groq deprecates on short windows, so glance at
<https://console.groq.com/docs/deprecations> before releases.

## Desktop app — development

```bash
cp app/.env.example app/.env         # VITE_API_URL=http://localhost:8080
npm run dev:app                      # electron-vite dev (launches Electron)
```

First sign-in walks through onboarding (mic check → hotkey → writing style).
The app then lives in the tray: **hold Left Ctrl + Win** anywhere to dictate
(configurable in Settings, hold- and toggle-style combos both work). Esc
always stops a stuck recording; clicking the dashboard's dictation bar stops a
hotkey recording too.

## Desktop app — building & releasing

```bash
npm run build:icons --workspace @whisper/app   # regenerate icons from build/icon-source.svg
cd app && npm run build:win                    # unsigned NSIS installer → app/release/
```

macOS builds must be made on a Mac (`npm run build:mac` → .dmg for arm64 and
x64). Step-by-step build, share and install instructions, including the
Gatekeeper approval and permission prompts, are in [docs/MACOS-GUIDE.md](docs/MACOS-GUIDE.md).

Releases go to the public [teamz88/whisper-releases](https://github.com/teamz88/whisper-releases)
repo. It holds release files only; the source stays here. Teammates download
installers from it, and installed apps check it for updates without a token.

1. Put a `GH_TOKEN` (classic PAT with write access to
   `teamz88/whisper-releases`) in `app/.env`. Only the person cutting releases
   needs it.
2. Bump `version` in `app/package.json`.
3. `cd app && npm run release` for Windows, and `npm run release:mac` on an
   Apple Silicon Mac. Both upload to the same draft release, `v<version>`.
4. Open the draft on GitHub, check the files, and publish it. Installed apps
   only see published releases.

Installed apps check for updates 8 s after launch and hourly, download in the
background, and install only when the user clicks **Restart now**. On macOS
the updater needs a signed app, so Mac users install new versions by hand
from the releases page.

> No code signing: Windows SmartScreen will warn on first run —
> "More info → Run anyway". Expected for internal tooling.

## Verification status

- `tsc --noEmit` clean on all three packages (`npm run typecheck` at the root)
- `electron-vite build` clean (`npm run build`)
- Groq live check passed (`npm run groq-check`): key, model IDs, transcription
  params, cleanup + NO_SPEECH sentinel
- Server smoke test: `npm run smoke` (needs a running API + Postgres)

## Repo scripts (root)

| Command                 | What it does                                    |
| ----------------------- | ----------------------------------------------- |
| `npm run typecheck`     | builds `shared`, typechecks all three packages  |
| `npm run build`         | builds shared → server → app                    |
| `npm run dev:server`    | API with hot reload (tsx watch)                 |
| `npm run dev:app`       | Electron app with HMR                           |
| `npm run migrate`       | apply SQL migrations                            |
| `npm run create-user`   | add a user (see above)                          |
| `npm run smoke`         | end-to-end API smoke test                       |

## Security model, in one paragraph

Clients never see a database or a provider key. The desktop app authenticates
with email + password against `/auth/login`, holds a ~1 h access token and a
30-day refresh token (rotated on every refresh; only a SHA-256 hash of it is
stored server-side), and calls `/me/*` endpoints that are scoped to the token's
user id — that scoping *is* the row-level security. Admin routes check the
role claim server-side. Deactivating a user revokes their refresh tokens
immediately. The only secret-adjacent thing in the client is `VITE_API_URL`,
which is just a public URL.

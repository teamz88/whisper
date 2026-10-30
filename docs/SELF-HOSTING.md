# Run Whisper on your own server

Whisper has two parts: the **app** on everyone's computer, and a small **server**
that turns speech into text and keeps your history. This guide sets up your own
server, so your team's dictations never touch anyone else's infrastructure, and
then connects the app to it.

You do not need to be a developer. You will copy and paste about ten commands.
Allow **about an hour** the first time, most of it waiting for things to install.

**Contents**

1. [What you need](#1-what-you-need)
2. [Get a Groq key](#2-get-a-groq-key-free)
3. [Create the server](#3-create-the-server)
4. [Point your domain at it](#4-point-your-domain-at-it)
5. [Connect to the server](#5-connect-to-the-server)
6. [Install Docker and download Whisper](#6-install-docker-and-download-whisper)
7. [Create your settings file](#7-create-your-settings-file)
8. [Start Whisper](#8-start-whisper)
9. [Create the first admin account](#9-create-the-first-admin-account)
10. [Install the app and connect it](#10-install-the-app-and-connect-it)
11. [Add your teammates](#11-add-your-teammates)
12. [Updating, backups, removing](#12-updating-backups-removing)
13. [Where your data lives](#13-where-your-data-lives)
14. [If something goes wrong](#14-if-something-goes-wrong)

---

## 1. What you need

| Thing | What it is | Cost |
|---|---|---|
| A **server** | A small rented computer that is always on (a "VPS"). Ubuntu 24.04, **2 GB of memory or more**. Hetzner, DigitalOcean, Contabo and many others rent them. | about $5–10 a month |
| A **domain name** | A web address like `whisper.yourcompany.com`. You can use a subdomain of a domain you already own. | usually $10–15 a year, or free if you own one |
| A **Groq account** | Groq does the speech recognition. The free plan works for small teams. | free |
| A computer | To follow this guide and to install the app (Windows 10/11, or a Mac with Apple Silicon). | — |

Keep a text file open while you work. You will collect a few values (server
address, keys, passwords) and you need them again later.

## 2. Get a Groq key (free)

1. Go to <https://console.groq.com> and create an account.
2. Open **API Keys** → **Create API Key**. Name it `whisper`.
3. Copy the key (it starts with `gsk_`). **It is shown only once.** Paste it into
   your text file.

> The free plan has usage limits. For a small team that is normally enough. If
> people later see "rate limited" errors, upgrade the plan in the Groq console.

**Privacy tip:** in the Groq console open **Settings → Data Controls** and read
the options about data retention. See [section 13](#13-where-your-data-lives).

## 3. Create the server

At your provider (Hetzner, DigitalOcean, …):

1. Create a new server ("droplet", "instance", "VPS": the word varies).
2. Choose **Ubuntu 24.04**, **2 GB memory or more**.
3. If it asks how to log in, choose **password** (simplest). Write the password
   in your text file. Some providers email it to you instead.
4. When it is ready, copy its **IP address** (four numbers like `203.0.113.10`).
5. If your provider has a **firewall** setting, allow incoming traffic on ports
   **22, 80 and 443**. Many providers allow everything by default. If yours does
   not, Whisper will not be reachable until you open them.

## 4. Point your domain at it

At the company where you bought the domain, open the **DNS** settings and add
one record:

| Type | Name | Value |
|---|---|---|
| `A` | `whisper` (or whatever subdomain you want) | your server's IP address |

Your address is then `whisper.yourcompany.com`. If you want the bare domain
(`yourcompany.com`), use `@` as the name.

It can take a few minutes, sometimes an hour, to take effect. You can check at
<https://dnschecker.org>: enter your address and look for your server's IP.
**Do not continue until it shows your IP**, because the secure (HTTPS) certificate
in step 8 needs it.

## 5. Connect to the server

You control the server by typing commands into it from your own computer.

- **Windows:** press the Windows key, type `PowerShell`, press Enter.
- **Mac:** open **Terminal** (Spotlight → "Terminal").

Type this, replacing the numbers with your server's IP, and press Enter:

```bash
ssh root@203.0.113.10
```

The first time it asks `Are you sure you want to continue connecting?`: type
`yes` and press Enter. Then enter the server password. **Typing a password shows
nothing on screen. That is normal.** When you see a prompt such as
`root@whisper:~#`, you are inside the server. Every command below is typed there.

> Some providers use a different user than `root` (the welcome email says which).
> If so, put `sudo ` in front of the commands that need it.

## 6. Install Docker and download Whisper

Docker is the program that runs Whisper. Paste these one at a time:

```bash
curl -fsSL https://get.docker.com | sh
```
(takes a minute or two; lots of text scrolls past, that is fine)

```bash
apt install -y git
```

```bash
git clone https://github.com/teamz88/whisper.git
```

```bash
cd whisper/selfhost
```

You are now in the folder with Whisper's server files.

## 7. Create your settings file

Whisper reads its settings from a file called `.env`. It holds your keys, so
keep it private. There are two ways to create it; use whichever you prefer.

### Option A — answer two questions (recommended)

```bash
./setup.sh
```

It asks for your **domain** (for example `whisper.yourcompany.com`, no
`https://`) and your **Groq key**, creates the secret passwords itself, and
saves everything. Skip to [step 8](#8-start-whisper).

### Option B — fill it in by hand

```bash
cp .env.example .env
nano .env
```

This opens a simple text editor. Move with the arrow keys and fill in each line
after the `=` sign, with no spaces and no quotes:

| Line | What to put |
|---|---|
| `DOMAIN` | Your address **without** `https://`, e.g. `whisper.yourcompany.com` |
| `GROQ_API_KEY` | The key from step 2 (`gsk_…`) |
| `POSTGRES_PASSWORD` | A random password for the database. Create one (see below) |
| `JWT_ACCESS_SECRET` | A random secret. Create one (see below) |
| `JWT_REFRESH_SECRET` | **A different** random secret. Create one (see below) |

To create a random value, type this command and copy the result into the file.
Run it **three times**, once for each of the three lines above:

```bash
openssl rand -hex 32
```

Use a **different** value for each line. The two `JWT_…` secrets in particular
must not match, or Whisper refuses to start. Use only the letters and numbers
the command prints.

To save and leave the editor: press **Ctrl+O**, then **Enter**, then **Ctrl+X**.

> The `JWT_…` secrets sign people's sign-in. **Never** share them or put them
> online. Whoever has them could sign in as anyone.

## 8. Start Whisper

```bash
docker compose up -d --build
```

The first run builds Whisper and downloads its parts: **expect 3–10 minutes**.
When the prompt comes back, check it is running:

```bash
docker compose ps
```

You should see three lines (`db`, `api`, `caddy`) with the status **running** (or
**healthy**). Now open your address in a web browser:

```
https://whisper.yourcompany.com/health
```

You should see something like `{"status":"ok","database":"ok", …}`. That means
the server works, has a secure certificate, and can reach its database.

If it does not load, wait a minute or two and try again: the secure certificate
is requested when Whisper starts, and the server retries by itself if your domain
was not ready yet. If it still fails, see
[If something goes wrong](#14-if-something-goes-wrong).

## 9. Create the first admin account

There is no public sign-up. You create accounts yourself, starting with an admin
(you). Replace the email, password and name:

```bash
docker compose exec api node server/dist/cli/create-user.js --email you@yourcompany.com --password 'ChooseALongPassword' --name "Your Name" --admin
```

Use a **long** password, a few words are fine, and keep the quotes around it. You
can change it later inside the app.

## 10. Install the app and connect it

1. Download the installer from <https://github.com/teamz88/whisper-releases>:
   - **Windows:** `Whisper-Setup-<version>.exe` from the latest release.
   - **Mac (Apple Silicon):** the `.dmg` linked on that page.

   The app must be version **0.3.0 or newer**. Older versions cannot connect to
   your own server.
2. Install it. The app is not code-signed, so Windows shows a warning
   (**More info → Run anyway**) and a Mac asks you to approve it once
   (**System Settings → Privacy & Security → Open Anyway**). See the
   [macOS guide](MACOS-GUIDE.md) for the Mac steps and permissions.

   > On some new Windows 11 PCs, **Smart App Control** blocks unsigned apps with
   > no "Run anyway" button. You must turn it off in Windows Security → App &
   > browser control → Smart App Control settings. On older Windows builds this
   > cannot be turned back on without reinstalling Windows.
3. On the sign-in screen, at the bottom, click **Change** next to **Server**.
4. Type your address, for example `whisper.yourcompany.com`, and click **Connect**.
   The app checks that your server answers before it remembers the address.
5. Sign in with the admin email and password from step 9.

Everyone on your team repeats steps 1–4 on their own computer.

## 11. Add your teammates

In the app, open **Settings → Team → Add user**, enter their email and a
temporary password, and send both to them privately. They install the app,
connect to your server (step 10), and sign in. They can change their password
in **Settings → Account**.

Forgot a password? An admin sets a new temporary one in **Settings → Team → Edit**.
If you are the only admin and you locked yourself out, create a second admin
from the server with the command in step 9, using a different email.

## 12. Updating, backups, removing

### Update to a newer Whisper

Connect to the server (step 5) and run:

```bash
cd whisper
git pull
cd selfhost
docker compose up -d --build
```

Update the **server first**, then let the apps update. The app installs updates
by itself (Windows) and asks you to click **Restart now**. Database changes are
applied automatically when the server starts.

### Back up your data

```bash
cd ~/whisper/selfhost
docker compose exec -T db pg_dump -U whisper whisper > backup.sql
```

This saves your accounts and history into `backup.sql`. Copy that file somewhere
safe. Do it regularly; many providers also offer automatic whole-server
backups for a small fee.

To restore into a fresh install:

```bash
cat backup.sql | docker compose exec -T db psql -U whisper whisper
```

### Stop or remove Whisper

```bash
docker compose down        # stops it, keeps your data
docker compose down -v     # stops it AND deletes all data (cannot be undone)
```

## 13. Where your data lives

- **On your server**, in its own database: accounts, settings, and the text of
  each dictation (what was said and the cleaned-up version) plus word count and
  length. **Audio is never stored.** It is held in memory while it is processed,
  sent to Groq, and then discarded.
- **Each person can turn history off** in Settings → Privacy ("Save dictations
  to history"): then nothing is stored. They can also delete all their history.
- **At Groq:** the audio and text pass through Groq's service to be transcribed
  and cleaned up. Groq's own policy decides what it keeps. Groq's documentation
  says customers can turn on **Zero Data Retention** in their account's Data
  Controls settings: see <https://console.groq.com/docs/your-data>. Check
  there whether it applies to speech transcription, and decide what is right
  for your team. Whisper cannot change Groq's policy.
- **On each computer**, the app keeps your sign-in and settings, and a log file
  (no dictated text in it).

## 14. If something goes wrong

Useful commands (run in `~/whisper/selfhost` on the server):

```bash
docker compose ps                 # is everything running?
docker compose logs api --tail 50 # what is the server saying?
docker compose logs caddy --tail 50  # why is HTTPS failing?
docker compose restart            # turn it off and on again
```

| Problem | What to do |
|---|---|
| The `/health` page does not load, or the browser warns about security | Wait 1–2 minutes and refresh. Then check (1) step 4: the domain shows your server's IP on dnschecker.org; (2) ports **80 and 443** are open in your provider's firewall; (3) `docker compose logs caddy --tail 50`. |
| `/health` loads but says `"database":"unreachable"` | `docker compose logs db --tail 50`. If you changed `POSTGRES_PASSWORD` after the first start, the database kept the old one: set it back, or remove the data with `docker compose down -v` (deletes everything) and start again. |
| `docker compose up` says a value like `JWT_ACCESS_SECRET` must be set | The `.env` file is missing or a line is empty. Check it with `cat .env`. You must be inside `~/whisper/selfhost`. |
| The server stops right after starting | `docker compose logs api --tail 50`. Usually two secrets are identical, a secret is shorter than 32 characters, or the Groq key is missing. |
| The build ends with "killed" or runs out of memory | The server is too small. Use 2 GB or more, or ask your provider to add some "swap". |
| The app says "Could not find a Whisper server" | Check the address (no typos, no `http://`), open `https://your-address/health` in a browser, and make sure the server is running. |
| "That email and password combination is not correct" | Check the email, or reset the password in Settings → Team. Passwords are case-sensitive. |
| The app says "Transcription failed" | The Groq key may be wrong or over its limit. Check the key in the Groq console and `docker compose logs api --tail 50`. |
| You cannot change the server on the sign-in screen | Sign out first: the server can only be changed while signed out. |

Still stuck? Open an issue at <https://github.com/teamz88/whisper/issues> and
include the output of `docker compose ps` and `docker compose logs api --tail 50`
(**remove any keys or passwords first**).

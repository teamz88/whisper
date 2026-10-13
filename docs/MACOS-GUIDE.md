# Whisper — macOS Guide

Whisper on a Mac works the same as on Windows: hold a key combo anywhere, talk,
let go, and the text lands where your cursor is. The only difference is how the
app is packaged and installed. On Windows we ship a `Whisper-Setup-<version>.exe`;
on macOS the equivalent is a **`.dmg` disk image**.

This guide has two parts:

- **Part A — Build the .dmg.** For the one person with a Mac who creates the
  installer. Needs a Mac; the build cannot run on Windows.
- **Part B — Install Whisper.** For everyone else on a Mac. No terminal, no
  developer tools, just the `.dmg` file.

If you only want to install Whisper, skip straight to [Part B](#part-b--install-whisper-on-your-mac).

---

## Part A — Build the .dmg (one person, needs a Mac)

### A1. What you need

- An Apple Silicon Mac (M1/M2/M3/M4) running macOS 13 or newer. Intel Macs
  are not supported: the build is Apple Silicon only.
- **Xcode Command Line Tools.** Open Terminal and run `xcode-select --install`.
  If it says they are already installed, you are done.
- **Node.js 22.12 or newer.** Check with `node -v`. If missing, install from
  https://nodejs.org (the LTS version) or with Homebrew: `brew install node`.
- **Git** and read access to the `teamz88/whisper` repository.
- About 10 minutes. The first `npm install` downloads Electron (~100 MB).

### A2. Get the code

```bash
git clone https://github.com/teamz88/whisper.git
cd whisper
npm install
```

Run `npm install` from the repository root, not from `app/`. It installs all
three workspaces (`shared`, `server`, `app`) at once. A line saying
"Skipped native rebuild" at the end is normal.

### A3. Point the app at the server

The desktop app has exactly one setting baked in at build time: the URL of the
Whisper API. Create the file `app/.env` containing this single line:

```
VITE_API_URL=https://whisper.agent.omadligrouphq.com
```

Replace the URL if your team's server lives somewhere else. If you skip this
step the app silently points at `http://localhost:8080` and nobody will be
able to sign in.

### A4. Build

```bash
npm run build:shared
cd app
npm run build:mac
```

Run `build:shared` from the repository root first. It compiles the `shared`
package the app imports. `npm install` does not build it, and without it the
build fails with `Failed to resolve entry for package "@whisper/shared"`.

`build:mac` compiles the app and packages it. Expect 2–5 minutes. When it finishes,
look in `app/release/`:

| File | Who it is for |
|---|---|
| `Whisper-<version>-arm64.dmg` | Apple Silicon Macs (M1, M2, M3, M4) |
| `Whisper-<version>-arm64-mac.zip` | Not needed. Built for the auto-updater, which does not work on unsigned Mac builds (see A6). |

The `<version>` comes from `"version"` in `app/package.json`.

**If the build stops with an error about `build/icon.icns`:** the repository
ships the icon as a PNG and electron-builder normally converts it on the fly.
If your machine does not, generate the `.icns` once and re-run the build:

```bash
# from the app/ directory
mkdir -p icon.iconset
for s in 16 32 64 128 256 512; do
  sips -z $s $s build/icon.png --out icon.iconset/icon_${s}x${s}.png >/dev/null
  sips -z $((s*2)) $((s*2)) build/icon.png --out icon.iconset/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns icon.iconset -o build/icon.icns
rm -r icon.iconset
npm run build:mac
```

### A5. Test it before sharing

Install the `.dmg` on your own Mac by following Part B exactly as a teammate
would, including the "Open Anyway" step and the three permission prompts. Sign
in, hold the shortcut in any text field, say a sentence, and confirm the text
is pasted. Only share a build you have launched yourself.

### A6. Share it with the team

1. Upload the `.dmg` file to wherever the team already gets the Windows
   installer: shared drive, Slack, Google Drive, or a GitHub Release.
2. Tell people it runs on Apple Silicon Macs only. Easiest check: **Apple menu →
   About This Mac** must say *Chip: Apple M…*. Intel Macs are not supported.
3. Send them the link to Part B of this guide.

Two things to know when sharing:

- **The app is not code-signed or notarized.** We have no Apple Developer
  certificate, exactly like the Windows build has no signing certificate.
  macOS will warn on first launch and the user has to approve it once (Part B
  explains how). This is expected for an internal tool. The build stays
  unsigned even if your Keychain has an Apple developer certificate:
  `app/electron-builder.yml` sets `identity: null`.
- **Updates are manual on macOS.** The Windows app updates itself from GitHub
  Releases. The macOS updater needs a signed app, so it cannot. When you build
  a new version, share the new `.dmg` and ask people to reinstall. It takes
  one drag-and-drop and keeps their sign-in and settings.

### A7. Building a new version later

```bash
cd whisper
git pull
npm install
npm run build:shared
cd app
npm run build:mac
```

Bump `"version"` in `app/package.json` first if the Windows release has not
already done so, so the filename and the Settings → About screen show the new
number.

---

## Part B — Install Whisper on your Mac

You need the `.dmg` file from your admin and your Whisper email + temporary
password. No other software is required.

### B1. Check your Mac

**Apple menu → About This Mac.**

- *Chip: Apple M1 / M2 / M3 / M4* → use **`Whisper-<version>-arm64.dmg`**
- *Processor: Intel …* → Whisper does not run on Intel Macs. Tell your admin.

### B2. Install

1. Double-click the `.dmg`. A window opens with the Whisper icon and an
   Applications folder.
2. Drag **Whisper** onto **Applications**.
3. Close the window and eject the disk image (right-click it on the Desktop →
   Eject, or drag it to the Trash). You can delete the `.dmg` afterwards.

### B3. First launch — approve the app once

Whisper is an internal tool and is not registered with Apple, so macOS blocks
the first launch. This happens once.

1. Open **Applications** and double-click **Whisper**.
2. macOS shows a message like *"Whisper" cannot be opened because Apple cannot
   check it for malicious software* or *"Whisper" Not Opened*. Click **Done**
   (or **OK**).
3. Open **System Settings → Privacy & Security**. Scroll down to the
   **Security** section. You will see *"Whisper" was blocked to protect your
   Mac.* Click **Open Anyway**, then confirm with your password or Touch ID.
4. Whisper starts.

On older macOS versions (13 and 14) you can instead right-click Whisper in
Applications and choose **Open**, then click **Open** in the dialog.

If macOS says the app **"is damaged and can't be opened"**, it is not damaged.
That is how macOS phrases the same block for downloaded, unsigned apps. Open
**Terminal** (Applications → Utilities), paste this line, press Return, and
launch Whisper again:

```bash
xattr -cr /Applications/Whisper.app
```

### B4. Grant the three permissions

Whisper needs three permissions. macOS asks for each the first time it is
needed; you can also grant them up front in **System Settings → Privacy &
Security**.

| Permission | Why Whisper needs it | What breaks without it |
|---|---|---|
| **Microphone** | To hear you | Recording is silent; nothing is transcribed |
| **Accessibility** | To paste the text into the app you are using | You speak, but no text appears |
| **Input Monitoring** | To notice when you hold the shortcut anywhere on the Mac | The shortcut does nothing |

For each one: System Settings → Privacy & Security → the permission name →
turn on the switch next to **Whisper**. If Whisper is not in the list, click
**+** and choose it from Applications.

After changing Accessibility or Input Monitoring, **quit Whisper and open it
again** so the new permission takes effect: click the menu-bar icon → Quit,
then launch it from Applications.

### B5. Find the app

Whisper does not show in the Dock or in the Cmd-Tab app switcher. Look for the
**Whisper icon in the menu bar** at the top-right of the screen, near the
clock and Wi-Fi icons. Click it to open the dashboard, change settings, or
quit.

### B6. Sign in and dictate

1. Click the menu-bar icon and sign in with the email and temporary password
   your admin gave you. There is no sign-up.
2. The 30-second setup checks your microphone, shows the shortcut, and asks
   how you want your text to sound.
3. Put your cursor in any text field. **Hold Control + Command**, speak, let
   go. The text appears where the cursor was. The shortcut can be changed in
   Settings.
4. **Esc** always stops a stuck recording.

Everything else — writing styles, accuracy tips, history and privacy — is the
same as on Windows. See the [Team Guide](TEAM-GUIDE.md) from section 3 onward.

### B7. Updating

Whisper does not update itself on macOS. When your admin shares a new `.dmg`,
install it the same way: open it, drag Whisper onto Applications, click
**Replace** when asked. Your sign-in and settings are kept. You will not be
asked to approve the app or re-grant permissions again unless macOS has been
upgraded in between.

### B8. If something's off

| Symptom | Fix |
|---|---|
| "Whisper cannot be opened" / "not opened" on launch | Part B3: System Settings → Privacy & Security → **Open Anyway** |
| "Whisper is damaged and can't be opened" | Part B3: run the `xattr -cr /Applications/Whisper.app` command |
| App launched but I cannot find it | It lives in the **menu bar**, top-right. Not in the Dock. |
| Holding the shortcut does nothing | Grant **Input Monitoring**, then quit and reopen Whisper |
| I spoke, the overlay showed, but no text appeared | Grant **Accessibility**, then quit and reopen Whisper. Also check that the app you were typing in still had focus. |
| Nothing is transcribed / the mic check fails | Grant **Microphone**. In Settings, pick the right input device if you have several. |
| "Not supported on this type of Mac" / app won't launch | Your Mac has an Intel processor. Whisper runs on Apple Silicon only (B1). |
| Can't sign in / "cannot reach server" | Check you are online. If it persists, tell your admin — the build may have been made with the wrong server URL (Part A3). |
| Settings → Updates shows an error | Expected on macOS. Updates are manual (B7). |

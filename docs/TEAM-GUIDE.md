# Whisper — Team Guide

Talk instead of type. Hold a key combo anywhere on your computer, say what you
want to write, let go — the text appears where your cursor is. Works in Gmail,
Slack, Notion, Telegram, your IDE, anywhere you can type.

---

## 1. Install (Windows)

1. Get **`Whisper-Setup-<version>.exe`** from your admin.
2. Run it. Windows SmartScreen will warn because the app is unsigned — click
   **More info → Run anyway**. (Internal tool; this is expected.)
3. Whisper installs per-user and starts in the **system tray** (bottom-right,
   near the clock). It starts there every time — there is no taskbar window
   unless you open the dashboard.

## 2. Sign in

There is no sign-up. Your admin creates your account and gives you an email +
temporary password. Left-click the tray icon → sign in.

First sign-in walks you through a 30-second setup: microphone check, the
shortcut, and how you want your text to sound.

## 3. Dictate

- **Hold `Ctrl + Win`**, speak, **release**. That's it — the text types itself
  where your cursor was.
- A small pill at the bottom of the screen shows what's happening:
  red dot = listening · spinner = processing · green check = inserted.
- **Esc** cancels a recording at any time.
- You can change the shortcut in Settings (a tap-to-start/tap-to-stop key like
  `F12` works too).
- If pasting ever fails, the text is still on your clipboard — just press
  `Ctrl + V`.

## 4. Getting the best accuracy

These make a bigger difference than anything else:

1. **Keep the mic close.** A headset or earbuds beat a laptop mic across the
   room, every time.
2. **Pick the right microphone** — Settings → Audio → Microphone (then "Test
   microphone" to see the level meter move).
3. **Turn on "High accuracy"** — Settings → Transcription. Slightly slower,
   noticeably better, especially for Russian / Uzbek / Tajik.
4. **Fill in your custom vocabulary** — Settings → AI Cleanup. Add names,
   brands and jargon you use ("Omadli, Coolify, Groq, …") and Whisper will
   spell them right.
5. Speak in phrases rather than single words — the model uses context.

## 5. Writing styles

The AI cleanup removes the "um"s, fixes punctuation and capitalisation, and
applies your chosen style:

| Style | What you get |
| --- | --- |
| Auto | Keeps whatever tone you spoke in |
| Casual | Relaxed, contractions, chat-friendly |
| Formal | Complete sentences, professional |
| Excited | Keeps your energy up |
| Precise | Shortest faithful version |

Pick a default in Settings, or switch on the dashboard's home screen. You can
also turn AI cleanup off entirely and get the raw transcription.

## 6. Your history & privacy

- The dashboard (tray icon → left-click) shows today's dictations, full
  searchable history, and your stats (words dictated, time saved, streak).
- Everything is stored on **our own server**, not with any third party.
- Don't want history? Settings → Privacy → turn off "Save dictations to
  history" (nothing gets stored at all), and/or **Delete all my history**.

## 7. If something's off

| Problem | Fix |
| --- | --- |
| "Microphone blocked" | Windows Settings → Privacy & security → Microphone → allow microphone access + desktop apps. Then try again. |
| Nothing types, but green check shows "On clipboard" | Press `Ctrl + V` — some apps refuse synthetic paste; the text is on your clipboard. |
| Shortcut stopped responding | Open the dashboard and click the round mic button (it always works), or sign out/in. Tell the admin — logs will show why. |
| Wrong words for names/jargon | Add them to Settings → AI Cleanup → custom vocabulary. |
| Recording seems stuck | Press `Esc`. Recordings also auto-stop at 10 minutes. |

## For admins

- **Add a teammate:** Settings → Team → Add user (email + temp password + role),
  then send them the installer and their credentials.
- **Deactivate someone:** Settings → Team → Deactivate. Their session is
  revoked immediately.
- Team stats (total words, most active, sessions this week) live in the same
  panel.

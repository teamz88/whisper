import type { ReactNode } from 'react';

import { hotkeyHint } from '@whisper/shared';

import { Card, SectionTitle } from '../components/ui.js';
import { useAppState } from '../state/AppState.js';

interface Question {
  q: string;
  a: ReactNode;
}

/** Short answers to what people actually ask: how to use it, and what to do when it goes wrong. */
export function Faq(): ReactNode {
  const { settings, appInfo, setPage } = useAppState();
  const mac = appInfo?.platform === 'darwin';
  const paste = mac ? '⌘V' : 'Ctrl+V';

  const toSettings = (
    <button type="button" className="font-medium text-accent-ink hover:underline" onClick={() => setPage('settings')}>
      Settings
    </button>
  );

  const groups: Array<{ title: string; items: Question[] }> = [
    {
      title: 'Using Whisper',
      items: [
        {
          q: 'How do I dictate?',
          a: (
            <>
              Click where you want the text, so the cursor blinks there. Then: {hotkeyHint(settings.hotkey, { mac })}{' '}
              Press Esc to cancel a recording.
            </>
          ),
        },
        {
          q: 'Which languages work?',
          a: <>English and Russian. Pick yours in {toSettings} → Spoken language. Speak the language you picked.</>,
        },
        {
          q: 'How long can one dictation be?',
          a: 'Up to 10 minutes. Shorter dictations come back faster.',
        },
        {
          q: 'Where are my earlier dictations?',
          a: (
            <>
              In History, if "Save dictations to history" is on in {toSettings}. Right after a dictation you can also
              click the small copy button, or use the tray icon → Copy Last Dictation.
            </>
          ),
        },
        {
          q: 'How do I update?',
          a: 'Updates download by themselves. When "Restart now" appears, click it, or just quit and reopen Whisper.',
        },
      ],
    },
    {
      title: 'When something goes wrong',
      items: [
        {
          q: 'The text did not appear where I was typing.',
          a: (
            <>
              The text goes wherever the cursor was when you released the shortcut. Click into the text box before you
              speak. If it still did not land, click the copy button that shows after the dictation (or tray → Copy Last
              Dictation) and paste with {paste}.
            </>
          ),
        },
        {
          q: 'Some words are missing, or the end is cut off.',
          a: (
            <>
              Start speaking once the red dot shows, and release the shortcut a moment after your last word, not while
              saying it. AI polish tidies the text a little; if you need every word exactly as spoken, set the writing
              style to Precise or turn polish off in {toSettings}. The text exactly as you said it, before polish, is in History → Show raw.
            </>
          ),
        },
        {
          q: '"Could not reach the Whisper server".',
          a: (
            <>
              Your internet dropped or is very slow, or a VPN or firewall is blocking it. Check the connection and
              dictate again; a failed recording is not kept. If the internet is fine and it keeps happening, quit
              Whisper from the tray and open it again.
            </>
          ),
        },
        {
          q: 'It is slow, or stuck on "Processing…".',
          a: 'Usually a weak or busy connection: the recording has to upload first. Long dictations take longer. Wi-Fi with a good signal, or a cable, helps most.',
        },
        {
          q: 'Nothing was heard, or the recording is empty.',
          a: (
            <>
              Check the microphone in {toSettings} → Audio and use the test there. On Windows, also check Settings →
              Privacy & security → Microphone, and that the mic is not muted.
            </>
          ),
        },
        {
          q: 'Names or special words come out wrong.',
          a: <>Add them to Custom vocabulary in {toSettings}, separated by commas.</>,
        },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-8 py-7">
      {groups.map((group) => (
        <section key={group.title} className="space-y-3">
          <SectionTitle>{group.title}</SectionTitle>
          <Card>
            {group.items.map((item) => (
              <details key={item.q} className="group border-b border-line-soft last:border-b-0">
                <summary className="flex cursor-default list-none items-center justify-between gap-4 px-5 py-3.5 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-ink-faint transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  >
                    <path d="M3 4.5 6 7.5 9 4.5" />
                  </svg>
                </summary>
                <div className="selectable px-5 pb-4 text-[13px] leading-relaxed text-ink-soft">{item.a}</div>
              </details>
            ))}
          </Card>
        </section>
      ))}
    </div>
  );
}

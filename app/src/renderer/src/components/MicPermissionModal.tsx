import { type ReactNode } from 'react';

import { bridge } from '../lib/bridge.js';
import { useAppState } from '../state/AppState.js';
import { Button, Modal } from './ui.js';

const WIN32_STEPS: readonly string[] = [
  'Open Settings › Privacy & security › Microphone',
  'Turn on "Microphone access"',
  'Turn on "Let desktop apps access your microphone"',
  'Come back and try again',
];

const DARWIN_STEPS: readonly string[] = [
  'Open System Settings › Privacy & Security › Microphone',
  'Enable Whisper',
  'Quit and reopen Whisper (macOS only re-checks on launch)',
];

/** Recovery instructions shown when the OS refused the microphone. */
export function MicPermissionModal(): ReactNode {
  const { micDenied, dismissMicDenied, appInfo } = useAppState();

  const steps = appInfo?.platform === 'darwin' ? DARWIN_STEPS : WIN32_STEPS;

  return (
    <Modal
      open={micDenied !== null}
      title="Whisper can't hear your microphone"
      description={micDenied}
      onClose={dismissMicDenied}
      footer={
        <>
          <Button variant="ghost" onClick={dismissMicDenied}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => void bridge.invoke('system:open-mic-settings')}
          >
            Open sound settings
          </Button>
        </>
      }
    >
      <ol className="list-decimal space-y-1.5 pl-4 text-[13px] text-ink-soft">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </Modal>
  );
}

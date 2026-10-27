import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  MAX_CUSTOM_VOCABULARY_CHARS,
  LANGUAGES,
  OVERLAY_POSITIONS,
  OVERLAY_POSITION_LABELS,
  WRITING_STYLES,
  WRITING_STYLE_LABELS,
  coerceLanguageCode,
  coerceWritingStyle,
  hotkeyHint,
  isAdmin,
  isOverlayPosition,
} from '@whisper/shared';

import { ChangePasswordModal } from '../components/ChangePasswordModal.js';
import { HotkeyCapture } from '../components/HotkeyCapture.js';
import { LevelMeter, useMicLevel } from '../components/LevelMeter.js';
import { TeamSection } from '../components/TeamSection.js';
import {
  Button,
  Card,
  Chip,
  Modal,
  SectionTitle,
  Select,
  SettingRow,
  Spinner,
  TextArea,
  TextField,
  Toggle,
} from '../components/ui.js';
import { bridge } from '../lib/bridge.js';
import { cn } from '../lib/cn.js';
import { formatCount, pluralise } from '../lib/format.js';
import { useAppState } from '../state/AppState.js';

/** Mounted only while the user is testing, so the mic stream is released on stop. */
function MicTest({ deviceId }: { deviceId: string }): ReactNode {
  const { level, error, ready } = useMicLevel(deviceId === '' ? undefined : deviceId);

  if (error !== null) return <p className="text-[13px] text-danger">{error}</p>;

  return (
    <div className="flex items-center gap-3">
      <LevelMeter level={level} />
      <span className="text-[13px] text-ink-faint">
        {ready ? 'Say something…' : 'Opening microphone…'}
      </span>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section>
      <div className="mb-2.5">
        <SectionTitle>{title}</SectionTitle>
      </div>
      {children}
    </section>
  );
}

export function Settings(): ReactNode {
  const { settings, profile, appInfo, updateStatus, saveSettings, saveProfile, removeAllSessions } =
    useAppState();

  const mac = appInfo?.platform === 'darwin';

  // --- Custom vocabulary: local while typing, saved on blur. -----------------
  const [vocab, setVocab] = useState(settings.customVocabulary);
  useEffect(() => {
    setVocab(settings.customVocabulary);
  }, [settings.customVocabulary]);
  const vocabOver = vocab.length > MAX_CUSTOM_VOCABULARY_CHARS;

  // --- Microphone (device-local preference, persisted via main so the overlay
  // recorder — a different window — actually records from it). -----------------
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [testing, setTesting] = useState(false);

  const pickDevice = (next: string): void => {
    setDeviceId(next);
    void bridge.invoke('mic:set-device', { deviceId: next === '' ? null : next });
  };

  useEffect(() => {
    let cancelled = false;
    // Restore the saved choice; it may point at an unplugged device, which the
    // selectedDeviceId fallback below (and the overlay recorder) tolerate.
    void bridge.invoke('mic:get-device').then((saved) => {
      if (!cancelled && saved !== null) setDeviceId(saved);
    });
    const refresh = (): void => {
      void navigator.mediaDevices.enumerateDevices().then((all) => {
        if (!cancelled) setDevices(all.filter((device) => device.kind === 'audioinput'));
      });
    };
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, []);

  // Windows lists the same microphone three times: a "default" and a
  // "communications" alias, then the real device. The aliases are hidden; the
  // OS default is offered once, as the empty value (no deviceId = system default).
  const realDevices = devices.filter(
    (device) => device.deviceId !== 'default' && device.deviceId !== 'communications',
  );

  const selectedDeviceId =
    deviceId !== '' && realDevices.some((device) => device.deviceId === deviceId) ? deviceId : '';

  const deviceOptions = [
    { value: '', label: 'System default' },
    ...realDevices.map((device, index) => ({
      value: device.deviceId,
      label: device.label !== '' ? device.label : `Microphone ${index + 1}`,
    })),
  ];

  // --- Delete all history. ----------------------------------------------------
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletedMessage, setDeletedMessage] = useState<string | null>(null);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const deletedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (deletedTimer.current !== null) clearTimeout(deletedTimer.current);
    },
    [],
  );

  const confirmDeleteAll = async (): Promise<void> => {
    setPrivacyError(null);
    setDeleting(true);
    try {
      const deleted = await removeAllSessions();
      setConfirmOpen(false);
      setDeletedMessage(`Deleted ${formatCount(deleted)} ${pluralise(deleted, 'dictation')}.`);
      if (deletedTimer.current !== null) clearTimeout(deletedTimer.current);
      deletedTimer.current = setTimeout(() => setDeletedMessage(null), 4000);
    } catch (caught) {
      setPrivacyError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setDeleting(false);
    }
  };

  // --- Account. ----------------------------------------------------------------
  const [nameDraft, setNameDraft] = useState(profile?.fullName ?? '');
  useEffect(() => {
    setNameDraft(profile?.fullName ?? '');
  }, [profile?.fullName]);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const updateControl = (): ReactNode => {
    switch (updateStatus.kind) {
      case 'checking':
        return (
          <span className="inline-flex items-center gap-2 text-[13px] text-ink-faint">
            <Spinner className="size-3.5" /> Checking…
          </span>
        );
      case 'available':
        return (
          <span className="text-[13px] text-ink-faint">
            Update {updateStatus.version} available…
          </span>
        );
      case 'progress':
        return (
          <span className="text-[13px] text-ink-faint">
            Downloading… {Math.round(updateStatus.percent)}%
          </span>
        );
      case 'downloaded':
        return (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              void bridge.invoke('updates:restart');
            }}
          >
            Restart now
          </Button>
        );
      default:
        return (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void bridge.invoke('updates:check');
            }}
          >
            Check for updates
          </Button>
        );
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-8 py-7">
      <SettingsGroup title="Shortcut">
        <Card>
          <SettingRow
            label="Dictation shortcut"
            hint={hotkeyHint(settings.hotkey, { mac })}
            control={
              <HotkeyCapture
                value={settings.hotkey}
                onChange={(hotkey) => bridge.invoke('hotkey:set', { hotkey })}
              />
            }
          />
        </Card>
      </SettingsGroup>

      <SettingsGroup title="Transcription">
        <Card>
          <SettingRow
            label="Spoken language"
            control={
              <Select
                options={LANGUAGES.map((l) => ({
                  value: l.code,
                  label: l.label,
                  // "English — English" reads silly; only show the endonym
                  // when it differs.
                  ...(l.native === l.label ? {} : { hint: l.native }),
                }))}
                value={settings.language}
                onChange={(language) => {
                  void saveSettings({ language: coerceLanguageCode(language) });
                }}
              />
            }
          />
          <SettingRow
            label="High accuracy"
            hint="Slower, but better for Russian, Uzbek and Tajik."
            control={
              <Toggle
                checked={settings.highAccuracy}
                label="High accuracy"
                onChange={(highAccuracy) => {
                  void saveSettings({ highAccuracy });
                }}
              />
            }
          />
        </Card>
      </SettingsGroup>

      <SettingsGroup title="AI cleanup">
        <Card>
          <SettingRow
            label="Use AI to polish transcripts"
            hint="Removes ums, fixes punctuation, keeps your voice."
            control={
              <Toggle
                checked={settings.aiCleanup}
                label="Use AI to polish transcripts"
                onChange={(aiCleanup) => {
                  void saveSettings({ aiCleanup });
                }}
              />
            }
          />
          <SettingRow
            label="Default writing style"
            control={
              <Select
                options={WRITING_STYLES.map((style) => ({
                  value: style,
                  label: WRITING_STYLE_LABELS[style],
                }))}
                value={settings.defaultStyle}
                onChange={(style) => {
                  void saveSettings({ defaultStyle: coerceWritingStyle(style) });
                }}
              />
            }
          />
          <div className="px-5 py-4">
            <div className="text-sm font-medium text-ink">Custom vocabulary</div>
            <div className="mt-0.5 text-[13px] leading-snug text-ink-faint">
              Names, brands and jargon. Helps Whisper spell them right.
            </div>
            <TextArea
              rows={4}
              className="mt-2.5"
              placeholder="Ada Lovelace, Kubernetes, Omadli, Tashkent…"
              value={vocab}
              onChange={(event) => setVocab(event.target.value)}
              onBlur={() => {
                if (!vocabOver && vocab !== settings.customVocabulary) {
                  void saveSettings({ customVocabulary: vocab });
                }
              }}
            />
            <div
              className={cn(
                'mt-1 text-right text-[11px]',
                vocabOver ? 'text-danger' : 'text-ink-faint',
              )}
            >
              {vocab.length}/{MAX_CUSTOM_VOCABULARY_CHARS}
            </div>
          </div>
        </Card>
      </SettingsGroup>

      <SettingsGroup title="Audio">
        <Card>
          <SettingRow
            label="Microphone"
            hint="Which input Whisper listens to on this computer."
            // Stacked: device names can be paragraph-length ("Microphone Array
            // (Intel® Smart Sound Technology for Digital Microphones)") and
            // beside the label they were cut off in the closed select.
            stacked
            control={
              <Select
                className="w-full"
                options={deviceOptions}
                value={selectedDeviceId}
                onChange={pickDevice}
              />
            }
          />
          <div className="px-5 py-4">
            <Button variant="secondary" size="sm" onClick={() => setTesting((t) => !t)}>
              {testing ? 'Stop test' : 'Test microphone'}
            </Button>
            {testing ? (
              <div className="mt-3">
                <MicTest deviceId={selectedDeviceId} />
              </div>
            ) : null}
          </div>
        </Card>
      </SettingsGroup>

      <SettingsGroup title="Privacy">
        <Card>
          <SettingRow
            label="Save dictations to history"
            hint="When off, nothing you dictate is stored on the server."
            control={
              <Toggle
                checked={settings.historyStorage}
                label="Save dictations to history"
                onChange={(historyStorage) => {
                  void saveSettings({ historyStorage });
                }}
              />
            }
          />
          <SettingRow
            label="Delete all my history"
            hint={
              deletedMessage !== null ? (
                <span className="text-success">{deletedMessage}</span>
              ) : privacyError !== null ? (
                <span className="text-danger">{privacyError}</span>
              ) : (
                'Removes every stored transcript from the server.'
              )
            }
            control={
              <Button variant="danger" size="sm" onClick={() => setConfirmOpen(true)}>
                Delete all
              </Button>
            }
          />
        </Card>
      </SettingsGroup>

      <SettingsGroup title="Appearance">
        <Card>
          <SettingRow
            label="Theme"
            control={<Chip className="opacity-70">Light (locked)</Chip>}
          />
          <SettingRow
            label="Overlay position"
            hint="Where the recording pill appears while you dictate."
            control={
              <Select
                options={OVERLAY_POSITIONS.map((position) => ({
                  value: position,
                  label: OVERLAY_POSITION_LABELS[position],
                }))}
                value={settings.overlayPosition}
                onChange={(position) => {
                  if (isOverlayPosition(position)) {
                    void saveSettings({ overlayPosition: position });
                  }
                }}
              />
            }
          />
        </Card>
      </SettingsGroup>

      <SettingsGroup title="Updates">
        <Card>
          <SettingRow
            label="Version"
            control={
              <span className="text-sm text-ink-faint">{appInfo?.version ?? '—'}</span>
            }
          />
          <SettingRow
            label="Status"
            hint={
              updateStatus.kind === 'error'
                ? updateStatus.message
                : updateStatus.kind === 'not-available'
                  ? "You're up to date."
                  : undefined
            }
            control={updateControl()}
          />
        </Card>
      </SettingsGroup>

      <SettingsGroup title="Account">
        <Card>
          <SettingRow
            label="Display name"
            control={
              <TextField
                value={nameDraft}
                className="w-56"
                placeholder="Your name"
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={() => {
                  const next = nameDraft.trim();
                  if (next !== (profile?.fullName ?? '')) {
                    void saveProfile({ fullName: next });
                  }
                }}
              />
            }
          />
          <SettingRow
            label="Email"
            control={<span className="text-sm text-ink-faint">{profile?.email ?? '—'}</span>}
          />
          <SettingRow
            label="Password"
            hint={
              passwordChanged ? (
                <span className="text-success">Password changed.</span>
              ) : (
                'Other devices are signed out when you change it.'
              )
            }
            control={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPasswordChanged(false);
                  setPasswordOpen(true);
                }}
              >
                Change password
              </Button>
            }
          />
        </Card>
      </SettingsGroup>

      {isAdmin(profile) ? (
        <SettingsGroup title="Team">
          <TeamSection />
        </SettingsGroup>
      ) : null}

      <ChangePasswordModal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onDone={() => setPasswordChanged(true)}
      />

      <Modal
        open={confirmOpen}
        title="Delete all your dictations?"
        description="This removes every transcript from the server. It cannot be undone."
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={() => {
                void confirmDeleteAll();
              }}
            >
              Delete all
            </Button>
          </>
        }
      />
    </div>
  );
}

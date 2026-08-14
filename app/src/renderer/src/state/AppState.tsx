import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  DEFAULT_SETTINGS,
  EMPTY_USER_STATS,
  type Profile,
  type Session,
  type Settings,
  type UpdateProfileRequest,
  type UpdateSettingsRequest,
  type UserStats,
} from '@whisper/shared';

import type { AppInfo, RecordingState, UpdateStatus } from '../../../shared/ipc.js';
import { bridge } from '../lib/bridge.js';

export type Page = 'home' | 'history' | 'settings';

export type AppStatus = 'loading' | 'signed-out' | 'onboarding' | 'ready';

export interface AppStateValue {
  status: AppStatus;
  profile: Profile | null;
  settings: Settings;
  stats: UserStats;
  /** The 10 most recent sessions, for the Home "Today" list. */
  recent: Session[];
  recording: RecordingState;
  updateStatus: UpdateStatus;
  appInfo: AppInfo | null;
  /** Non-null while the mic-permission recovery modal should be shown. */
  micDenied: string | null;

  page: Page;
  setPage: (page: Page) => void;

  /** Resolves to an error message, or null on success. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;

  saveSettings: (patch: UpdateSettingsRequest) => Promise<void>;
  saveProfile: (patch: UpdateProfileRequest) => Promise<void>;
  finishOnboarding: () => Promise<void>;

  refreshStats: () => Promise<void>;
  refreshRecent: () => Promise<void>;

  removeSession: (id: string) => Promise<void>;
  removeAllSessions: () => Promise<number>;

  toggleRecording: () => Promise<void>;
  dismissMicDenied: () => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

const RECENT_LIMIT = 10;

export function AppStateProvider({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<UserStats>(EMPTY_USER_STATS);
  const [recent, setRecent] = useState<Session[]>([]);
  const [recording, setRecording] = useState<RecordingState>({ active: false, source: null });
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [micDenied, setMicDenied] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('home');

  // Avoids a setState on an unmounted tree during sign-out teardown.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const next = await bridge.invoke('stats:get');
      if (mounted.current) setStats(next);
    } catch {
      // Stats are decorative; a failure must never block dictating.
    }
  }, []);

  const refreshRecent = useCallback(async () => {
    try {
      const page1 = await bridge.invoke('sessions:list', { page: 1 });
      if (mounted.current) setRecent(page1.items.slice(0, RECENT_LIMIT));
    } catch {
      // Same reasoning as refreshStats.
    }
  }, []);

  /**
   * Everything the dashboard needs once we know who the user is. Never throws:
   * the boot effect maps a rejection here to 'signed-out', and a transient
   * settings fetch failure must not dump an authenticated user on the login
   * screen. (Stats and recents already swallow their own errors.)
   */
  const loadUserData = useCallback(async () => {
    try {
      const [nextSettings] = await Promise.all([
        bridge.invoke('settings:get'),
        refreshStats(),
        refreshRecent(),
      ]);
      if (mounted.current) setSettings(nextSettings);
    } catch {
      // Keep the defaults; the next settings save or broadcast corrects them.
    }
  }, [refreshRecent, refreshStats]);

  const applyProfile = useCallback((next: Profile) => {
    setProfile(next);
    setStatus(next.onboarded ? 'ready' : 'onboarding');
  }, []);

  // Boot: restore the saved session if there is one.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [info, auth, recordingState, update] = await Promise.all([
          bridge.invoke('app:info'),
          bridge.invoke('auth:status'),
          bridge.invoke('recording:state'),
          bridge.invoke('updates:status'),
        ]);

        if (cancelled) return;

        setAppInfo(info);
        setRecording(recordingState);
        setUpdateStatus(update);

        if (auth.profile === null) {
          setStatus('signed-out');
          return;
        }

        applyProfile(auth.profile);
        await loadUserData();
      } catch {
        if (!cancelled) setStatus('signed-out');
      } finally {
        bridge.send('renderer:ready');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyProfile, loadUserData]);

  // Main-process broadcasts.
  useEffect(() => {
    const offs = [
      bridge.on('recording:state', setRecording),
      bridge.on('update:status', setUpdateStatus),
      bridge.on('settings:changed', setSettings),
      bridge.on('profile:changed', applyProfile),
      bridge.on('mic:permission-denied', ({ message }) => setMicDenied(message)),
      bridge.on('navigate', ({ page: next }) => setPage(next)),
      bridge.on('session:created', (session) => {
        setRecent((current) => [session, ...current].slice(0, RECENT_LIMIT));
        void refreshStats();
      }),
      // History storage is off, so there is no row — but the words still count.
      bridge.on('session:completed', () => {
        void refreshStats();
      }),
      bridge.on('auth:signed-out', () => {
        setProfile(null);
        setSettings(DEFAULT_SETTINGS);
        setStats(EMPTY_USER_STATS);
        setRecent([]);
        setPage('home');
        setStatus('signed-out');
      }),
    ];

    return () => {
      for (const off of offs) off();
    };
  }, [applyProfile, refreshStats]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const result = await bridge.invoke('auth:login', { email, password });
      if (!result.ok || result.profile === undefined) {
        return result.error ?? 'Could not sign in.';
      }
      applyProfile(result.profile);
      await loadUserData();
      return null;
    },
    [applyProfile, loadUserData],
  );

  const signOut = useCallback(async () => {
    await bridge.invoke('auth:logout');
    // The main process broadcasts auth:signed-out, which resets the tree.
  }, []);

  const saveSettings = useCallback(async (patch: UpdateSettingsRequest) => {
    // Optimistic: the Settings toggles must feel instant. The main process
    // broadcasts the authoritative row back on success.
    setSettings((current) => ({ ...current, ...patch }));
    const next = await bridge.invoke('settings:update', patch);
    if (mounted.current) setSettings(next);
  }, []);

  const saveProfile = useCallback(async (patch: UpdateProfileRequest) => {
    const next = await bridge.invoke('profile:update', patch);
    if (mounted.current) setProfile(next);
  }, []);

  const finishOnboarding = useCallback(async () => {
    const next = await bridge.invoke('profile:update', { onboarded: true });
    if (!mounted.current) return;
    setProfile(next);
    setStatus('ready');
  }, []);

  const removeSession = useCallback(
    async (id: string) => {
      await bridge.invoke('sessions:delete', { id });
      if (mounted.current) setRecent((current) => current.filter((session) => session.id !== id));
      await refreshStats();
    },
    [refreshStats],
  );

  const removeAllSessions = useCallback(async () => {
    const { deleted } = await bridge.invoke('sessions:delete-all');
    if (mounted.current) {
      setRecent([]);
      setStats(EMPTY_USER_STATS);
    }
    return deleted;
  }, []);

  const toggleRecording = useCallback(async () => {
    const next = await bridge.invoke('recording:toggle');
    if (mounted.current) setRecording(next);
  }, []);

  const dismissMicDenied = useCallback(() => setMicDenied(null), []);

  const value = useMemo<AppStateValue>(
    () => ({
      status,
      profile,
      settings,
      stats,
      recent,
      recording,
      updateStatus,
      appInfo,
      micDenied,
      page,
      setPage,
      signIn,
      signOut,
      saveSettings,
      saveProfile,
      finishOnboarding,
      refreshStats,
      refreshRecent,
      removeSession,
      removeAllSessions,
      toggleRecording,
      dismissMicDenied,
    }),
    [
      status,
      profile,
      settings,
      stats,
      recent,
      recording,
      updateStatus,
      appInfo,
      micDenied,
      page,
      signIn,
      signOut,
      saveSettings,
      saveProfile,
      finishOnboarding,
      refreshStats,
      refreshRecent,
      removeSession,
      removeAllSessions,
      toggleRecording,
      dismissMicDenied,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (value === null) throw new Error('useAppState must be used inside <AppStateProvider>');
  return value;
}

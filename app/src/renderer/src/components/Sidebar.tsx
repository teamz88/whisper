import { type ReactNode } from 'react';

import { isAdmin } from '@whisper/shared';

import { cn } from '../lib/cn.js';
import { useAppState, type Page } from '../state/AppState.js';
import { Button } from './ui.js';

interface NavItem {
  key: Page;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    key: 'home',
    label: 'Home',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2.5 6.5 8 2l5.5 4.5V13a1 1 0 0 1-1 1h-3v-4h-3v4h-3a1 1 0 0 1-1-1V6.5Z" />
      </svg>
    ),
  },
  {
    key: 'history',
    label: 'History',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5V8l2.5 1.5" />
      </svg>
    ),
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M2 4.5h8M13 4.5h1" />
        <circle cx="11.5" cy="4.5" r="1.5" />
        <path d="M2 11.5h1M6 11.5h8" />
        <circle cx="4.5" cy="11.5" r="1.5" />
      </svg>
    ),
  },
];

/** The fixed left rail: brand, navigation, and the signed-in identity. */
export function Sidebar(): ReactNode {
  const { profile, page, setPage, signOut } = useAppState();

  const displayName =
    profile === null ? '' : profile.fullName ?? profile.email.split('@')[0] ?? profile.email;

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-line bg-card">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-accent">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M2 5.5v3M5 3v8M8.5 4.5v5M12 6v2" />
          </svg>
        </div>
        <span className="text-sm">
          <span className="text-ink-faint">[</span>
          <span className="font-medium text-ink">whisper</span>
          <span className="text-ink-faint">]</span>
        </span>
        {isAdmin(profile) ? (
          <span className="inline-flex h-4 items-center rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold tracking-wide text-accent-strong">
            ADMIN
          </span>
        ) : null}
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        {NAV_ITEMS.map((item) => {
          const active = page === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setPage(item.key)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'no-drag flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm transition-colors',
                active
                  ? 'bg-accent-soft font-medium text-accent-strong'
                  : 'text-ink-soft hover:bg-line-soft',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-line-soft p-3">
        <div className="truncate px-1 text-sm font-medium text-ink">{displayName}</div>
        <div className="truncate px-1 text-[12px] text-ink-faint">{profile?.email ?? ''}</div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full justify-start"
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
      </div>
    </aside>
  );
}

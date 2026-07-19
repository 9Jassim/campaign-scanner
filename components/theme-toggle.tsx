'use client';

import { useEffect, useState } from 'react';
import { THEME_STORAGE_KEY } from './theme-script';

type Theme = 'light' | 'dark' | 'system';

const OPTIONS: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
  {
    value: 'light',
    label: 'Light',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M10 4a1 1 0 0 1-1-1V2a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1Zm0 12a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm6-6a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2h-1a1 1 0 0 1-1-1ZM2 10a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm12.24-4.24a1 1 0 0 1 0-1.42l.7-.7a1 1 0 1 1 1.42 1.42l-.7.7a1 1 0 0 1-1.42 0ZM4.64 15.36a1 1 0 0 1 0-1.42l.7-.7a1 1 0 0 1 1.42 1.42l-.7.7a1 1 0 0 1-1.42 0Zm10.72 0-.7-.7a1 1 0 0 1 1.41-1.42l.71.7a1 1 0 0 1-1.42 1.42ZM4.64 4.64a1 1 0 0 1 1.42 0l.7.7A1 1 0 0 1 5.34 6.76l-.7-.7a1 1 0 0 1 0-1.42ZM10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M17.29 12.79A8 8 0 0 1 7.21 2.71a8.001 8.001 0 1 0 10.08 10.08Z" />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'System',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M3 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Zm1.5.5v7h11v-7h-11ZM7 15.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 7 15.5Z" />
      </svg>
    ),
  },
];

/** Resolve a preference to the concrete theme the page should show. */
function resolve(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function apply(theme: Theme) {
  document.documentElement.setAttribute('data-theme', resolve(theme));
}

/**
 * Light / Dark / System switch.
 *
 * The choice lives in localStorage rather than the user's profile: it belongs
 * to the device, not the account. A shared till by a window may want light
 * while the manager's phone wants dark, and they're often the same login.
 */
export default function ThemeToggle() {
  // Start as 'system' on both server and client so the first client render
  // matches the server's HTML; the real preference is read in the effect below.
  const [theme, setTheme] = useState<Theme>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: Theme = 'system';
    try {
      stored = (localStorage.getItem(THEME_STORAGE_KEY) as Theme) || 'system';
    } catch {
      // Private browsing — keep the default.
    }
    setTheme(stored);
    setReady(true);
  }, []);

  // While following the OS, track it: someone whose phone flips to dark at
  // sunset should see the portal follow without reloading.
  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  function choose(next: Theme) {
    setTheme(next);
    apply(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference just won't persist; the page still switches.
    }
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-full border border-black/10 p-0.5 dark:border-white/15"
    >
      {OPTIONS.map((option) => {
        // Before the stored value is read, nothing is marked active — otherwise
        // 'System' would flash as selected for a user who chose Dark.
        const active = ready && theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            title={option.label}
            aria-label={option.label}
            aria-pressed={active}
            className={
              active
                ? 'flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background'
                : 'flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-black/[.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[.06] dark:hover:text-zinc-200'
            }
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}

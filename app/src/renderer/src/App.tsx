import type { ReactNode } from 'react';

import { MicPermissionModal } from './components/MicPermissionModal.js';
import { Sidebar } from './components/Sidebar.js';
import { Spinner } from './components/ui.js';
import { TitleBar } from './components/TitleBar.js';
import { UpdateToast } from './components/UpdateToast.js';
import { History } from './pages/History.js';
import { Home } from './pages/Home.js';
import { Login } from './pages/Login.js';
import { Onboarding } from './pages/Onboarding.js';
import { Settings } from './pages/Settings.js';
import { useAppState } from './state/AppState.js';

export function App(): ReactNode {
  const { status, page } = useAppState();

  if (status === 'loading') {
    return (
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-6 text-accent" />
        </div>
      </div>
    );
  }

  if (status === 'signed-out') {
    return (
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="min-h-0 flex-1">
          <Login />
        </div>
      </div>
    );
  }

  if (status === 'onboarding') {
    return (
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Onboarding />
        </div>
        <MicPermissionModal />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          {page === 'home' ? <Home /> : null}
          {page === 'history' ? <History /> : null}
          {page === 'settings' ? <Settings /> : null}
        </main>
      </div>
      <UpdateToast />
      <MicPermissionModal />
    </div>
  );
}

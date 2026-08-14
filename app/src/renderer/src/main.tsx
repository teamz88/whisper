import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import { App } from './App.js';
import { AppStateProvider } from './state/AppState.js';

const container = document.getElementById('root');
if (container === null) throw new Error('dashboard: #root missing');

createRoot(container).render(
  <StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </StrictMode>,
);

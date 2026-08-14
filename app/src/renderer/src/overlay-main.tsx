import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import { OverlayApp } from './overlay/OverlayApp.js';

const container = document.getElementById('root');
if (container === null) throw new Error('overlay: #root missing');

createRoot(container).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApiClient } from './api/client';
import { App } from './App';
import { initAppMode } from './lib/mode';
import { registerServiceWorker } from './lib/sw-register';
import './styles/tokens.css';
import './styles/app.css';

// Live or demo for this page load (VITE_API_URL, "?demo", "Exit demo"): decided once, before anything stores data.
const mode = initAppMode();

registerServiceWorker(mode);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App api={createApiClient(mode)} />
  </StrictMode>,
);

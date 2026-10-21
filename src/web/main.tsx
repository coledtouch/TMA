import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApiClient } from './api/client';
import { App } from './App';
import { registerServiceWorker } from './lib/sw-register';
import './styles/tokens.css';
import './styles/app.css';

registerServiceWorker();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App api={createApiClient()} />
  </StrictMode>,
);

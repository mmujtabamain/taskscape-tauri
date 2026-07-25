import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initTheme } from './lib/theme';
import './material-symbols.css';

// Mirror the main app's Appearance preference before the first paint (and follow
// live system flips). App.tsx re-reads it on every reveal.
initTheme();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

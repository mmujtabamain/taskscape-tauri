import 'material-symbols/outlined.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initReducedMotion } from './lib/reducedMotion';
import { initTheme } from './lib/theme';

initTheme();
initReducedMotion();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

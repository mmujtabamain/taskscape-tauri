import 'material-symbols/outlined.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { initReducedMotion } from './lib/reducedMotion';
import { initTheme } from './lib/theme';
import { SettingsWindow } from './windows/SettingsWindow';

// The settings panel is the only surface that still rides this bundle (separate
// from the main app's). The modal + filter-overlay panels moved to a standalone
// Slint helper process, so there's nothing to route by hash anymore.
initTheme();
initReducedMotion();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SettingsWindow />
  </React.StrictMode>
);

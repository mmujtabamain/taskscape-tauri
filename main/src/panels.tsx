import 'material-symbols/outlined.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { initReducedMotion } from './lib/reducedMotion';
import { initTheme } from './lib/theme';
import { SettingsWindow } from './windows/SettingsWindow';

// The Settings window is built fresh with an init script that sets
// `window.__PANEL__` before this bundle loads (see `panel_init_script` in Rust),
// so it knows which surface it is synchronously. Settings is the only panel
// window left — modals and the filter panel now render in-app in the main
// window (see components/Modal.tsx and components/preview/FilterPanel.tsx).
interface PanelData {
  kind: 'settings';
}

declare global {
  interface Window {
    __PANEL__?: PanelData;
  }
}

function route(): React.ReactElement {
  if (window.__PANEL__?.kind === 'settings') return <SettingsWindow />;
  return <div className="bg-surface-2l dark:bg-surface-2d h-screen w-screen" />;
}

initTheme();
initReducedMotion();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>{route()}</React.StrictMode>
);

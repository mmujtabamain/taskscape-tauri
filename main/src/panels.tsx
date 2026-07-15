import 'material-symbols/outlined.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { initReducedMotion } from './lib/reducedMotion';
import { initTheme } from './lib/theme';
import { ModalWindow } from './windows/ModalWindow';
import { OverlayWindow } from './windows/OverlayWindow';
import { SettingsWindow } from './windows/SettingsWindow';

// The auxiliary panels (modal / overlay / settings) share this bundle, separate
// from the main app's — the hash decides which surface this window is. Keeping
// them off `index.html` means a panel never loads the whole task-manager app.
function route(): React.ReactElement {
  const hash = window.location.hash;
  if (hash === '#settings') return <SettingsWindow />;
  if (hash === '#overlay') return <OverlayWindow />;
  return <ModalWindow />;
}

initTheme();
initReducedMotion();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>{route()}</React.StrictMode>
);

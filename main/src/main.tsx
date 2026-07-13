import 'material-symbols/outlined.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initReducedMotion } from './lib/reducedMotion';
import { initTheme } from './lib/theme';
import { ModalWindow } from './windows/ModalWindow';
import { OverlayWindow } from './windows/OverlayWindow';
import { SettingsWindow } from './windows/SettingsWindow';

// One bundle serves every window; the hash decides which surface this one is.
function route(): React.ReactElement {
  const hash = window.location.hash;
  if (hash.startsWith('#modal')) return <ModalWindow />;
  if (hash === '#settings') return <SettingsWindow />;
  if (hash === '#overlay') return <OverlayWindow />;
  return <App />;
}

initTheme();
initReducedMotion();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>{route()}</React.StrictMode>
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import { api } from './api';
import App from './App';
import './index.css';
import { initReducedMotion } from './lib/reducedMotion';
import { initTheme } from './lib/theme';
import './material-symbols.css';

initTheme();
initReducedMotion();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// The window is on screen from launch (Rust shows it in `setup` with a native
// boot box), but the WKWebView beneath is held transparent. Fade it in only
// after a frame has actually been presented — the first rAF callback runs
// before that frame paints, the nested one after it's on screen — so what fades
// in is the themed boot overlay, never the webview's white pre-paint.
// index.html's boot veil is static markup, so it's in that frame regardless of
// when React commits. A 4s fallback in Rust fades in anyway if this never runs.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    void api.revealMain();
  })
);

import '@fontsource-variable/archivo/wdth.css';
import './styles/tokens.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { servedByApp } from './data/repository';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: service worker só quando a página vem do próprio app (não no link do claude.ai, não no desenvolvimento) e o
// navegador permite — localhost ou HTTPS. Pela Wi-Fi (http://192.168…) o celular não deixa: fica para a hospedagem.
if (import.meta.env.PROD && servedByApp() && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* sem service worker o app funciona igual, só não abre sem conexão */
    });
  });
}

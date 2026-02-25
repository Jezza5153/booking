import React from 'react';
import ReactDOM from 'react-dom/client';

const isEmbedMode = () => {
  const params = new URLSearchParams(window.location.search);
  const hasEmbedParam = params.get('embed') === 'true' || params.get('widget') === 'true';
  const isInIframe = window.self !== window.top;
  return hasEmbedParam || isInIframe;
};

async function initSentry() {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  try {
    const Sentry = await import('@sentry/react');
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
    });
  } catch (error) {
    console.warn('Sentry initialization skipped:', error);
  }
}

async function bootstrap() {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Could not find root element to mount to');
  }

  const root = ReactDOM.createRoot(rootElement);
  const appModule = isEmbedMode() ? await import('./EmbedApp') : await import('./App');
  const RootComponent = appModule.default;

  root.render(
    <React.StrictMode>
      <RootComponent />
    </React.StrictMode>
  );
}

void initSentry();
void bootstrap();

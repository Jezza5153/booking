import * as Sentry from '@sentry/node';

// ============================================
// Sentry Error Tracking
// ============================================

let sentryInitialized = false;

export function initSentry(app) {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) {
        console.log('ℹ️  SENTRY_DSN not set, error tracking disabled');
        return;
    }

    Sentry.init({
        dsn,
        environment: process.env.NODE_ENV || 'production',
        tracesSampleRate: 0.1, // 10% of transactions for performance monitoring
        integrations: [
            // Enable HTTP calls tracing
            Sentry.httpIntegration({ tracing: true }),
        ],
    });

    // The request handler must be the first middleware
    app.use(Sentry.Handlers.requestHandler());

    sentryInitialized = true;
    console.log('✅ Sentry error tracking initialized');
}

export function sentryErrorHandler(app) {
    if (!sentryInitialized) return;

    // The error handler must be before any other error middleware and after all controllers
    app.use(Sentry.Handlers.errorHandler());
}

export function captureException(error, context = {}) {
    if (sentryInitialized) {
        Sentry.captureException(error, { extra: context });
    }
    console.error('Error captured:', error.message, context);
}

export function captureMessage(message, level = 'info') {
    if (sentryInitialized) {
        Sentry.captureMessage(message, level);
    }
}

export { Sentry };

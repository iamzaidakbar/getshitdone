/**
 * Express App Configuration
 * Sets up middleware, routes, and global error handling
 * Includes comprehensive security hardening (Phase 7)
 */

const express = require('express');
const compression = require('compression');
const morgan = require('morgan');

const config = require('./config');
const { errorHandler, logger } = require('./utils');
const errorHandlerMiddleware = require('./middlewares');
const security = require('./utils/security');

// Initialize Bull queue for payment webhook processing
const { paymentQueue } = require('./modules/payments/worker');

// Initialize cache invalidation listeners
const { initializeCacheInvalidation } = require('./utils/cacheInvalidation');

const app = express();

// Trust proxy (for rate limiting and IP detection behind reverse proxy)
app.set('trust proxy', 1);

// ============================================================================
// SECURITY MIDDLEWARE (Phase 7)
// ============================================================================

// 1. Helmet - HTTP security headers
app.use(security.helmetConfig());

// 2. CORS - Explicit origin allowlist
app.use(security.corsConfig());

// 3. Request logging with Morgan
const morganFormat = config.isDev ? 'dev' : 'combined';
app.use(
  morgan(morganFormat, {
    skip: (req) => req.path === '/health', // Don't log health checks
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

// 4. Body parser middleware with size limits
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ limit: '16kb', extended: true }));

// 5. Compression middleware
app.use(compression());

// 6. NoSQL injection prevention (MongoDB operator sanitization)
app.use(security.mongoSanitizer);

// 7. XSS attack prevention (input sanitization)
app.use(security.xssSanitizer);

// 8. HTTP Parameter Pollution prevention
app.use(security.hppProtection);

// 9. Global rate limiting (100 req/15min per IP)
app.use('/api/', security.globalLimiter);

// 10. Security headers logging
app.use(security.securityHeadersLogger);

// Initialize cache invalidation
initializeCacheInvalidation();

// ============================================================================
// ROUTES
// ============================================================================

// Health check endpoint (no rate limiting)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Apply specific rate limiters to sensitive auth endpoints
// (global limiter already applies to all /api/* routes)
app.use('/api/v1/auth/login', security.authLimiter);
app.use('/api/v1/auth/register', security.authLimiter);
app.use('/api/v1/auth/password-reset', security.sensitiveOperationLimiter);
app.use('/api/v1/auth/refresh', security.authLimiter);

// API Routes
app.use('/api', require('./routes'));

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    statusCode: 404,
    message: 'Route not found',
    success: false,
  });
});

// Global error handler (must be last)
app.use(errorHandlerMiddleware.errorHandler);

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

// Close payment queue on app shutdown
app.on('close', async () => {
  logger.info('Closing payment queue...');
  await paymentQueue.close();
});

module.exports = app;

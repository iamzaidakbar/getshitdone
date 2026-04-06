/**
 * Security Middleware Module
 * Implements comprehensive security hardening:
 * - Helmet for HTTP headers
 * - Rate limiting (global + auth-specific)
 * - Input sanitization (MongoDB + XSS)
 * - HTTP Parameter Pollution prevention
 * - CORS with explicit allowlist
 * - Request size limits
 */

const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const { xss } = require('express-xss-sanitizer');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('./logger');

/**
 * Configure Helmet for HTTP security headers
 * Sets:
 * - Content Security Policy (CSP)
 * - X-Frame-Options (clickjacking protection)
 * - X-Content-Type-Options (MIME type sniffing)
 * - X-XSS-Protection (browser XSS filter)
 * - Referrer-Policy
 * - Strict-Transport-Security (HSTS)
 */
const helmetConfig = () => {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: !config.isDev,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
  });
};

/**
 * Configure CORS with explicit origin allowlist
 * Never use '*' in production
 */
const corsConfig = () => {
  const allowedOrigins = config.cors.origin?.split(',') || ['http://localhost:3000'];

  return cors({
    origin: (origin, callback) => {
      // Allow requests without origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      logger.warn('CORS blocked request from unauthorized origin', { origin });
      return callback(new Error('CORS policy: origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
    maxAge: 86400, // 24 hours
  });
};

/**
 * Global rate limiter (applies to all /api routes)
 * 100 requests per 15 minutes per IP
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP. Please try again after 15 minutes.',
  standardHeaders: true, // Return RateLimit-* headers
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks and static assets
    return req.path === '/health' || req.path.startsWith('/static');
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

/**
 * Auth-specific rate limiter (stricter)
 * 5 requests per 15 minutes per IP for login/register
 * Prevents brute force attacks
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many authentication attempts. Account temporarily locked.',
  skipSuccessfulRequests: true, // Don't count successful requests
  skipFailedRequests: false, // Count failed requests
  keyGenerator: (req) => {
    // Rate limit by email or IP (email takes precedence if provided)
    return req.body?.email || req.ip;
  },
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email || 'unknown',
      path: req.path,
    });
    res.status(429).json({
      success: false,
      message:
        'Too many login attempts. Please try again after 15 minutes or reset your password.',
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

/**
 * Stringify rate limiter for sensitive operations
 * 10 requests per 1 hour for password reset, 2FA, etc.
 */
const sensitiveOperationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many requests for this sensitive operation.',
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.body?.email || req.user?.id || req.ip,
  handler: (req, res) => {
    logger.warn('Sensitive operation rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path,
    });
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

/**
 * NoSQL Injection prevention
 * Sanitizes request body to remove MongoDB operators
 * Prevents queries like {"$ne": null}
 */
const mongoSanitizer = mongoSanitize({
  replaceWith: '_', // Replace $ and . with underscore
  onSanitize: ({req, key}) => {
    logger.warn('Potential NoSQL injection attempt blocked', {
      ip: req.ip,
      path: req.path,
      key,
      method: req.method,
    });
  },
});

/**
 * XSS attack prevention
 * Sanitizes user input to remove malicious scripts
 * Prevents inputs like <script>alert('xss')</script>
 */
const xssSanitizer = xss();

/**
 * HTTP Parameter Pollution prevention
 * Prevents attacks where multiple parameters with same name are sent
 */
const hppProtection = hpp({
  whitelist: [
    // List of parameters that can have multiple values
    'sort',
    'fields',
    'page',
    'limit',
    'category',
    'tags',
  ],
});

/**
 * Request body size limiter
 * Prevents DoS attacks via huge payloads
 */
const bodySizeLimiter = (req, res, next) => {
  const maxSize = 16 * 1024; // 16KB
  let size = 0;

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > maxSize) {
      logger.warn('Request body exceeds size limit', {
        ip: req.ip,
        path: req.path,
        size,
        maxSize,
      });
      res.status(413).json({
        success: false,
        message: 'Request body too large. Maximum 16KB allowed.',
      });
      req.connection.destroy();
    }
  });

  next();
};

/**
 * Security headers logger
 * Logs all requests with security headers for audit
 */
const securityHeadersLogger = (req, res, next) => {
  // Log security-relevant headers
  const securityHeaders = {
    'user-agent': req.get('user-agent'),
    'x-forwarded-for': req.get('x-forwarded-for'),
    'x-api-key': req.get('x-api-key') ? '[REDACTED]' : undefined,
    'authorization': req.get('authorization') ? '[REDACTED]' : undefined,
  };

  // Log on response
  const originalSend = res.send;
  res.send = function (data) {
    if (res.statusCode >= 400) {
      logger.debug('Security-relevant request', {
        ip: req.ip,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        headers: securityHeaders,
      });
    }
    return originalSend.call(this, data);
  };

  next();
};

module.exports = {
  helmetConfig,
  corsConfig,
  globalLimiter,
  authLimiter,
  sensitiveOperationLimiter,
  mongoSanitizer,
  xssSanitizer,
  hppProtection,
  bodySizeLimiter,
  securityHeadersLogger,
};

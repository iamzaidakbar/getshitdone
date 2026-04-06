/**
 * Winston Logger Configuration
 * Logs to console (dev), daily rotating files (prod)
 * Supports multiple log levels: error, warn, info, debug
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const config = require('../config');

const { combine, timestamp, printf, colorize, errors } = winston.format;

/**
 * Redact sensitive information from logs
 * Prevents passwords, tokens, and PII from being logged
 */
const redactSensitive = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  const sensitiveKeys = [
    'password',
    'pwd',
    'pass',
    'secret',
    'token',
    'accessToken',
    'refreshToken',
    'apiKey',
    'api_key',
    'authorization',
    'bearer',
    'creditCard',
    'cardNumber',
    'cvv',
    'ssn',
    'socialSecurityNumber',
    'privateKey',
    'secretKey',
    'resetToken',
    'verificationCode',
    'otp',
    'stripeKey',
    'awsSecret',
  ];

  const redacted = JSON.parse(JSON.stringify(obj));

  const redactKeys = (obj, keys) => {
    if (typeof obj !== 'object' || obj === null) return;

    for (const key in obj) {
      const lowerKey = key.toLowerCase();
      if (keys.some((k) => lowerKey.includes(k.toLowerCase()))) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object') {
        redactKeys(obj[key], keys);
      }
    }
  };

  redactKeys(redacted, sensitiveKeys);
  return redacted;
};

// Custom log format with sensitive data redaction
const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  // Redact sensitive data from metadata
  const redactedMeta = redactSensitive(meta);
  const redactedMessage = typeof message === 'object' ? redactSensitive(message) : message;

  let metaStr = '';
  if (Object.keys(redactedMeta).length > 0) {
    metaStr = ' ' + JSON.stringify(redactedMeta);
  }

  return `${timestamp} [${level}] ${stack || redactedMessage}${metaStr}`;
});

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(process.cwd(), config.logger.dir);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const transports = [];

// Console transport (for dev)
if (config.isDev) {
  transports.push(
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
      ),
    })
  );
}

// File transport (daily rotation)
transports.push(
  new DailyRotateFile({
    filename: path.join(logsDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      errors({ stack: true }),
      logFormat
    ),
  })
);

// Error log file (for errors only)
transports.push(
  new DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: '20m',
    maxFiles: '14d',
    format: combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      errors({ stack: true }),
      logFormat
    ),
  })
);

const logger = winston.createLogger({
  level: config.logger.level,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true })
  ),
  transports,
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
    }),
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
    }),
  ],
});

module.exports = logger;

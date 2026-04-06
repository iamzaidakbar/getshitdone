/**
 * Centralized Configuration Management
 * Validates and exports all environment variables
 * Throws error if required vars are missing
 */

require('dotenv').config({
  path: `.env.${process.env.NODE_ENV || 'dev'}`,
});

const Joi = require('joi');

// Define validation schema for environment variables
const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string()
      .valid('dev', 'prod', 'test')
      .required(),
    PORT: Joi.number()
      .default(5000),
    MONGODB_URI: Joi.string()
      .required()
      .description('MongoDB connection string'),
    JWT_SECRET: Joi.string()
      .required()
      .description('JWT secret key'),
    JWT_EXPIRE: Joi.string()
      .default('7d'),
    EMAIL_HOST: Joi.string()
      .default('smtp.gmail.com'),
    EMAIL_PORT: Joi.number()
      .default(587),
    EMAIL_SECURE: Joi.string()
      .valid('true', 'false')
      .default('false'),
    EMAIL_USER: Joi.string()
      .required()
      .description('Email service username'),
    EMAIL_PASSWORD: Joi.string()
      .required()
      .description('Email service password'),
    EMAIL_FROM: Joi.string()
      .required()
      .description('From email address'),
    FRONTEND_URL: Joi.string()
      .default('http://localhost:3000'),
    LOG_LEVEL: Joi.string()
      .valid('error', 'warn', 'info', 'debug')
      .default('info'),
    LOG_DIR: Joi.string()
      .default('./logs'),
    CORS_ORIGIN: Joi.string()
      .required(),
    RATE_LIMIT_WINDOW_MS: Joi.number()
      .default(15000),
    RATE_LIMIT_MAX_REQUESTS: Joi.number()
      .default(100),
    GOOGLE_CLIENT_ID: Joi.string()
      .allow('')
      .default(''),
    GOOGLE_CLIENT_SECRET: Joi.string()
      .allow('')
      .default(''),
    GITHUB_CLIENT_ID: Joi.string()
      .allow('')
      .default(''),
    GITHUB_CLIENT_SECRET: Joi.string()
      .allow('')
      .default(''),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema.prefs({ errors: { label: 'key' } }).validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

module.exports = {
  isDev: envVars.NODE_ENV === 'dev',
  isProd: envVars.NODE_ENV === 'prod',
  isTest: envVars.NODE_ENV === 'test',
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  mongoose: {
    url: envVars.MONGODB_URI,
  },
  jwt: {
    secret: envVars.JWT_SECRET,
    expiresIn: envVars.JWT_EXPIRE,
  },
  email: {
    host: envVars.EMAIL_HOST,
    port: envVars.EMAIL_PORT,
    secure: envVars.EMAIL_SECURE === 'true',
    auth: {
      user: envVars.EMAIL_USER,
      pass: envVars.EMAIL_PASSWORD,
    },
    from: envVars.EMAIL_FROM,
  },
  frontend: {
    url: envVars.FRONTEND_URL,
  },
  logger: {
    level: envVars.LOG_LEVEL,
    dir: envVars.LOG_DIR,
  },
  cors: {
    origin: envVars.CORS_ORIGIN,
  },
  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS,
  },
  oauth: {
    google: {
      clientId: envVars.GOOGLE_CLIENT_ID,
      clientSecret: envVars.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: envVars.GITHUB_CLIENT_ID,
      clientSecret: envVars.GITHUB_CLIENT_SECRET,
    },
  },
};

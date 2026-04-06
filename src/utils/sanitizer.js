/**
 * Input Validation & Sanitization Utilities
 * Provides reusable validators and sanitizers for all endpoints
 */

const Joi = require('joi');
const logger = require('./logger');

/**
 * Sanitize user input to prevent common attacks
 * - Trim whitespace
 * - Remove null bytes
 * - Escape HTML entities
 * - Remove control characters
 */
const sanitizeInput = (input) => {
  if (typeof input !== 'string') {
    return input;
  }

  return input
    .trim() // Remove leading/trailing whitespace
    .replace(/\0/g, '') // Remove null bytes
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .substring(0, 10000); // Limit length
};

/**
 * Validate and sanitize email
 */
const validateEmail = (email) => {
  const schema = Joi.string()
    .email({ minDomainSegments: 2 })
    .required()
    .lowercase()
    .trim();

  const { error, value } = schema.validate(email);
  return { isValid: !error, value: value?.toLowerCase(), error: error?.message };
};

/**
 * Validate password strength
 * Requirements:
 * - At least 8 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number
 * - At least 1 special character
 */
const validatePassword = (password) => {
  const schema = Joi.string()
    .min(8)
    .max(128)
    .pattern(/[A-Z]/, 'uppercase')
    .pattern(/[a-z]/, 'lowercase')
    .pattern(/[0-9]/, 'digit')
    .pattern(/[!@#$%^&*(),.?":{}|<>]/, 'special character')
    .required();

  const { error, value } = schema.validate(password);

  if (error) {
    return {
      isValid: false,
      error: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character',
    };
  }

  return { isValid: true, value };
};

/**
 * Validate MongoDB ObjectId
 */
const validateObjectId = (id) => {
  const schema = Joi.string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .required();

  const { error, value } = schema.validate(id);
  return { isValid: !error, value, error: error?.message };
};

/**
 * Sanitize search query
 * Prevents NoSQL injection and excessive wildcards
 */
const sanitizeSearchQuery = (query) => {
  if (!query || typeof query !== 'string') {
    return '';
  }

  // Remove dangerous characters and operators
  let sanitized = query
    .replace(/[\$\{\}]/g, '') // Remove $, {, }
    .replace(/[*]{2,}/g, '*') // Limit consecutive wildcards
    .trim()
    .substring(0, 100); // Limit length

  return sanitized;
};

/**
 * Validate pagination parameters
 */
const validatePagination = (page = 1, limit = 10) => {
  const schema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
  });

  const { error, value } = schema.validate({ page, limit });

  return {
    isValid: !error,
    page: value.page,
    limit: value.limit,
    error: error?.message,
  };
};

/**
 * Create a joi validator middleware
 * Usage: router.post('/endpoint', validateRequest(schema), handler)
 */
const validateRequest = (schema) => {
  return (req, res, next) => {
    const dataToValidate = {
      body: req.body,
      params: req.params,
      query: req.query,
    };

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      stripUnknown: true, // Remove unknown properties
      convert: true, // Convert types if possible
    });

    if (error) {
      logger.warn('Validation error', {
        path: req.path,
        method: req.method,
        ip: req.ip,
        errors: error.details.map((d) => ({
          field: d.path.join('.'),
          message: d.message,
          type: d.type,
        })),
      });

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.details.map((d) => ({
          field: d.path.join('.'),
          message: d.message,
        })),
      });
    }

    // Attach sanitized/validated data to request
    req.body = value.body || req.body;
    req.params = value.params || req.params;
    req.query = value.query || req.query;

    next();
  };
};

/**
 * Validate input data object
 */
const validateData = (data, schema) => {
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  return {
    isValid: !error,
    data: value,
    errors: error?.details || [],
  };
};

/**
 * Safe input parser for JSON
 * Prevents prototype pollution and other attacks
 */
const parseJSON = (jsonString) => {
  try {
    const parsed = JSON.parse(jsonString);

    // Check for prototype pollution
    if (parsed.__proto__ || parsed.constructor || parsed.prototype) {
      logger.warn('Potential prototype pollution attempt', {
        attempted: Object.keys(parsed),
      });
      return null;
    }

    return parsed;
  } catch (error) {
    logger.warn('JSON parse error', { error: error.message });
    return null;
  }
};

module.exports = {
  sanitizeInput,
  validateEmail,
  validatePassword,
  validateObjectId,
  sanitizeSearchQuery,
  validatePagination,
  validateRequest,
  validateData,
  parseJSON,
};

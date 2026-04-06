/**
 * JWT Token Utility
 * Handles token generation, verification, and refresh token rotation
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const logger = require('./logger');

const JWT_ALGORITHM = 'HS256'; // HS256 for symmetric key; RS256 would require RSA keypair
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

/**
 * Generate access token (short-lived)
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @returns {string} JWT access token
 */
const generateAccessToken = (userId, role) => {
  try {
    const token = jwt.sign(
      {
        sub: userId,
        role,
        type: 'access',
      },
      config.jwt.secret,
      {
        algorithm: JWT_ALGORITHM,
        expiresIn: ACCESS_TOKEN_EXPIRY,
        issuer: 'getshitdone-api',
        audience: 'getshitdone-app',
      }
    );
    return token;
  } catch (error) {
    logger.error('Error generating access token', { errorMessage: error.message });
    throw error;
  }
};

/**
 * Generate refresh token (long-lived, stored in DB as hashed)
 * Returns both the plaintext token and its hash for DB storage
 * @param {string} userId - User ID
 * @returns {{token: string, hash: string}} Plaintext token + hash
 */
const generateRefreshToken = (userId) => {
  try {
    const plainToken = jwt.sign(
      {
        sub: userId,
        type: 'refresh',
      },
      config.jwt.secret,
      {
        algorithm: JWT_ALGORITHM,
        expiresIn: REFRESH_TOKEN_EXPIRY,
        issuer: 'getshitdone-api',
        audience: 'getshitdone-app',
      }
    );

    // Hash the token before storing in DB (SHA-256)
    const hash = crypto
      .createHash('sha256')
      .update(plainToken)
      .digest('hex');

    return { token: plainToken, hash };
  } catch (error) {
    logger.error('Error generating refresh token', { errorMessage: error.message });
    throw error;
  }
};

/**
 * Verify access token
 * @param {string} token - JWT token to verify
 * @returns {object} Decoded token payload
 */
const verifyAccessToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.jwt.secret, {
      algorithms: [JWT_ALGORITHM],
      issuer: 'getshitdone-api',
      audience: 'getshitdone-app',
    });

    // Ensure token type
    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    logger.debug('Access token verification failed', {
      errorMessage: error.message,
      errorName: error.name,
    });
    throw error;
  }
};

/**
 * Verify refresh token
 * @param {string} token - JWT token to verify
 * @returns {object} Decoded token payload
 */
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.jwt.secret, {
      algorithms: [JWT_ALGORITHM],
      issuer: 'getshitdone-api',
      audience: 'getshitdone-app',
    });

    // Ensure token type
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    logger.debug('Refresh token verification failed', {
      errorMessage: error.message,
      errorName: error.name,
    });
    throw error;
  }
};

/**
 * Hash refresh token for secure DB storage
 * @param {string} token - Plaintext token
 * @returns {string} SHA-256 hash
 */
const hashRefreshToken = (token) => {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
};

/**
 * Decode token without verification (for debugging only)
 * @param {string} token - JWT token
 * @returns {object} Decoded payload
 */
const decodeToken = (token) => {
  return jwt.decode(token);
};

/**
 * Extract token from Authorization header
 * @param {string} authHeader - Authorization header (e.g., "Bearer token123")
 * @returns {string|null} Token or null
 */
const extractTokenFromHeader = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7); // Remove "Bearer " prefix
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashRefreshToken,
  decodeToken,
  extractTokenFromHeader,
};

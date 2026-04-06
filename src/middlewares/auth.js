/**
 * Authentication & Authorization Middleware
 * Handles JWT verification and role-based access control
 */

const { ApiError } = require('../utils');
const { jwt } = require('../utils');
const logger = require('../utils/logger');

/**
 * Require authentication middleware
 * Verifies JWT token and attaches user info to req.user
 */
const requireAuth = (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    const token = jwt.extractTokenFromHeader(authHeader);

    if (!token) {
      throw new ApiError(401, 'Authorization token is required');
    }

    // Verify token
    const decoded = jwt.verifyAccessToken(token);

    // Attach user info to request
    req.user = {
      id: decoded.sub,
      role: decoded.role,
      type: decoded.type,
    };
    req.token = token;

    logger.debug('User authenticated', { userId: req.user.id, role: req.user.role });
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      return next(error);
    }

    // JWT verification errors
    if (error.name === 'TokenExpiredError') {
      logger.debug('Token expired', { errorMessage: error.message });
      return next(
        new ApiError(
          401,
          'Access token has expired. Please refresh your token.',
          { expiredAt: error.expiredAt }
        )
      );
    }

    if (error.name === 'JsonWebTokenError') {
      logger.debug('Invalid token', { errorMessage: error.message });
      return next(new ApiError(401, 'Invalid or malformed access token'));
    }

    // Generic error
    logger.error('Authentication failed', { errorMessage: error.message });
    next(new ApiError(401, 'Authentication failed'));
  }
};

/**
 * Require specific role(s)
 * @param {...string} roles - Allowed roles
 * @returns {function} Middleware function
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    try {
      // Ensure user is authenticated
      if (!req.user) {
        throw new ApiError(401, 'User not authenticated');
      }

      // Check if user has required role
      if (!roles.includes(req.user.role)) {
        logger.warn('Access denied due to insufficient role', {
          userId: req.user.id,
          userRole: req.user.role,
          requiredRoles: roles,
          path: req.path,
          method: req.method,
        });
        throw new ApiError(
          403,
          `Insufficient permissions. Required role(s): ${roles.join(', ')}`,
          { requiredRoles: roles, userRole: req.user.role }
        );
      }

      logger.debug('Role requirement satisfied', {
        userId: req.user.id,
        role: req.user.role,
      });
      next();
    } catch (error) {
      if (error instanceof ApiError) {
        return next(error);
      }
      logger.error('Role verification failed', { errorMessage: error.message });
      next(new ApiError(403, 'Forbidden'));
    }
  };
};

/**
 * Optional authentication middleware
 * Tries to authenticate but doesn't fail if token is missing
 * Useful for endpoints that work both authenticated and unauthenticated
 */
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = jwt.extractTokenFromHeader(authHeader);

    if (!token) {
      // No token provided, but that's OK
      return next();
    }

    // Try to verify token
    const decoded = jwt.verifyAccessToken(token);
    req.user = {
      id: decoded.sub,
      role: decoded.role,
      type: decoded.type,
    };
    req.token = token;

    logger.debug('Optional auth verified', { userId: req.user.id });
  } catch (error) {
    // Verification failed, but don't throw - just continue without user
    logger.debug('Optional auth skipped', { reason: error.message });
  }

  next();
};

/**
 * Refresh token verification middleware
 * Used for refresh endpoints to verify refresh token
 */
const verifyRefreshToken = (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new ApiError(400, 'Refresh token is required');
    }

    // Verify refresh token
    const decoded = jwt.verifyRefreshToken(refreshToken);

    // Attach decoded info to request
    req.refreshTokenPayload = decoded;

    next();
  } catch (error) {
    if (error instanceof ApiError) {
      return next(error);
    }

    if (error.name === 'TokenExpiredError') {
      logger.debug('Refresh token expired', { errorMessage: error.message });
      return next(new ApiError(401, 'Refresh token has expired. Please login again.'));
    }

    if (error.name === 'JsonWebTokenError') {
      logger.debug('Invalid refresh token', { errorMessage: error.message });
      return next(new ApiError(401, 'Invalid refresh token'));
    }

    logger.error('Refresh token verification failed', { errorMessage: error.message });
    next(new ApiError(401, 'Refresh token verification failed'));
  }
};

module.exports = {
  requireAuth,
  requireRole,
  optionalAuth,
  verifyRefreshToken,
};

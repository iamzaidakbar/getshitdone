/**
 * Auth Routes
 * Handles authentication endpoints: register, login, refresh, logout, password reset
 */

const express = require('express');
const authController = require('./controller');
const { asyncHandler } = require('../../utils');
const { requireAuth } = require('../../middlewares/auth');
const { registerSchema, loginSchema, verifyEmailSchema, refreshTokenSchema, forgotPasswordSchema, resetPasswordSchema } = require('../../config/validationSchemas');

const router = express.Router();

/**
 * Validate request body against schema
 * @param {Joi.ObjectSchema} schema - Joi validation schema
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errors = error.details.reduce((acc, detail) => {
      acc[detail.path[0]] = detail.message;
      return acc;
    }, {});

    return res.status(400).json({
      statusCode: 400,
      data: null,
      message: 'Validation error',
      errors,
      success: false,
    });
  }

  req.validatedBody = value;
  next();
};

/**
 * POST /api/v1/auth/register
 * Register a new user
 * Body: { email, password, firstName?, lastName?, phone? }
 */
router.post('/register', validate(registerSchema), asyncHandler(authController.register));

/**
 * POST /api/v1/auth/verify-email
 * Verify user email with token
 * Body: { token }
 */
router.post(
  '/verify-email',
  validate(verifyEmailSchema),
  asyncHandler(authController.verifyEmail)
);

/**
 * POST /api/v1/auth/login
 * Login user and return access token
 * Body: { email, password }
 */
router.post('/login', validate(loginSchema), asyncHandler(authController.login));

/**
 * POST /api/v1/auth/refresh
 * Refresh access token using refresh token
 * Body: { refreshToken } (or from cookie)
 * Implements token rotation
 */
router.post(
  '/refresh',
  validate(refreshTokenSchema),
  asyncHandler(authController.refresh)
);

/**
 * POST /api/v1/auth/logout
 * Logout user (invalidate current refresh token)
 * Requires: Authorization header with access token
 * Body: { refreshToken? }
 */
router.post('/logout', requireAuth, asyncHandler(authController.logout));

/**
 * POST /api/v1/auth/logout-all
 * Logout from all devices (invalidate all refresh tokens)
 * Requires: Authorization header with access token
 */
router.post('/logout-all', requireAuth, asyncHandler(authController.logoutAll));

/**
 * POST /api/v1/auth/forgot-password
 * Request password reset email
 * Body: { email }
 */
router.post(
  '/forgot-password',
  validate(forgotPasswordSchema),
  asyncHandler(authController.forgotPassword)
);

/**
 * POST /api/v1/auth/reset-password
 * Reset password with token
 * Body: { token, newPassword }
 */
router.post(
  '/reset-password',
  validate(resetPasswordSchema),
  asyncHandler(authController.resetPassword)
);

/**
 * GET /api/v1/auth/me
 * Get current authenticated user profile
 * Requires: Authorization header with access token
 */
router.get('/me', requireAuth, asyncHandler(authController.getCurrentUser));

/**
 * OAuth2 Routes (Google, GitHub)
 */

// TODO: Implement OAuth controllers and handlers
// This requires setting up Passport middleware in app.js
// and creating OAuth callback handlers in the auth controller

// Example routes (commented out - implement when ready):
// router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
// router.get('/google/callback', passport.authenticate('google'), authController.googleCallback);
//
// router.get('/github', passport.authenticate('github', { scope: ['user:email'] }));
// router.get('/github/callback', passport.authenticate('github'), authController.githubCallback);

module.exports = router;

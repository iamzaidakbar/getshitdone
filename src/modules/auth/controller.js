/**
 * Auth Controller
 * Handles user registration, login, token refresh, and logout
 */

const crypto = require('crypto');
const { User } = require('../config/models');
const { ApiError, ApiResponse, jwt, email, logger } = require('../utils');

/**
 * Register new user
 * POST /api/v1/auth/register
 */
const register = async (req, res, next) => {
  try {
    const { email: userEmail, password, firstName, lastName, phone } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email: userEmail });
    if (existingUser) {
      throw new ApiError(409, 'Email is already registered', { field: 'email' });
    }

    // Generate email verification token (valid for 24 hours)
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create new user
    const newUser = new User({
      email: userEmail,
      passwordHash: password,
      firstName,
      lastName,
      phone,
      emailVerificationToken,
      emailVerificationTokenExpiry: tokenExpiry,
      oauthProvider: 'local',
    });

    // Save user (password will be hashed by pre-save hook)
    await newUser.save();

    logger.info('User registered successfully', {
      userId: newUser._id,
      email: newUser.email,
    });

    // Send verification email (async - don't wait for it)
    try {
      await email.sendVerificationEmail(
        userEmail,
        emailVerificationToken,
        process.env.FRONTEND_URL || 'http://localhost:3000'
      );
    } catch (emailError) {
      logger.warn('Failed to send verification email', {
        userId: newUser._id,
        errorMessage: emailError.message,
      });
      // Don't fail registration if email fails
    }

    // Return success response (user is not yet verified)
    res.status(201).json(
      new ApiResponse(201, { userId: newUser._id, email: newUser.email }, 'Registration successful. Check your email to verify your account.')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Verify email
 * POST /api/v1/auth/verify-email
 */
const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      throw new ApiError(400, 'Verification token is required');
    }

    // Find user with matching token
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationTokenExpiry: { $gt: new Date() }, // Token not expired
    });

    if (!user) {
      throw new ApiError(400, 'Invalid or expired verification token');
    }

    // Mark email as verified and clear token
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationTokenExpiry = undefined;
    await user.save();

    logger.info('Email verified successfully', {
      userId: user._id,
      email: user.email,
    });

    // Send welcome email (async - don't wait)
    try {
      await email.sendWelcomeEmail(user.email, user.firstName);
    } catch (emailError) {
      logger.warn('Failed to send welcome email', {
        userId: user._id,
        errorMessage: emailError.message,
      });
    }

    res.json(
      new ApiResponse(200, { email: user.email }, 'Email verified successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Login user
 * POST /api/v1/auth/login
 */
const login = async (req, res, next) => {
  try {
    const { email: userEmail, password } = req.body;

    // Find user by email and select password field
    const user = await User.findOne({ email: userEmail }).select('+passwordHash');

    if (!user) {
      // Don't reveal if email exists (security best practice)
      throw new ApiError(401, 'Invalid email or password');
    }

    // Check if email is verified
    if (!user.emailVerified && user.oauthProvider === 'local') {
      throw new ApiError(403, 'Please verify your email before logging in', {
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw new ApiError(401, 'Invalid email or password');
    }

    // Generate tokens
    const { token: refreshToken, hash: refreshTokenHash } = jwt.generateRefreshToken(user._id);
    const accessToken = jwt.generateAccessToken(user._id, user.role);

    // Store hashed refresh token in DB
    user.refreshTokens.push({
      token: refreshTokenHash,
      createdAt: new Date(),
    });

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    logger.info('User logged in successfully', {
      userId: user._id,
      email: user.email,
    });

    // Return tokens (don't expose refresh token in body for security in production)
    // Set refresh token as HTTP-only cookie instead
    res
      .cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'prod',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      })
      .json(
        new ApiResponse(
          200,
          {
            user: user.toJSON(),
            accessToken,
          },
          'Login successful'
        )
      );
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh access token
 * POST /api/v1/auth/refresh
 * Implements refresh token rotation: old token is deleted, new one is issued
 */
const refresh = async (req, res, next) => {
  try {
    let refreshToken = req.body.refreshToken;

    // If not in body, try to get from cookie
    if (!refreshToken) {
      refreshToken = req.cookies?.refreshToken;
    }

    if (!refreshToken) {
      throw new ApiError(401, 'Refresh token is required');
    }

    // Verify refresh token
    const decoded = jwt.verifyRefreshToken(refreshToken);
    const userId = decoded.sub;

    // Find user and check if refresh token is stored
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(401, 'User not found');
    }

    // Hash the received token to compare with stored hashes
    const tokenHash = jwt.hashRefreshToken(refreshToken);
    const storedToken = user.refreshTokens.find((rt) => rt.token === tokenHash);

    if (!storedToken) {
      logger.warn('Refresh token not found in DB', { userId });
      throw new ApiError(401, 'Invalid refresh token. Please login again.');
    }

    // Token rotation: delete old token and issue new one
    user.refreshTokens = user.refreshTokens.filter((rt) => rt.token !== tokenHash);

    // Generate new tokens
    const { token: newRefreshToken, hash: newRefreshTokenHash } = jwt.generateRefreshToken(userId);
    const newAccessToken = jwt.generateAccessToken(userId, user.role);

    // Store new refresh token
    user.refreshTokens.push({
      token: newRefreshTokenHash,
      createdAt: new Date(),
    });

    await user.save();

    logger.info('Token refreshed successfully', {
      userId,
      email: user.email,
    });

    // Return new tokens
    res
      .cookie('refreshToken', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'prod',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      })
      .json(
        new ApiResponse(
          200,
          {
            accessToken: newAccessToken,
          },
          'Token refreshed successfully'
        )
      );
  } catch (error) {
    next(error);
  }
};

/**
 * Logout user
 * POST /api/v1/auth/logout
 * Invalidates all refresh tokens for this user
 */
const logout = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      throw new ApiError(401, 'User not authenticated');
    }

    // Option 1: Clear only the current refresh token
    // This allows user to be logged in on multiple devices
    let refreshToken = req.body.refreshToken;
    if (!refreshToken) {
      refreshToken = req.cookies?.refreshToken;
    }

    if (refreshToken) {
      const tokenHash = jwt.hashRefreshToken(refreshToken);
      await User.updateOne(
        { _id: userId },
        { $pull: { refreshTokens: { token: tokenHash } } }
      );
    }

    logger.info('User logged out', { userId });

    // Clear cookie
    res.clearCookie('refreshToken');

    res.json(new ApiResponse(200, null, 'Logged out successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Logout from all devices
 * POST /api/v1/auth/logout-all
 * Invalidates all refresh tokens for the user
 */
const logoutAll = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      throw new ApiError(401, 'User not authenticated');
    }

    // Clear all refresh tokens
    await User.updateOne({ _id: userId }, { $set: { refreshTokens: [] } });

    logger.info('User logged out from all devices', { userId });

    res.clearCookie('refreshToken');

    res.json(
      new ApiResponse(200, null, 'Logged out from all devices successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Request password reset
 * POST /api/v1/auth/forgot-password
 */
const forgotPassword = async (req, res, next) => {
  try {
    const { email: userEmail } = req.body;

    // Find user by email
    const user = await User.findOne({ email: userEmail });

    // Always return success for security (don't leak if email exists)
    if (!user) {
      return res.json(
        new ApiResponse(
          200,
          null,
          'If an account with that email exists, you will receive a password reset email'
        )
      );
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    user.passwordResetToken = resetToken;
    user.passwordResetTokenExpiry = tokenExpiry;
    await user.save();

    logger.info('Password reset token generated', {
      userId: user._id,
      email: userEmail,
    });

    // Send reset email (async)
    try {
      await email.sendPasswordResetEmail(
        userEmail,
        resetToken,
        process.env.FRONTEND_URL || 'http://localhost:3000'
      );
    } catch (emailError) {
      logger.error('Failed to send password reset email', {
        userId: user._id,
        errorMessage: emailError.message,
      });
    }

    res.json(
      new ApiResponse(
        200,
        null,
        'If an account with that email exists, you will receive a password reset email'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Reset password with token
 * POST /api/v1/auth/reset-password
 */
const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token) {
      throw new ApiError(400, 'Reset token is required');
    }

    // Find user with matching token
    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetTokenExpiry: { $gt: new Date() }, // Token not expired
    });

    if (!user) {
      throw new ApiError(400, 'Invalid or expired reset token');
    }

    // Update password
    user.passwordHash = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetTokenExpiry = undefined;

    // Clear all existing refresh tokens (force re-login on all devices)
    user.refreshTokens = [];

    await user.save();

    logger.info('Password reset successfully', {
      userId: user._id,
      email: user.email,
    });

    res.json(
      new ApiResponse(200, null, 'Password reset successfully. Please login with your new password.')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user profile
 * GET /api/v1/auth/me
 */
const getCurrentUser = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      throw new ApiError(401, 'User not authenticated');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    res.json(
      new ApiResponse(200, user.toJSON(), 'User profile retrieved successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * OAuth2 Callback Handler (Google, GitHub)
 * Called after successful OAuth authentication
 * Generates tokens and redirects to frontend
 */
const oauthCallback = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user) {
      throw new ApiError(401, 'OAuth authentication failed');
    }

    // Generate tokens
    const { token: refreshToken, hash: refreshTokenHash } = jwt.generateRefreshToken(user._id);
    const accessToken = jwt.generateAccessToken(user._id, user.role);

    // Store hashed refresh token
    user.refreshTokens.push({
      token: refreshTokenHash,
      createdAt: new Date(),
    });

    user.lastLogin = new Date();
    await user.save();

    logger.info('User logged in via OAuth', {
      userId: user._id,
      email: user.email,
      provider: user.oauthProvider,
    });

    // Redirect to frontend with tokens
    // In a real application, you'd use a secure token exchange or custom scheme
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/oauth-callback?accessToken=${accessToken}&refreshToken=${refreshToken}&userId=${user._id}`;

    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('OAuth callback error', { errorMessage: error.message });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/login?error=oauth_failed`);
  }
};

module.exports = {
  register,
  verifyEmail,
  login,
  refresh,
  logout,
  logoutAll,
  forgotPassword,
  resetPassword,
  getCurrentUser,
  oauthCallback,
};

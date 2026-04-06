/**
 * Email Service
 * Handles sending verification emails and password reset emails
 */

const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('./logger');

// Create reusable transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASSWORD || '',
  },
});

/**
 * Send email verification link
 * @param {string} email - Recipient email
 * @param {string} verificationToken - Email verification token
 * @param {string} frontendUrl - Frontend base URL
 */
const sendVerificationEmail = async (email, verificationToken, frontendUrl = 'http://localhost:3000') => {
  const verificationLink = `${frontendUrl}/verify-email?token=${verificationToken}`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@getshitdone.com',
    to: email,
    subject: 'Verify Your Email Address',
    html: `
      <h2>Welcome to Get Shit Done!</h2>
      <p>Thank you for registering. Please verify your email address by clicking the link below:</p>
      <a href="${verificationLink}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">
        Verify Email
      </a>
      <p>Or copy this link into your browser:</p>
      <p>${verificationLink}</p>
      <p>This link will expire in 24 hours.</p>
      <hr>
      <p>If you didn't create this account, please ignore this email.</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info('Verification email sent', { to: email, response: info.response });
    return true;
  } catch (error) {
    logger.error('Failed to send verification email', {
      to: email,
      errorMessage: error.message,
    });
    throw error;
  }
};

/**
 * Send password reset email
 * @param {string} email - Recipient email
 * @param {string} resetToken - Password reset token
 * @param {string} frontendUrl - Frontend base URL
 */
const sendPasswordResetEmail = async (email, resetToken, frontendUrl = 'http://localhost:3000') => {
  const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@getshitdone.com',
    to: email,
    subject: 'Reset Your Password',
    html: `
      <h2>Password Reset Request</h2>
      <p>You requested a password reset for your Get Shit Done account.</p>
      <p>Click the link below to reset your password:</p>
      <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 4px;">
        Reset Password
      </a>
      <p>Or copy this link into your browser:</p>
      <p>${resetLink}</p>
      <p>This link will expire in 1 hour.</p>
      <hr>
      <p>If you didn't request this, please ignore this email and your password will remain unchanged.</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info('Password reset email sent', { to: email, response: info.response });
    return true;
  } catch (error) {
    logger.error('Failed to send password reset email', {
      to: email,
      errorMessage: error.message,
    });
    throw error;
  }
};

/**
 * Send welcome email after successful registration
 * @param {string} email - Recipient email
 * @param {string} firstName - User first name
 */
const sendWelcomeEmail = async (email, firstName) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@getshitdone.com',
    to: email,
    subject: 'Welcome to Get Shit Done!',
    html: `
      <h2>Welcome ${firstName || 'there'}!</h2>
      <p>Your account has been successfully created and verified.</p>
      <p>You can now start shopping at Get Shit Done.</p>
      <p><a href="http://localhost:3000" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">
        Start Shopping
      </a></p>
      <hr>
      <p>Happy shopping!</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info('Welcome email sent', { to: email, response: info.response });
    return true;
  } catch (error) {
    logger.error('Failed to send welcome email', {
      to: email,
      errorMessage: error.message,
    });
    throw error;
  }
};

/**
 * Test email configuration
 * Called during app startup to verify email service is properly configured
 */
const testEmailConfig = async () => {
  try {
    // Verify transporter configuration
    await transporter.verify();
    logger.info('✅ Email service configured successfully');
    return true;
  } catch (error) {
    logger.error('❌ Email service configuration failed', {
      errorMessage: error.message,
      suggestion: 'Check EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD in .env',
    });
    return false;
  }
};

/**
 * Send payment success confirmation email
 * @param {string} email - Customer email
 * @param {Object} order - Order object with pricing and _id
 */
const sendPaymentSuccessEmail = async (email, order) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@getshitdone.com',
    to: email,
    subject: '✅ Payment Confirmed',
    html: `
      <h2>Payment Confirmed!</h2>
      <p>Your payment has been successfully received.</p>
      <p><strong>Order Details:</strong></p>
      <ul>
        <li>Order ID: ${order._id}</li>
        <li>Amount: $${(order.pricing.total / 100).toFixed(2)}</li>
        <li>Status: Confirmed</li>
      </ul>
      <p>Your order is now being prepared for shipment. We'll notify you when it ships.</p>
      <p><a href="${config.frontend.url}/orders/${order._id}" style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 4px;">
        View Order
      </a></p>
      <hr>
      <p>Thank you for shopping with Get Shit Done!</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info('Payment success email sent', { to: email, orderId: order._id });
    return true;
  } catch (error) {
    logger.error('Failed to send payment success email', {
      to: email,
      orderId: order._id,
      errorMessage: error.message,
    });
    throw error;
  }
};

/**
 * Send payment failure notification email
 * @param {string} email - Customer email
 * @param {Object} order - Order object with pricing and _id
 */
const sendPaymentFailureEmail = async (email, order) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@getshitdone.com',
    to: email,
    subject: '❌ Payment Failed - Please Retry',
    html: `
      <h2>Payment Failed</h2>
      <p>We were unable to process your payment. Please try again with a different payment method.</p>
      <p><strong>Order Details:</strong></p>
      <ul>
        <li>Order ID: ${order._id}</li>
        <li>Amount: $${(order.pricing.total / 100).toFixed(2)}</li>
      </ul>
      <p><a href="${config.frontend.url}/checkout/${order._id}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 4px;">
        Retry Payment
      </a></p>
      <p>If you continue to experience issues, please contact our support team.</p>
      <hr>
      <p>Get Shit Done Support</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info('Payment failure email sent', { to: email, orderId: order._id });
    return true;
  } catch (error) {
    logger.error('Failed to send payment failure email', {
      to: email,
      orderId: order._id,
      errorMessage: error.message,
    });
    throw error;
  }
};

/**
 * Send admin alert email for payment issues
 * @param {string} to - Admin email address
 * @param {Object} options - Alert details { subject, order, error }
 */
const sendAdminAlertEmail = async (to, { subject, order, error }) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@getshitdone.com',
    to,
    subject: `⚠️ [ADMIN] ${subject}`,
    html: `
      <h2>${subject}</h2>
      <p><strong>Order Information:</strong></p>
      <ul>
        <li>Order ID: ${order._id}</li>
        <li>Customer: ${order.user?.email || 'Unknown'}</li>
        <li>Amount: $${(order.pricing.total / 100).toFixed(2)}</li>
        <li>Order Status: ${order.status}</li>
      </ul>
      <p><strong>Error Details:</strong></p>
      <p><code>${error}</code></p>
      <p><a href="${config.frontend.url}/admin/orders/${order._id}" style="display: inline-block; padding: 10px 20px; background-color: #ffc107; color: black; text-decoration: none; border-radius: 4px;">
        Review in Admin Dashboard
      </a></p>
      <hr>
      <p>This is an automated alert. Please investigate and take appropriate action.</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info('Admin alert email sent', { to, orderId: order._id });
    return true;
  } catch (error) {
    logger.error('Failed to send admin alert email', {
      to,
      orderId: order._id,
      errorMessage: error.message,
    });
    throw error;
  }
};

/**
 * Send refund confirmation email
 * @param {string} email - Customer email
 * @param {Object} order - Order object with refundedAmount and refundIntentId
 */
const sendRefundEmail = async (email, order) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@getshitdone.com',
    to: email,
    subject: '✅ Refund Processed',
    html: `
      <h2>Refund Processed</h2>
      <p>Your refund has been successfully issued.</p>
      <p><strong>Refund Details:</strong></p>
      <ul>
        <li>Order ID: ${order._id}</li>
        <li>Refund Amount: $${(order.refundedAmount / 100).toFixed(2)}</li>
        <li>Refund ID: ${order.refundIntentId}</li>
      </ul>
      <p>Please allow 5-10 business days for the credit to appear in your account. The exact time depends on your bank.</p>
      <p><a href="${config.frontend.url}/orders/${order._id}" style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 4px;">
        View Order
      </a></p>
      <hr>
      <p>Thank you for your business!</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info('Refund email sent', { to: email, orderId: order._id });
    return true;
  } catch (error) {
    logger.error('Failed to send refund email', {
      to: email,
      orderId: order._id,
      errorMessage: error.message,
    });
    throw error;
  }
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  testEmailConfig,
  sendPaymentSuccessEmail,
  sendPaymentFailureEmail,
  sendAdminAlertEmail,
  sendRefundEmail,
};

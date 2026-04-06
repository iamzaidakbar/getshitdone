/**
 * Email Job Processor
 * Handles: order-confirmation, shipping-update, password-reset
 * Uses nodemailer via email utility
 */

const {
  sendPasswordResetEmail,
  sendPaymentSuccessEmail,
  sendRefundEmail,
} = require('../../utils/email');
const config = require('../../config');
const logger = require('../../utils/logger');

/**
 * Process email job
 * @param {Object} job - Bull job object
 * @returns {Object} Result data
 */
const processorHandler = async (job) => {
  try {
    const { jobType, email, templateData, userId, orderId } = job.data;

    logger.info(`Processing email job [${job.id}]: ${jobType} for ${email}`);

    let result = {
      jobType,
      email,
      sentAt: new Date().toISOString(),
    };

    // Handle different email types
    switch (jobType) {
      case 'password-reset':
        {
          const { resetToken } = templateData;
          if (!resetToken) {
            throw new Error('Missing resetToken in templateData');
          }
          await sendPasswordResetEmail(email, resetToken, config.frontend.url);
          result.type = 'password-reset';
          logger.info(`Email sent: password-reset for ${email}`);
        }
        break;

      case 'order-confirmation':
        {
          const { orderId: jobOrderId, amount } = templateData;
          if (!jobOrderId) {
            throw new Error('Missing orderId in templateData');
          }
          // Mock order object for the email function
          const mockOrder = {
            _id: jobOrderId,
            pricing: { total: amount || 0 },
          };
          await sendPaymentSuccessEmail(email, mockOrder);
          result.type = 'order-confirmation';
          result.orderId = jobOrderId;
          logger.info(`Email sent: order-confirmation for ${email}`);
        }
        break;

      case 'shipping-update':
        {
          const { orderId: jobOrderId, trackingNumber, carrier } = templateData;
          if (!jobOrderId) {
            throw new Error('Missing orderId in templateData');
          }

          // Create shipping update email (similar to order confirmation)
          const shippingHtml = `
            <h2>Your Order Has Shipped!</h2>
            <p>Great news! Your order is on its way.</p>
            <p><strong>Order Details:</strong></p>
            <ul>
              <li>Order ID: ${jobOrderId}</li>
              <li>Carrier: ${carrier || 'Standard Shipping'}</li>
              ${trackingNumber ? `<li>Tracking Number: <code>${trackingNumber}</code></li>` : ''}
            </ul>
            <p>You can track your package using the tracking number above on the carrier's website.</p>
            <p><a href="${config.frontend.url}/orders/${jobOrderId}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">
              Track Your Order
            </a></p>
            <hr>
            <p>Thank you for shopping with us!</p>
          `;

          const nodemailer = require('nodemailer');
          const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: process.env.EMAIL_PORT || 587,
            secure: process.env.EMAIL_SECURE === 'true',
            auth: {
              user: process.env.EMAIL_USER || '',
              pass: process.env.EMAIL_PASSWORD || '',
            },
          });

          await transporter.sendMail({
            from: process.env.EMAIL_FROM || 'noreply@getshitdone.com',
            to: email,
            subject: '📦 Your Order Has Shipped!',
            html: shippingHtml,
          });

          result.type = 'shipping-update';
          result.orderId = jobOrderId;
          result.trackingNumber = trackingNumber;
          logger.info(`Email sent: shipping-update for ${email}`);
        }
        break;

      default:
        throw new Error(`Unknown email job type: ${jobType}`);
    }

    return result;
  } catch (error) {
    logger.error(`Email processor error [${job.id}]: ${error.message}`);
    throw error; // Bull will handle retry
  }
};

module.exports = processorHandler;

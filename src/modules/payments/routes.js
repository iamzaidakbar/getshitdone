/**
 * Payment Routes
 * POST /api/v1/payments/webhook - Webhook endpoint (no auth)
 * POST /api/v1/payments/create-intent - Create PaymentIntent (requires auth)
 * POST /api/v1/payments/refund - Refund order (requires auth)
 */

const express = require('express');
const paymentsController = require('./controller');
const { requireAuth } = require('../../middlewares/auth');
const { asyncHandler } = require('../../utils');

const router = express.Router();

/**
 * Stripe webhook endpoint
 * Must be raw body to verify Stripe signature
 * NO authentication - Stripe signature verification provides security
 */
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  asyncHandler(paymentsController.handleWebhook)
);

/**
 * Create PaymentIntent for order
 * Requires authentication
 * Body: { orderId }
 */
router.post(
  '/create-intent',
  requireAuth,
  asyncHandler(paymentsController.createPaymentIntent)
);

/**
 * Refund order
 * Requires authentication
 * Body: { orderId, reason }
 */
router.post(
  '/refund',
  requireAuth,
  asyncHandler(paymentsController.refundOrder)
);

module.exports = router;

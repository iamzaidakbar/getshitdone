/**
 * Payment Controller
 * Handles PaymentIntent creation, webhook events, and refunds
 */

const { Order, User, WebhookEvent, PaymentLog } = require('../../config/models');
const { stripe, verifyWebhookSignature } = require('../../utils/stripe');
const { ApiError, ApiResponse, logger } = require('../../utils');

/**
 * Create PaymentIntent for an order
 * POST /api/v1/payments/create-intent
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
const createPaymentIntent = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const userId = req.user.id;

    // Fetch order and verify ownership
    const order = await Order.findById(orderId).populate('user');
    if (!order) {
      throw new ApiError(404, 'Order not found');
    }

    if (order.user._id.toString() !== userId) {
      throw new ApiError(403, 'Not authorized to create payment for this order');
    }

    // Validate order is pending
    if (order.status !== 'pending') {
      throw new ApiError(400, `Cannot create payment intent for order with status: ${order.status}`);
    }

    // Create PaymentIntent with idempotency key to prevent duplicate charges
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(order.pricing.total), // Stripe expects cents
        currency: 'usd',
        payment_method_types: ['card'],
        metadata: {
          orderId: orderId,
          userId: userId,
        },
      },
      {
        idempotencyKey: `order-${orderId}`, // Stripe prevents duplicate processing
      }
    );

    // Update order with PaymentIntent ID
    order.paymentIntentId = paymentIntent.id;
    order.paymentStatus = 'pending';
    await order.save();

    // Log payment initiation
    await PaymentLog.create({
      orderId: orderId,
      action: 'payment_initiated',
      stripeIntentId: paymentIntent.id,
      amount: order.pricing.total / 100, // Convert from cents to dollars
      metadata: {
        paymentIntentStatus: paymentIntent.status,
      },
    });

    logger.info('PaymentIntent created', {
      orderId,
      paymentIntentId: paymentIntent.id,
      amount: order.pricing.total,
    });

    res.json(
      new ApiResponse(200, {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      }, 'PaymentIntent created successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Handle Stripe webhook events
 * POST /api/v1/payments/webhook
 * No authentication - Stripe signature verification required
 * 
 * @param {Object} req - Express request (with rawBody)
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
const handleWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['stripe-signature'];
    
    if (!signature) {
      throw new ApiError(400, 'Missing stripe-signature header');
    }

    // Verify webhook signature
    const event = verifyWebhookSignature(req.rawBody, signature);

    logger.info('Webhook received', {
      eventId: event.id,
      type: event.type,
    });

    // Check for idempotency - have we already processed this event?
    let webhookEvent = await WebhookEvent.findOne({ stripeEventId: event.id });

    if (webhookEvent) {
      if (webhookEvent.status === 'processed') {
        logger.info('Webhook already processed (idempotent)', { stripeEventId: event.id });
        return res.json({ received: true });
      }
      if (webhookEvent.status === 'failed') {
        logger.warn('Retrying previously failed webhook', { stripeEventId: event.id });
      }
    }

    // Create or update WebhookEvent record
    if (!webhookEvent) {
      webhookEvent = new WebhookEvent({
        stripeEventId: event.id,
        type: event.type,
        payload: event.data,
        status: 'pending',
      });
    } else {
      webhookEvent.retryCount = (webhookEvent.retryCount || 0) + 1;
      webhookEvent.status = 'pending'; // Reset to pending for retry
    }
    
    await webhookEvent.save();

    // Queue the webhook for async processing (Bull queue will handle this)
    // For now, we'll queue it in memory and process in worker
    const { paymentQueue } = require('./worker');
    await paymentQueue.add({
      webhookEventId: webhookEvent._id.toString(),
      stripeEventType: event.type,
      data: event.data,
    });

    logger.info('Webhook queued for processing', {
      webhookEventId: webhookEvent._id,
      stripeEventType: event.type,
    });

    // Return 200 immediately - actual processing happens async
    res.json({ received: true });
  } catch (error) {
    // Only log and return 400 if it's a signature verification error
    if (error.message.includes('Invalid webhook signature')) {
      logger.error('Webhook signature verification failed', { error: error.message });
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }
    next(error);
  }
};

/**
 * Refund an order
 * POST /api/v1/payments/refund
 * Admin or customer (with eligibility checks)
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
const refundOrder = async (req, res, next) => {
  try {
    const { orderId, reason } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Fetch order
    const order = await Order.findById(orderId).populate('user');
    if (!order) {
      throw new ApiError(404, 'Order not found');
    }

    // Authorization check
    const isOwner = order.user._id.toString() === userId;
    const isAdmin = userRole === 'admin';

    if (!isOwner && !isAdmin) {
      throw new ApiError(403, 'Not authorized to refund this order');
    }

    // Refund eligibility: shipped/delivered orders require admin approval
    if ((order.status === 'shipped' || order.status === 'delivered') && !isAdmin) {
      throw new ApiError(403, 'Only admins can refund shipped/delivered orders');
    }

    // Check if already refunded
    if (order.paymentStatus === 'refunded') {
      throw new ApiError(400, 'Order has already been refunded');
    }

    // Check if there's a PaymentIntent to refund
    if (!order.paymentIntentId) {
      throw new ApiError(400, 'No payment found to refund');
    }

    // Issue refund through Stripe
    const refund = await stripe.refunds.create(
      {
        payment_intent: order.paymentIntentId,
        reason: reason || 'requested_by_customer',
      },
      {
        idempotencyKey: `refund-${orderId}`, // Prevent duplicate refunds
      }
    );

    // Update order with refund information
    order.paymentStatus = 'refunded';
    order.refundedAmount = order.pricing.total;
    order.refundIntentId = refund.id;
    
    // Add to timeline
    order.timeline.push({
      status: order.status,
      timestamp: new Date(),
      note: `Refund issued: ${refund.id}`,
    });

    await order.save();

    // Log refund
    await PaymentLog.create({
      orderId: orderId,
      action: 'refund_initiated',
      stripeIntentId: refund.id,
      amount: order.pricing.total / 100, // Convert from cents to dollars
      metadata: {
        refundReason: reason,
        initiatedBy: isAdmin ? 'admin' : 'customer',
      },
    });

    logger.info('Refund issued', {
      orderId,
      refundId: refund.id,
      amount: order.pricing.total,
    });

    res.json(
      new ApiResponse(200, refund, 'Refund issued successfully')
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createPaymentIntent,
  handleWebhook,
  refundOrder,
};

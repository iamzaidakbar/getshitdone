/**
 * Payment Webhook Queue Worker
 * Asynchronously processes Stripe webhook events using Bull queue backed by Redis
 */

const Queue = require('bull');
const config = require('../../config');
const { Order, User, WebhookEvent, PaymentLog } = require('../../config/models');
const { logger } = require('../../utils');
const {
  sendPaymentSuccessEmail,
  sendPaymentFailureEmail,
  sendAdminAlertEmail,
  sendRefundEmail,
} = require('../../utils/email');

// Create queue backed by Redis
const paymentQueue = new Queue('payments', config.redis.url);

/**
 * Main queue processor
 * Handles different webhook event types
 */
paymentQueue.process(async (job) => {
  const { webhookEventId, stripeEventType, data } = job.data;

  try {
    const webhookEvent = await WebhookEvent.findById(webhookEventId);
    if (!webhookEvent) {
      throw new Error(`WebhookEvent not found: ${webhookEventId}`);
    }

    logger.info('Processing webhook event', {
      webhookEventId,
      stripeEventType,
      eventId: webhookEvent.stripeEventId,
    });

    // Dispatch based on event type
    switch (stripeEventType) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(data, webhookEvent);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(data, webhookEvent);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(data, webhookEvent);
        break;

      default:
        logger.info('Unhandled webhook event type', {
          type: stripeEventType,
          eventId: webhookEvent.stripeEventId,
        });
    }

    // Mark webhook event as processed
    webhookEvent.status = 'processed';
    webhookEvent.processedAt = new Date();
    await webhookEvent.save();

    logger.info('Webhook event processed successfully', {
      stripeEventId: webhookEvent.stripeEventId,
      type: stripeEventType,
    });
  } catch (error) {
    logger.error('Error processing webhook event', {
      jobId: job.id,
      error: error.message,
      webhookEventId,
    });

    // Mark as failed and increment retry count
    const webhookEvent = await WebhookEvent.findById(webhookEventId);
    if (webhookEvent) {
      webhookEvent.status = 'failed';
      webhookEvent.errorMessage = error.message;
      webhookEvent.retryCount = (webhookEvent.retryCount || 0) + 1;
      await webhookEvent.save();
    }

    // Bull will automatically retry with exponential backoff
    throw error;
  }
});

/**
 * Handle payment_intent.succeeded webhook
 * Updates order status to confirmed and sends confirmation email
 */
async function handlePaymentIntentSucceeded(data, webhookEvent) {
  const paymentIntent = data.object;
  const { orderId, userId } = paymentIntent.metadata || {};

  if (!orderId) {
    logger.warn('No orderId in payment intent metadata', {
      eventId: webhookEvent.stripeEventId,
    });
    return;
  }

  const order = await Order.findById(orderId).populate('user');
  if (!order) {
    logger.warn('Order not found for payment success', {
      orderId,
      eventId: webhookEvent.stripeEventId,
    });
    return;
  }

  // Update order
  order.paymentStatus = 'succeeded';
  order.status = 'confirmed'; // Auto-confirm on successful payment
  order.webhookEventIds.push(webhookEvent.stripeEventId);

  // Add to timeline
  order.timeline.push({
    status: 'confirmed',
    timestamp: new Date(),
    note: `Payment received - ${paymentIntent.id}`,
  });

  await order.save();

  // Log payment
  await PaymentLog.create({
    orderId: order._id,
    action: 'payment_succeeded',
    stripeIntentId: paymentIntent.id,
    amount: order.pricing.total / 100, // Convert from cents to dollars
    metadata: {
      paymentIntentStatus: paymentIntent.status,
    },
  });

  // Send success email to customer
  try {
    await sendPaymentSuccessEmail(order.user.email, order);
    logger.info('Payment success email sent', {
      orderId,
      email: order.user.email,
    });
  } catch (error) {
    logger.error('Failed to send payment success email', {
      orderId,
      email: order.user.email,
      error: error.message,
    });
  }
}

/**
 * Handle payment_intent.payment_failed webhook
 * Alerts customer and admin, keeps order pending
 */
async function handlePaymentIntentFailed(data, webhookEvent) {
  const paymentIntent = data.object;
  const { orderId, userId } = paymentIntent.metadata || {};

  if (!orderId) {
    logger.warn('No orderId in payment intent metadata', {
      eventId: webhookEvent.stripeEventId,
    });
    return;
  }

  const order = await Order.findById(orderId).populate('user');
  if (!order) {
    logger.warn('Order not found for payment failure', {
      orderId,
      eventId: webhookEvent.stripeEventId,
    });
    return;
  }

  // Update order status to failed but keep it pending (for retry)
  order.paymentStatus = 'failed';
  order.webhookEventIds.push(webhookEvent.stripeEventId);

  // Add to timeline
  const errorMessage = paymentIntent.last_payment_error?.message || 'Unknown error';
  order.timeline.push({
    status: 'pending',
    timestamp: new Date(),
    note: `Payment failed: ${errorMessage}`,
  });

  await order.save();

  // Log payment failure
  await PaymentLog.create({
    orderId: order._id,
    action: 'payment_failed',
    stripeIntentId: paymentIntent.id,
    amount: order.pricing.total / 100, // Convert from cents to dollars
    metadata: {
      error: errorMessage,
      paymentIntentStatus: paymentIntent.status,
    },
  });

  // Send failure email to customer
  try {
    await sendPaymentFailureEmail(order.user.email, order);
    logger.info('Payment failure email sent to customer', {
      orderId,
      email: order.user.email,
    });
  } catch (error) {
    logger.error('Failed to send payment failure email to customer', {
      orderId,
      email: order.user.email,
      error: error.message,
    });
  }

  // Alert admin
  try {
    await sendAdminAlertEmail(config.admin.email, {
      subject: '⚠️ Payment Failed',
      order,
      error: errorMessage,
    });
    logger.info('Payment failure alert sent to admin', {
      orderId,
      adminEmail: config.admin.email,
    });
  } catch (error) {
    logger.error('Failed to send admin alert for payment failure', {
      orderId,
      adminEmail: config.admin.email,
      error: error.message,
    });
  }
}

/**
 * Handle charge.refunded webhook
 * Updates order to refunded and sends refund confirmation email
 */
async function handleChargeRefunded(data, webhookEvent) {
  const charge = data.object;
  const paymentIntentId = charge.payment_intent;

  if (!paymentIntentId) {
    logger.warn('No payment_intent in charge object', {
      eventId: webhookEvent.stripeEventId,
    });
    return;
  }

  // Find order by paymentIntentId
  const order = await Order.findOne({ paymentIntentId }).populate('user');
  if (!order) {
    logger.warn('Order not found for refund', {
      paymentIntentId,
      eventId: webhookEvent.stripeEventId,
    });
    return;
  }

  // Update order
  order.paymentStatus = 'refunded';
  order.refundedAmount = charge.amount_refunded / 100; // Convert from cents to dollars
  order.webhookEventIds.push(webhookEvent.stripeEventId);

  await order.save();

  // Log refund
  await PaymentLog.create({
    orderId: order._id,
    action: 'refund_succeeded',
    stripeIntentId: charge.id,
    amount: charge.amount_refunded / 100, // Convert from cents to dollars
    metadata: {
      reason: charge.refunded ? 'refunded' : 'partial',
    },
  });

  // Send refund confirmation email to customer
  try {
    await sendRefundEmail(order.user.email, order);
    logger.info('Refund confirmation email sent', {
      orderId: order._id,
      email: order.user.email,
    });
  } catch (error) {
    logger.error('Failed to send refund email', {
      orderId: order._id,
      email: order.user.email,
      error: error.message,
    });
  }
}

/**
 * Queue event listeners
 */

// Log active jobs
paymentQueue.on('active', (job) => {
  logger.info('Payment webhook job started', { jobId: job.id });
});

// Log completed jobs
paymentQueue.on('completed', (job) => {
  logger.info('Payment webhook job completed', { jobId: job.id });
});

// Log failed jobs
paymentQueue.on('failed', (job, err) => {
  logger.error('Payment webhook job failed', {
    jobId: job.id,
    error: err.message,
    attempt: job.attemptsMade,
  });
});

// Log stalled jobs (timeout)
paymentQueue.on('stalled', (jobId) => {
  logger.warn('Payment webhook job stalled', { jobId });
});

module.exports = {
  paymentQueue,
};

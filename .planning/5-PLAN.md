# Phase 5 Plan: Reliable, Idempotent Payment Processing
## Executable Task Breakdown

**Created**: April 6, 2026  
**Phase**: 5 - Payments  
**Goal**: Stripe PaymentIntent server-side flow with webhook idempotency  
**Approach**: Build core payment → webhook handling → async processing → testing  

---

## Wave 1: Foundation & Configuration

### Task 1.1 — Install Dependencies
**Time**: 5 min  
**Dependencies**: None (start first)

Install payment processing packages:
```bash
npm install stripe bull redis
```

**Verify**:
- Stripe SDK loaded: `require('stripe')`
- Bull queue: `require('bull')`
- Redis client: Ready (Bull uses it)

**File modifications**: `package.json` only

---

### Task 1.2 — Add Stripe Config to Environment
**Time**: 5 min  
**Dependencies**: Task 1.1

Create `.env` variables (add to `.env.dev` and `.env.prod`):
```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_xxx  # Get from Stripe Dashboard
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx  # From Stripe Dashboard > Webhooks

# Redis (for Bull queue)
REDIS_URL=redis://localhost:6379  # Local; use AWS ElastiCache in prod
```

**Read values from**: Stripe Dashboard (test keys)

**File modifications**: `.env.dev`, `.env.prod`, `src/config/index.js` (add exports)

---

### Task 1.3 — Create Stripe Utility (`src/utils/stripe.js`)
**Time**: 10 min  
**Dependencies**: Task 1.2

Create centralized Stripe client + helpers:

```javascript
// src/utils/stripe.js
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-04-10'
});

const verifyWebhookSignature = (rawBody, signature) => {
  try {
    return stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    throw new ApiError(400, 'Invalid webhook signature');
  }
};

module.exports = {
  stripe,
  verifyWebhookSignature
};
```

**Exports**: 
- `stripe` instance (use for PaymentIntent, Refund operations)
- `verifyWebhookSignature(rawBody, signature)` 

**File creates**: `src/utils/stripe.js`

---

## Wave 2: Database Schema & Models

### Task 2.1 — Create WebhookEvent Model (`src/modules/payments/model.js`)
**Time**: 15 min  
**Dependencies**: Task 1.3

Create schema for idempotent webhook handling:

```javascript
// src/modules/payments/webhookEventSchema
const webhookEventSchema = new Schema({
  stripeEventId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  type: String,  // payment_intent.succeeded, payment_intent.payment_failed, charge.refunded
  payload: Schema.Types.Mixed,  // Store raw webhook body
  status: {
    type: String,
    enum: ['pending', 'processed', 'failed'],
    default: 'pending',
    index: true
  },
  processedAt: Date,
  errorMessage: String,
  retryCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Unique constraint on stripeEventId
webhookEventSchema.index({ stripeEventId: 1 }, { unique: true });
```

Methods:
- `findByStripeEventId(id)` — Check if already processed
- `.markProcessed()` — Set status='processed', processedAt=now
- `.markFailed(error)` — Set status='failed', errorMessage

**Also create**: PaymentLog schema for audit trail
```javascript
const paymentLogSchema = new Schema({
  orderId: ObjectId,
  action: String,  // payment_initiated, payment_succeeded, etc.
  stripeIntentId: String,
  amount: Number,
  currency: { type: String, default: 'USD' },
  metadata: Schema.Types.Mixed,
  timestamp: { type: Date, default: Date.now }
});
```

**File creates**: `src/modules/payments/model.js`

---

### Task 2.2 — Update Order Model with Payment Fields
**Time**: 10 min  
**Dependencies**: Task 2.1

Extend existing Order schema in `src/modules/orders/model.js`:

```javascript
// Add to Order schema
paymentIntentId: String,  // Stripe PaymentIntent ID
paymentStatus: {
  type: String,
  enum: ['pending', 'succeeded', 'failed', 'refunded'],
  default: 'pending'
},
refundedAmount: { type: Number, default: 0 },
refundIntentId: String,
webhookEventIds: [String]  // Track related webhook events
```

**File modifies**: `src/modules/orders/model.js`

---

## Wave 3: Payment Intent & Webhook Endpoints

### Task 3.1 — Create Payment Controller (`src/modules/payments/controller.js`)
**Time**: 30 min  
**Dependencies**: Task 2.2, Task 1.3

Create core payment functions:

```javascript
/**
 * createPaymentIntent(req, res)
 * POST /api/v1/payments/create-intent
 *
 * Body: { orderId }
 * Returns: { clientSecret, paymentIntentId }
 */
const createPaymentIntent = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    
    // Fetch order (user must own it)
    const order = await Order.findById(orderId);
    if (!order || order.user.toString() !== req.user.id) {
      throw new ApiError(403, 'Order not found or access denied');
    }
    
    // Validate order is pending
    if (order.status !== 'pending') {
      throw new ApiError(400, 'Order is not pending payment');
    }
    
    // Create PaymentIntent with idempotency key
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(order.pricing.total * 100),  // Stripe expects cents
        currency: 'usd',
        payment_method_types: ['card'],
        metadata: {
          orderId: orderId,
          userId: req.user.id
        }
      },
      {
        idempotencyKey: `order-${orderId}`  // Prevent duplicate charges
      }
    );
    
    // Store paymentIntentId on Order
    order.paymentIntentId = paymentIntent.id;
    await order.save();
    
    // Log payment initiation
    await PaymentLog.create({
      orderId,
      action: 'payment_initiated',
      stripeIntentId: paymentIntent.id,
      amount: order.pricing.total
    });
    
    res.json(new ApiResponse(200, {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * handleWebhook(req, res)
 * POST /api/v1/payments/webhook
 * Raw body required for signature verification
 */
const handleWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['stripe-signature'];
    const event = verifyWebhookSignature(req.rawBody, signature);
    
    // Check idempotency
    const existing = await WebhookEvent.findOne({ stripeEventId: event.id });
    if (existing) {
      if (existing.status === 'processed') {
        logger.info('Webhook already processed', { stripeEventId: event.id });
        return res.json({ received: true });  // Idempotent
      }
      if (existing.status === 'failed') {
        logger.warn('Retrying failed webhook', { stripeEventId: event.id });
      }
    }
    
    // Create/update WebhookEvent
    let webhookEvent = existing || new WebhookEvent({
      stripeEventId: event.id,
      type: event.type,
      payload: event.data
    });
    webhookEvent.retryCount = (webhookEvent.retryCount || 0) + 1;
    await webhookEvent.save();
    
    // Queue for processing
    await paymentQueue.add({
      webhookEventId: webhookEvent._id,
      stripeEventType: event.type,
      data: event.data
    });
    
    // Return immediately (Bull will process async)
    res.json({ received: true });
  } catch (error) {
    logger.error('Webhook verification failed', { error: error.message });
    res.status(400).json({ error: 'webhook_error' });
  }
};

/**
 * refundOrder(req, res)
 * POST /api/v1/payments/refund
 * Admin or customer (if eligible)
 */
const refundOrder = async (req, res, next) => {
  try {
    const { orderId, reason } = req.body;
    const order = await Order.findById(orderId);
    
    if (!order) throw new ApiError(404, 'Order not found');
    
    // Check refund eligibility
    if (order.status === 'shipped' || order.status === 'delivered') {
      if (req.user.role !== 'admin') {
        throw new ApiError(403, 'Only admins can refund shipped orders');
      }
    }
    
    if (order.paymentStatus === 'refunded') {
      throw new ApiError(400, 'Order already refunded');
    }
    
    // Issue refund through Stripe
    const refund = await stripe.refunds.create(
      {
        payment_intent: order.paymentIntentId,
        reason: reason || 'requested_by_customer'
      },
      {
        idempotencyKey: `refund-${orderId}`
      }
    );
    
    // Update order
    order.paymentStatus = 'refunded';
    order.refundedAmount = order.pricing.total;
    order.refundIntentId = refund.id;
    order.timeline.push({
      status: order.status,
      timestamp: new Date(),
      message: `Refund issued: ${refund.id}`
    });
    await order.save();
    
    // Log refund
    await PaymentLog.create({
      orderId,
      action: 'refund_succeeded',
      stripeIntentId: refund.id,
      amount: order.pricing.total
    });
    
    res.json(new ApiResponse(200, refund));
  } catch (error) {
    next(error);
  }
};
```

**Also create webhook processing helper** (later moved to worker.js):
```javascript
// handlePaymentIntentSucceeded, handlePaymentIntentFailed, handleChargeRefunded
// See Worker section below
```

**File creates**: `src/modules/payments/controller.js`

---

### Task 3.2 — Create Payment Routes (`src/modules/payments/routes.js`)
**Time**: 10 min  
**Dependencies**: Task 3.1

```javascript
const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../../utils');
const { requireAuth, requireRole } = require('../../middlewares/auth');
const paymentsController = require('./controller');

// Webhook endpoint — NO AUTH (Stripe signs the request)
router.post('/webhook', express.raw({ type: 'application/json' }), asyncHandler(paymentsController.handleWebhook));

// User creates payment intent
router.post('/create-intent', requireAuth, asyncHandler(paymentsController.createPaymentIntent));

// Admin/customer refund
router.post('/refund', requireAuth, asyncHandler(paymentsController.refundOrder));

module.exports = router;
```

Mount in `src/routes/index.js`:
```javascript
router.use('/v1/payments', paymentsRoutes);
```

**File creates**: `src/modules/payments/routes.js`  
**File modifies**: `src/routes/index.js`

---

## Wave 4: Async Webhook Processing with Bull

### Task 4.1 — Create Bull Queue Worker (`src/modules/payments/worker.js`)
**Time**: 30 min  
**Dependencies**: Task 3.1, Task 2.1

Create async message queue for reliable webhook processing:

```javascript
// src/modules/payments/worker.js
const Queue = require('bull');
const { Order, WebhookEvent, PaymentLog } = require('../../config/models');
const { stripe } = require('../../utils/stripe');
const { logger } = require('../../utils');

// Create queue backed by Redis
const paymentQueue = new Queue('payments', process.env.REDIS_URL);

// Process webhook events asynchronously
paymentQueue.process(async (job) => {
  const { webhookEventId, stripeEventType, data } = job.data;
  
  try {
    const webhookEvent = await WebhookEvent.findById(webhookEventId);
    
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
        logger.info('Unhandled webhook type', { type: stripeEventType });
    }
    
    // Mark processed
    webhookEvent.status = 'processed';
    webhookEvent.processedAt = new Date();
    await webhookEvent.save();
    
  } catch (error) {
    logger.error('Webhook processing failed', { error: error.message, webhookEventId });
    throw error;  // Bull will retry
  }
});

/**
 * Handle successful payment
 */
async function handlePaymentIntentSucceeded(data, webhookEvent) {
  const paymentIntent = data.object;
  const { orderId } = paymentIntent.metadata;
  
  const order = await Order.findById(orderId);
  if (!order) {
    logger.warn('Order not found for payment', { orderId });
    return;
  }
  
  // Update order
  order.paymentStatus = 'succeeded';
  order.status = 'confirmed';  // Auto-confirm on payment
  order.webhookEventIds.push(webhookEvent.stripeEventId);
  order.timeline.push({
    status: 'confirmed',
    timestamp: new Date(),
    message: `Payment received (${paymentIntent.id})`
  });
  await order.save();
  
  // Log
  await PaymentLog.create({
    orderId,
    action: 'payment_succeeded',
    stripeIntentId: paymentIntent.id,
    amount: order.pricing.total
  });
  
  // Send emails
  const user = await User.findById(order.user);
  await sendPaymentSuccessEmail(user.email, order);
  // Skip logging "admin alert" for success
}

/**
 * Handle failed payment
 */
async function handlePaymentIntentFailed(data, webhookEvent) {
  const paymentIntent = data.object;
  const { orderId } = paymentIntent.metadata;
  
  const order = await Order.findById(orderId);
  if (!order) {
    logger.warn('Order not found for payment failure', { orderId });
    return;
  }
  
  // Update order
  order.paymentStatus = 'failed';
  order.webhookEventIds.push(webhookEvent.stripeEventId);
  order.timeline.push({
    status: 'pending',
    timestamp: new Date(),
    message: `Payment failed: ${paymentIntent.last_payment_error?.message || 'Unknown'}`
  });
  await order.save();
  
  // Log
  await PaymentLog.create({
    orderId,
    action: 'payment_failed',
    stripeIntentId: paymentIntent.id,
    amount: order.pricing.total,
    metadata: { error: paymentIntent.last_payment_error?.message }
  });
  
  // Send emails to BOTH customer and admin
  const user = await User.findById(order.user);
  await sendPaymentFailureEmail(user.email, order);
  
  // Alert admin
  await sendAdminAlertEmail('admin@example.com', {
    subject: 'Payment Failed',
    order,
    error: paymentIntent.last_payment_error?.message
  });
}

/**
 * Handle refund
 */
async function handleChargeRefunded(data, webhookEvent) {
  const charge = data.object;
  // Charge.refunded contains refund details
  
  // Find order by paymentIntentId (from charge.payment_intent)
  const order = await Order.findOne({
    paymentIntentId: charge.payment_intent
  });
  
  if (!order) {
    logger.warn('Order not found for refund', { paymentIntentId: charge.payment_intent });
    return;
  }
  
  order.paymentStatus = 'refunded';
  order.refundedAmount = charge.amount_refunded / 100;
  order.webhookEventIds.push(webhookEvent.stripeEventId);
  await order.save();
  
  // Log refund
  await PaymentLog.create({
    orderId: order._id,
    action: 'refund_succeeded',
    stripeIntentId: charge.id,
    amount: charge.amount_refunded / 100
  });
  
  // Email customer
  const user = await User.findById(order.user);
  await sendRefundEmail(user.email, order);
}

// Error handler
paymentQueue.on('failed', (job, err) => {
  logger.error('Job failed', { jobId: job.id, error: err.message });
});

module.exports = {
  paymentQueue
};
```

**Key behaviors:**
1. **Idempotent**: WebhookEvent lookup ensures we don't process same event twice
2. **Async**: Bull processes while webhook endpoint returns 200 immediately
3. **Retry**: Red Bull has built-in retry logic (default 3 attempts with exponential backoff)
4. **Persistent**: If worker crashes, job stays in queue and retries on restart

**File creates**: `src/modules/payments/worker.js`

---

### Task 4.2 — Initialize Bull Queue in Server Startup
**Time**: 5 min  
**Dependencies**: Task 4.1

In `src/app.js`, initialize payment queue on server start:

```javascript
// In app.js startup
const { paymentQueue } = require('./modules/payments/worker');

// Start queue processor
paymentQueue.process();

// Log queue health
paymentQueue.on('active', (job) => {
  logger.info('Processing payment webhook', { jobId: job.id });
});

app.on('close', async () => {
  await paymentQueue.close();
});
```

**File modifies**: `src/app.js`

---

## Wave 5: Notifications & Helper Utilities

### Task 5.1 — Extend Email Service with Payment Emails
**Time**: 15 min  
**Dependencies**: Task 3.1 (Order structure known)

In `src/utils/email.js`, add payment notification functions:

```javascript
/**
 * sendPaymentSuccessEmail
 */
const sendPaymentSuccessEmail = async (to, order) => {
  const html = `
    <h2>Payment Confirmed ✅</h2>
    <p>Your payment of $${order.pricing.total} has been received.</p>
    <p>Order ID: ${order._id}</p>
    <p><a href="https://yourdomain.com/orders/${order._id}">View Order</a></p>
  `;
  
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Payment Confirmed',
    html
  });
};

/**
 * sendPaymentFailureEmail
 */
const sendPaymentFailureEmail = async (to, order) => {
  const html = `
    <h2>Payment Failed ❌</h2>
    <p>We couldn't process your payment for order ${order._id}.</p>
    <p>Amount: $${order.pricing.total}</p>
    <p><a href="https://yourdomain.com/checkout/${order._id}">Retry Payment</a></p>
  `;
  
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Payment Failed - Please Retry',
    html
  });
};

/**
 * sendAdminAlertEmail
 */
const sendAdminAlertEmail = async (to, { subject, order, error }) => {
  const html = `
    <h2>${subject}</h2>
    <p>Order: ${order._id}</p>
    <p>User: ${order.user}</p>
    <p>Amount: $${order.pricing.total}</p>
    <p>Error: ${error}</p>
    <p><a href="https://dashboard.yourdomain.com/orders/${order._id}">Review in Dashboard</a></p>
  `;
  
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html
  });
};

/**
 * sendRefundEmail
 */
const sendRefundEmail = async (to, order) => {
  const html = `
    <h2>Refund Processed ✅</h2>
    <p>Your refund of $${order.refundedAmount} has been issued.</p>
    <p>Order ID: ${order._id}</p>
    <p>Refund ID: ${order.refundIntentId}</p>
    <p>Look for the credit in your account within 5-10 business days.</p>
  `;
  
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Refund Processed',
    html
  });
};

module.exports = {
  // ... existing exports
  sendPaymentSuccessEmail,
  sendPaymentFailureEmail,
  sendAdminAlertEmail,
  sendRefundEmail
};
```

**File modifies**: `src/utils/email.js`

---

### Task 5.2 — Add Validation Schemas
**Time**: 10 min  
**Dependencies**: Task 3.1

In `src/config/validationSchemas.js`:

```javascript
const createPaymentIntentSchema = Joi.object({
  orderId: Joi.string()
    .required()
    .pattern(/^[0-9a-f]{24}$/)
    .messages({
      'any.required': 'Order ID is required'
    })
});

const refundOrderSchema = Joi.object({
  orderId: Joi.string()
    .required()
    .pattern(/^[0-9a-f]{24}$/),
  reason: Joi.string()
    .valid('requested_by_customer', 'duplicate', 'fraudulent')
    .default('requested_by_customer')
});

module.exports = {
  // ... existing exports
  createPaymentIntentSchema,
  refundOrderSchema
};
```

Apply validation to routes (in Task 3.2):
```javascript
router.post('/create-intent', 
  requireAuth, 
  validateRequest(createPaymentIntentSchema),
  asyncHandler(paymentsController.createPaymentIntent)
);
```

**File modifies**: `src/config/validationSchemas.js`, `src/modules/payments/routes.js`

---

## Wave 6: Testing & Verification

### Task 6.1 — Stripe Mock Setup
**Time**: 10 min  
**Dependencies**: Task 3.1

Create Jest mock for Stripe:

```javascript
// __mocks__/stripe.js
module.exports = {
  default: jest.fn(() => ({
    paymentIntents: {
      create: jest.fn().mockResolvedValue({
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret',
        status: 'requires_payment_method',
        amount: 9999,
        currency: 'usd',
        metadata: {}
      })
    },
    refunds: {
      create: jest.fn().mockResolvedValue({
        id: 're_test_123',
        payment_intent: 'pi_test_123',
        amount: 9999,
        status: 'succeeded'
      })
    },
    webhooks: {
      constructEvent: jest.fn((body, sig, secret) => {
        return {
          id: 'evt_test_123',
          type: 'payment_intent.succeeded',
          data: { object: {} }
        };
      })
    }
  }))
};
```

Use in tests:
```javascript
jest.mock('stripe');
const { stripe } = require('../../../utils/stripe');

describe('Payment Intent', () => {
  it('should create payment intent with idempotency key', async () => {
    // Mock request...
    // Verify stripe.paymentIntents.create called with idempotencyKey
  });
});
```

**File creates**: `src/__mocks__/stripe.js`, `src/modules/payments/__tests__/*.test.js`

---

### Task 6.2 — Webhook & Idempotency Tests
**Time**: 20 min  
**Dependencies**: Task 6.1, Task 4.1

Test webhook idempotency:

```javascript
describe('Webhook Idempotency', () => {
  it('should return 200 for duplicate webhook (already processed)', async () => {
    const webhookEvent = await WebhookEvent.create({
      stripeEventId: 'evt_duplicate',
      type: 'payment_intent.succeeded',
      status: 'processed'
    });
    
    // Send webhook with same Stripe event ID
    const response = await request(app)
      .post('/api/v1/payments/webhook')
      .send(payloadWithId('evt_duplicate'))
      .set('stripe-signature', validSignature);
    
    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);
    // Verify no duplicate job queued
  });
});
```

**File creates**: `src/modules/payments/__tests__/webhook.test.js`

---

## Wave 7: Documentation & Checklist

### Task 7.1 — Create PHASE5_PAYMENTS.md
**Time**: 30 min  
**Dependencies**: All tasks completed

Comprehensive documentation mirroring Phase 4 structure:
- Architecture overview
- PaymentIntent flow diagram
- Webhook idempotency pattern
- Refund logic (hybrid model)
- Deployment checklist
- Example curl commands

**File creates**: `PHASE5_PAYMENTS.md`

---

### Task 7.2 — Create PHASE5_CHECKLIST.md
**Time**: 10 min  
**Dependencies**: Task 7.1

Verification checklist:
```markdown
✅ Stripe Integration
- [ ] PaymentIntent created server-side
- [ ] Client receives clientSecret
- [ ] PaymentIntent ID stored on Order

✅ Webhook Handling
- [ ] Webhook endpoint receives Stripeevents
- [ ] Signature verified (stripe.webhooks.constructEvent)
- [ ] WebhookEvent created with status='pending'
- [ ] Idempotency check prevents double-processing
- [ ] Bull job queued

✅ Async Processing
- [ ] Bull worker processes payment_intent.succeeded
- [ ] Order.paymentStatus updated
- [ ] Order.status auto-confirmed
- [ ] Customer email sent
- [ ] WebhookEvent marked 'processed'

✅ Failure Handling
- [ ] payment_intent.payment_failed logged
- [ ] Customer + admin emails sent
- [ ] Order remains 'pending' for retry

✅ Refunds
- [ ] Auto-refund for pending/confirmed
- [ ] Manual refund endpoint for shipped+
- [ ] Refund logged with idempotency key
- [ ] Customer refund email sent

✅ Testing
- [ ] Stripe mocked in tests
- [ ] No live API calls in test suite
- [ ] Webhook signature verification tested
- [ ] Idempotency (duplicate webhook) tested
- [ ] Payment success/failure flows tested
```

**File creates**: `PHASE5_CHECKLIST.md`

---

## Summary: Task Wave Breakdown

| Wave | Tasks | Time | Dependencies |
|------|-------|------|--------------|
| **1** | Config + Stripe utility | 20 min | None |
| **2** | Database models | 25 min | Wave 1 |
| **3** | Payment endpoints | 40 min | Wave 2 |
| **4** | Bull worker queue | 35 min | Wave 3 |
| **5** | Email notifications | 25 min | Wave 3 |
| **6** | Testing | 30 min | Wave 5 |
| **7** | Documentation | 40 min | All waves |
| | **TOTAL** | **~4 hours** | Sequential waves |

---

## Success Criteria

✅ **Phase 5 Complete When:**

1. ✅ PaymentIntent creation returns clientSecret (no card data touches server)
2. ✅ Stripe webhook endpoint receives and verifies signatures
3. ✅ WebhookEvent collection prevents double-processing (idempotent)
4. ✅ Bull worker processes events asynchronously without blocking 200 response
5. ✅ Order.paymentStatus updates: pending → succeeded/failed → refunded
6. ✅ Payment success emails sent to customer
7. ✅ Payment failure emails sent to customer + admin alert
8. ✅ Auto-refund works for pending/confirmed orders
9. ✅ Manual refund endpoint works for admins
10. ✅ All tests pass with mocked Stripe (zero live API calls)
11. ✅ Webhook signature verified (prevents spoofing)
12. ✅ Idempotency keys prevent duplicate charges
13. ✅ Full audit trail in PaymentLog + Order.timeline
14. ✅ No PCI-sensitive data in logs/database

---

**Phase 5 Ready**: All tasks executable  
**Next**: Execute waves 1-7 in order


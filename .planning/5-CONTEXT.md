# Phase 5 Context: Payments
## Decisions & Implementation Scope

**Date**: April 6, 2026  
**Phase**: Phase 5 - Reliable, Idempotent Payment Processing  
**Status**: REQUIREMENTS FINALIZED

---

## User Decisions (Locked)

### 1. Refund Strategy: Hybrid Model
- **Pending/Confirmed orders**: Instant auto-refund to Stripe when customer/admin cancels
- **Shipped+ orders**: Manual refund required (admin initiates via Stripe Dashboard)
- **Rationale**: Reduces disputes for items not yet shipped; prevents accidental refunds for shipped goods

### 2. Payment Failure Handling
- [x] Alert admin immediately on payment failure (via email)
- [x] Notify customer on payment failure (via email with retry CTA)
- Retry strategy: Rely on Stripe webhook retries (exponential backoff by Stripe infrastructure)

### 3. Payment Methods: Multi-Channel
- [x] **Cards** (Credit/Debit via Stripe PaymentIntent) — Primary
- [x] **PayPal** (Stripe Connect or Braintree) — Secondary (decide integration method)
- [x] **Bank Transfers** (ACH/SEPA) — Tertiary for B2B (low priority, Phase 5.x)

### 4. Partial Payments
- [x] **NO** — Full payment only. No installments, no split charges.
- Single atomic charge per order

### 5. Chargeback/Dispute Handling
- [x] **Track webhook but don't auto-action**
- Stripe sends `charge.dispute.created` webhook → store in WebhookEvent
- Admin manually reviews in Stripe Dashboard
- Flag order with "dispute" status for manual investigation (Phase 5.x)

### 6. Testing Approach
- [x] **Mock Stripe API in tests** (Jest mocks, no live API calls)
- Stripe.js helpers mocked in test suites
- Integration tests optional (Phase 6)

---

## Phase 4 Reusable Assets

### Order Model (Already Prepared)
✅ From Phase 4:
```javascript
// Order schema already includes:
- pricing: { subtotal, discount, tax, shipping, total }
- paymentMethod: 'card' | 'paypal' | 'bank_transfer'
- status: [pending, confirmed, processing, shipped, delivered, cancelled]
- timeline: [{ status, timestamp, message }]
- items, shippingAddress, billingAddress
```

✅ Phase 5 must ADD:
- `paymentIntentId`: String (Stripe PaymentIntent ID)
- `paymentStatus`: 'pending' | 'succeeded' | 'failed' | 'refunded'
- `refundedAmount`: Number
- `refundIntentId`: String (Stripe RefundIntent ID if applicable)

### Authorization (Already in Place)
✅ From Phase 3:
- `requireAuth` middleware
- `requireRole('admin')` guards
- JWT tokens with refresh rotation

### Email Service (Already in Place)
✅ From Phase 3:
- `sendVerificationEmail`, `sendPasswordResetEmail` functions
- Nodemailer configured
- Must extend to: `sendPaymentFailureEmail`, `sendPaymentSuccessEmail`, `sendRefundEmail`

---

## New Dependencies Required

```json
{
  "stripe": "^14.0.0",           // Stripe Node SDK
  "bull": "^4.0.0",              // Task queue (Redis-backed)
  "redis": "^4.0.0",             // Redis for Bull
  "dotenv": "^16.0.0"            // Already installed
}
```

### Optional (Phase 5.x)
```json
{
  "braintree": "^3.0.0",         // PayPal alternative
  "dwolla": "^2.0.0"            // ACH/Bank transfers
}
```

---

## Database Schema Changes

### New Collections

#### 1. **WebhookEvent** — Idempotent Webhook Handling
```javascript
{
  _id: ObjectId,
  stripeEventId: String,          // Unique Stripe event ID
  type: String,                   // 'payment_intent.succeeded', etc.
  payload: Object,                // Raw webhook body
  status: 'pending' | 'processed' | 'failed',
  processedAt?: Date,
  errorMessage?: String,
  retryCount: Number,
  createdAt: Date,
  updatedAt: Date,
  index: { stripeEventId: 1 } // Unique constraint
}
```

#### 2. **PaymentLog** — Audit Trail
```javascript
{
  _id: ObjectId,
  orderId: ObjectId,
  action: 'payment_initiated' | 'payment_succeeded' | 'payment_failed' | 'refund_initiated' | 'refund_succeeded',
  stripeIntentId: String,
  amount: Number,
  currency: 'USD',
  metadata: Object,
  timestamp: Date
}
```

### Modified: Order
```javascript
Order.schema.add({
  paymentIntentId: String,        // Stripe PaymentIntent ID
  paymentStatus: String,          // pending, succeeded, failed, refunded
  refundedAmount: { type: Number, default: 0 },
  refundIntentId: String,
  webhookEventIds: [String]       // Track which webhook events processed this order
});
```

---

## Technical Architecture

### Webhook Flow (Idempotent Pattern)
```
1. Stripe sends webhook → /api/v1/webhooks/stripe
2. Verify signature (stripe.webhooks.constructEvent)
3. Check WebhookEvent.findOne({ stripeEventId })
   - If exists AND processed → return 200 (idempotent)
   - If exists AND failed → retry OR dead-letter
   - If NOT exists → create with status: 'pending'
4. Enqueue to Bull queue (PaymentWorker)
5. Return 200 immediately
6. async: Worker processes job
   - Handle payment_intent.succeeded → Update Order, send confirmEmail
   - Handle payment_intent.payment_failed → Update Order, send failureEmails
   - Handle charge.refunded → Update Order, log refund
7. On success: Mark WebhookEvent as 'processed'
8. On failure: Increment retryCount, Stripe will retry
```

### Payment Intent Flow
```
1. Frontend navigates to checkout
2. POST /api/v1/orders (triggers order creation, status: pending)
3. Frontend calls POST /api/v1/payments/create-intent
   - Server: Create PaymentIntent with amount=order.total, idempotencyKey=orderId
   - Return { clientSecret, paymentIntentId }
4. Frontend confirms PaymentIntent with Stripe.js
5. Stripe calls webhook (payment_intent.succeeded or payment_intent.payment_failed)
6. Webhook handler updates Order, sends emails
7. Frontend polls /api/v1/orders/:orderId to check payment status
```

### Idempotency Key Strategy
- **Key**: `order-{orderId}`
- **Rationale**: If client retransmits payment request, Stripe returns same PaymentIntent
- Applied to: `createPaymentIntent`, `createRefund` calls

---

## Phase 5 Deliverables

### Controllers & Routes
- [ ] `src/modules/payments/controller.js` — PaymentIntent, refund, webhook handlers
- [ ] `src/modules/payments/routes.js` — POST /payments, POST /webhooks, refund endpoints
- [ ] `src/modules/payments/worker.js` — Bull worker for async webhook processing

### Models & Schemas
- [ ] `src/modules/payments/model.js` — WebhookEvent, PaymentLog schema
- [ ] Update `src/modules/orders/model.js` — Add payment fields

### Utilities
- [ ] `src/utils/stripe.js` — Stripe client initialization, signature verification
- [ ] `src/utils/emailNotifications.js` — Payment failure/success/refund emails

### Config & Validation
- [ ] Update `.env` — Stripe keys, webhook secret, Redis config
- [ ] `src/config/validationSchemas.js` — Payment schemas (create intent, refund)

### Testing
- [ ] `src/modules/payments/__tests__/payment.test.js` — Mocked Stripe tests
- [ ] `src/modules/payments/__tests__/webhook.test.js` — Webhook signature + idempotency tests

### Documentation
- [ ] `PHASE5_PAYMENTS.md` — Complete payment flow guide
- [ ] `PHASE5_CHECKLIST.md` — Verification checklist

---

## Known Constraints

1. **Redis Required**: Bull queue needs Redis running
   - Local: Docker or Homebrew
   - Production: AWS ElastiCache or Heroku Redis

2. **Stripe Account**: Test and Live API keys required
   - Register at stripe.com
   - Get test keys from Dashboard

3. **Webhook Secret**: Obtained from Stripe Dashboard
   - Required for `stripe.webhooks.constructEvent` signature verification

4. **Payment Method Expansion** (Phase 5.x):
   - PayPal integration requires separate account + API keys
   - Bank transfers need ACH processor (Dwolla, Plaid, or Stripe ACH)

---

## Success Criteria

✅ **Phase 5 Complete When:**
1. PaymentIntent creation endpoint works with Stripe test API
2. Webhook endpoint receives and verifies Stripe events
3. WebhookEvent collection prevents double-processing (idempotent)
4. Bull worker processes payment events asynchronously
5. Order.paymentStatus updates correctly (pending → succeeded/failed)
6. Customer + admin receive emails on payment success/failure
7. Auto-refund works for pending/confirmed orders
8. All tests pass with mocked Stripe API
9. No PCI-sensitive data touches our servers
10. Full audit trail in PaymentLog + Order.timeline

---

## Deferred to Phase 5.x

- PayPal integration (requires separate testing setup)
- Bank transfer/ACH (low priority, B2B only)
- Chargeback auto-response (manual admin review for now)
- Partial refunds UI (Phase 6 admin dashboard)
- Subscription/recurring billing (not in scope)

---

**Next Step**: Plan phase with specific tasks ➜ Execute ➜ Verify


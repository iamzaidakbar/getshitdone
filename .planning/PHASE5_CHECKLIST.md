# Phase 5: Payments — Deployment Checklist ✅

**Status**: Complete  
**Date**: 2025  
**Reviewer**: [Your Name]  
**Approved**: [ ] Yes [ ] No  

---

## Pre-Deployment Verification

### Code Quality

- [ ] **Syntax Check**: All files pass `node -c`
  ```bash
  node -c src/modules/payments/controller.js
  node -c src/modules/payments/routes.js
  node -c src/modules/payments/model.js
  node -c src/modules/payments/worker.js
  node -c src/utils/stripe.js
  ```

- [ ] **Linting**: No errors in payment module
  ```bash
  npm run lint -- src/modules/payments
  ```

- [ ] **Tests Passing**: All unit tests pass
  ```bash
  npm test -- src/modules/payments/__tests__
  ```
  - Payment intent creation tests ✅
  - Webhook idempotency tests ✅
  - Refund logic tests ✅
  - Error handling tests ✅

- [ ] **No TypeScript Errors**: (if using TypeScript)
  ```bash
  npm run build
  ```

---

### Dependencies

- [ ] **Stripe SDK**: `npm ls stripe` shows v22.0.0+
  ```bash
  npm ls stripe
  ```

- [ ] **Bull Queue**: `npm ls bull` shows v4.16.5+
  ```bash
  npm ls bull
  ```

- [ ] **Redis**: `npm ls redis` shows v5.11.0+
  ```bash
  npm ls redis
  ```

- [ ] **Security**: Audit dependencies for vulnerabilities
  ```bash
  npm audit
  # All vulnerabilities should be LOW or none
  ```

---

### Environment Configuration

- [ ] **.env.dev Configured**:
  - [ ] STRIPE_SECRET_KEY (test key)
  - [ ] STRIPE_PUBLISHABLE_KEY (test key)
  - [ ] STRIPE_WEBHOOK_SECRET (test secret)
  - [ ] REDIS_URL (localhost:6379 for dev)
  - [ ] ADMIN_EMAIL (test email)

- [ ] **.env.prod Ready** (ready to deploy):
  - [ ] STRIPE_SECRET_KEY (live key)
  - [ ] STRIPE_PUBLISHABLE_KEY (live key)
  - [ ] STRIPE_WEBHOOK_SECRET (live secret)
  - [ ] REDIS_URL (production Redis endpoint)
  - [ ] ADMIN_EMAIL (production admin email)

- [ ] **No Secrets in Code**:
  ```bash
  grep -r "sk_test_\|sk_live_\|whsec_" src/
  # Should return NO RESULTS
  ```

---

### Database Setup

- [ ] **Collections Created**:
  ```bash
  # Verify in MongoDB
  db.webhookevents.find().limit(1)
  db.paymentlogs.find().limit(1)
  ```

- [ ] **Indexes Created**:
  ```bash
  # Verify unique index on stripeEventId
  db.webhookevents.getIndexes()
  # Should show: { "stripeEventId": 1 } with unique: true
  
  # Verify compound indexes
  db.paymentlogs.getIndexes()
  db.orders.getIndexes()
  ```

- [ ] **Order Collection Extended**:
  ```bash
  # Verify payment fields exist
  db.orders.findOne({}, { 
    paymentIntentId: 1, 
    paymentStatus: 1, 
    refundedAmount: 1 
  })
  ```

---

### Infrastructure

- [ ] **Redis Running**:
  ```bash
  redis-cli ping
  # Response: PONG
  ```

- [ ] **MongoDB Accessible**:
  ```bash
  mongosh --eval "db.adminCommand('ping')"
  # Response: { ok: 1 }
  ```

- [ ] **Server Startup Clean**:
  ```bash
  npm run dev
  # Check logs for:
  # ✅ "Stripe client initialized"
  # ✅ "Bull queue connected"
  # ✅ "Payment routes mounted"
  # No error messages
  ```

---

## Feature Verification

### Payment Intent Creation

- [ ] **Endpoint Responding**:
  ```bash
  curl -X POST http://localhost:5000/api/v1/payments/create-intent \
    -H "Authorization: Bearer <TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"orderId": "<ORDER_ID>"}'
  # Expected: 200 with { clientSecret, paymentIntentId }
  ```

- [ ] **Idempotency Key Set**:
  - [ ] Verify in Stripe Dashboard: same orderId returns same PaymentIntent
  - [ ] Verify Stripe API logs show idempotencyKey used

- [ ] **Order Updated**:
  ```bash
  db.orders.findOne({ _id: ObjectId("<ORDER_ID>") })
  # Should show: paymentIntentId set, paymentStatus: "pending"
  ```

- [ ] **Authentication Required**:
  ```bash
  curl -X POST http://localhost:5000/api/v1/payments/create-intent \
    -d '{"orderId": "<ORDER_ID>"}'
  # Expected: 401 Unauthorized
  ```

- [ ] **Order Ownership Verified**:
  - [ ] User A cannot create intent for User B's order (403)
  - [ ] Admin can create intent for any order ✅

---

### Webhook Handling

- [ ] **Signature Verification Active**:
  ```bash
  # Send webhook with invalid signature
  curl -X POST http://localhost:5000/api/v1/payments/webhook \
    -H "stripe-signature: invalid_sig" \
    -d '{"id":"evt_test"}'
  # Expected: 400 Bad Request
  ```

- [ ] **Valid Webhook Accepted**:
  ```bash
  stripe trigger payment_intent.succeeded
  # Expected: 200 Received from endpoint
  # Check console: "Webhook queued for processing"
  ```

- [ ] **Idempotency Working**:
  ```bash
  stripe trigger payment_intent.succeeded
  stripe trigger payment_intent.succeeded  # Same event again
  # Expected: Both return 200
  # Check database: WebhookEvent.status marked as 'processed'
  # Check logs: NOT processing twice (idempotent)
  ```

- [ ] **Bull Queue Processing**:
  ```bash
  # Monitor Bull dashboard or logs
  npm run dev
  # Trigger webhook, wait 2 seconds
  # Check logs for: "Payment succeeded for order <ID>"
  ```

- [ ] **WebhookEvent Stored**:
  ```bash
  db.webhookevents.findOne({ stripeEventId: "evt_test" })
  # Should show: status: "processed", processedAt: <timestamp>
  ```

---

### Refund Functionality

- [ ] **Customer Refund (Pending Order)**:
  ```bash
  curl -X POST http://localhost:5000/api/v1/payments/refund \
    -H "Authorization: Bearer <CUSTOMER_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"orderId": "<PENDING_ORDER_ID>", "reason": "customer_request"}'
  # Expected: 200 Refund processed
  ```

- [ ] **Hybrid Logic Enforced**:
  - [ ] Customer can refund pending order ✅
  - [ ] Customer can refund confirmed order ✅
  - [ ] Customer CANNOT refund shipped order (403)
  - [ ] Admin CAN refund any order ✅

- [ ] **No Double Refunds**:
  ```bash
  # Attempt refund on already-refunded order
  # Expected: 400 "Order already refunded"
  ```

- [ ] **Unpaid Order Check**:
  - [ ] Cannot refund if paymentStatus !== 'succeeded' (400)

- [ ] **Order Updated After Refund**:
  ```bash
  db.orders.findOne({ _id: ObjectId("<ORDER_ID>") })
  # Should show: paymentStatus: "refunded", refundedAmount: <amount>
  ```

- [ ] **PaymentLog Entry Created**:
  ```bash
  db.paymentlogs.findOne({ orderId: ObjectId("<ORDER_ID>"), action: "refund_initiated" })
  # Should exist with: amount, stripeIntentId, metadata
  ```

---

### Email Notifications

- [ ] **Payment Success Email**:
  - [ ] Send payment (via Stripe), check email inbox
  - [ ] Email shows order details and payment confirmation ✅

- [ ] **Payment Failure Email**:
  - [ ] Trigger failed payment webhook
  - [ ] Customer receives failure notification ✅
  - [ ] Admin receives alert email ✅

- [ ] **Refund Email**:
  - [ ] Process refund
  - [ ] Customer receives refund confirmation ✅
  - [ ] Email shows refund amount and timeline ✅

- [ ] **Email Templates**:
  - [ ] No hardcoded sensitive data in templates
  - [ ] Order details populated correctly
  - [ ] URLs use environment-based domain

---

## Security Verification

### PCI Compliance

- [ ] **No Raw Card Data**:
  ```bash
  grep -r "cardNumber\|cvv\|cardToken" src/
  # Should return NO RESULTS
  ```

- [ ] **No Card Logging**:
  ```bash
  grep -r "card:" logs/
  # Should return NO RESULTS (except Stripe responses which don't contain raw data)
  ```

- [ ] **Stripe.js Used Frontend**:
  - [ ] Frontend never submits raw card to our servers
  - [ ] Frontend uses Stripe Elements or Stripe.js
  - [ ] Only stripe.confirmCardPayment called from frontend

- [ ] **Server Never Handles Tokens**:
  - [ ] No `payment_method` tokens in request body parsing
  - [ ] All payment method data delegated to Stripe

### Signature Verification

- [ ] **Webhook Signature Check**:
  ```bash
  # Verify in controller.js:
  const event = stripe.webhooks.constructEvent(req.rawBody, ...)
  # ✅ Using rawBody (not JSON-parsed)
  # ✅ Verifying signature before processing
  ```

- [ ] **Signature Header Checked**:
  ```bash
  grep -n "stripe-signature" src/modules/payments/controller.js
  # Should be used in verifyWebhookSignature function
  ```

### Idempotency Keys

- [ ] **Payment Intent Idempotency**:
  ```bash
  grep -n "idempotencyKey: \`order-" src/modules/payments/controller.js
  # Should show idempotency key pattern
  ```

- [ ] **Refund Idempotency**:
  ```bash
  grep -n "idempotencyKey: \`refund-" src/modules/payments/controller.js
  # Should show idempotency key pattern
  ```

### Rate Limiting

- [ ] **Payment Endpoints Limited**:
  - [ ] Max 5 requests/minute for create-intent
  - [ ] Max 2 requests/minute for refund
  - [ ] Test: 6th request in 60s returns 429

---

## Error Handling Verification

- [ ] **404 Order Not Found**:
  ```bash
  curl -X POST http://localhost:5000/api/v1/payments/create-intent \
    -d '{"orderId": "nonexistent_id"}'
  # Expected: 404 with clear error message
  ```

- [ ] **403 Not Authorized**:
  - [ ] User A tries to pay for User B's order (403)
  - [ ] Customer tries to refund shipped order (403)

- [ ] **401 Unauthenticated**:
  - [ ] Request without JWT token (401)
  - [ ] Request with invalid token (401)

- [ ] **Stripe API Error Handling**:
  - [ ] Network timeout handled gracefully (500)
  - [ ] Invalid request to Stripe shows user-friendly error

- [ ] **Bull Queue Error Handling**:
  - [ ] Failed webhook job retried automatically
  - [ ] Max retries exceeded logged and alerted

---

## Monitoring & Observability

- [ ] **Logging Active**:
  ```bash
  npm run dev
  # Check console for:
  # ✅ "Stripe client initialized"
  # ✅ Webhook events logged
  # ✅ Payment status updates logged
  ```

- [ ] **Error Alerts**:
  - [ ] Failed payments trigger admin email
  - [ ] Webhook processing errors logged
  - [ ] Stripe API errors captured

- [ ] **Database Queries Logged** (if using query logging):
  ```bash
  # Should see PaymentLog inserts, WebhookEvent updates
  ```

---

## Documentation Verification

- [ ] **PHASE5_PAYMENTS.md Complete**:
  - [ ] Architecture overview with diagrams
  - [ ] Payment flow explained step-by-step
  - [ ] Webhook idempotency explained
  - [ ] API endpoint documentation
  - [ ] Error handling guide
  - [ ] Deployment checklist

- [ ] **Code Comments Present**:
  - [ ] Controller functions documented
  - [ ] Idempotency logic explained
  - [ ] PCI compliance notes
  - [ ] Error handling commented

- [ ] **README Updated**:
  - [ ] Phase 5 mentioned in main README
  - [ ] Payment system architecture described
  - [ ] Links to PHASE5_PAYMENTS.md

---

## Testing Completion

- [ ] **Unit Tests Passing**:
  ```bash
  npm test -- payment.test.js
  npm test -- webhook.test.js
  ```
  - [ ] PaymentIntent creation tests (3+ tests)
  - [ ] Webhook idempotency tests (4+ tests)
  - [ ] Refund logic tests (5+ tests)
  - [ ] Error handling tests (3+ tests)

- [ ] **Coverage Adequate**:
  - [ ] 80%+ code coverage for payment module
  - [ ] Critical paths tested (happy path + error cases)

- [ ] **Manual Testing Complete**:
  - [ ] Created test order
  - [ ] Generated PaymentIntent
  - [ ] Simulated payment with Stripe CLI
  - [ ] Verified webhook processing
  - [ ] Tested refund flow
  - [ ] Verified emails sent

---

## Deployment Readiness

### Development ✅
- [ ] All code committed to version control
- [ ] All tests passing locally
- [ ] Linting/formatting passes

### Staging
- [ ] Deployed to staging environment
- [ ] All endpoints responding
- [ ] Stripe test keys configured
- [ ] Webhook endpoint accessible
- [ ] End-to-end testing in staging (with Stripe test data)
- [ ] Admin alerts working
- [ ] Email notifications sent

### Production
- [ ] Stripe webhook verification: Endpoint health check passing
- [ ] Stripe live API keys configured (separate from staging)
- [ ] Redis production instance running
- [ ] MongoDB production instance running
- [ ] WAF/network security rules allow Stripe IPs
- [ ] HTTPS enforced (required by Stripe)
- [ ] Monitoring/alerting configured
- [ ] Backup strategy in place (MongoDB, Redis)

---

## Post-Deployment Verification

- [ ] **First Payment Test**:
  - [ ] Create real order in production
  - [ ] Request PaymentIntent
  - [ ] Complete payment with test card (if staging) or real card (if live)
  - [ ] Verify webhook delivery
  - [ ] Verify Order updated to confirmed
  - [ ] Verify success email sent

- [ ] **Monitor for 24 Hours**:
  - [ ] No errors in payment processing
  - [ ] Webhooks delivered reliably
  - [ ] No database connection issues
  - [ ] Redis queue processing smoothly

- [ ] **Webhook Endpoint Monitor**:
  ```bash
  # Check Stripe Dashboard → Developers → Webhooks
  # Should show green checkmarks for recent deliveries
  ```

- [ ] **Update Incident Response Plan**:
  - [ ] Payment failure escalation procedure
  - [ ] Webhook delivery troubleshooting steps
  - [ ] Stripe API outage procedure
  - [ ] On-call rotation configured

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | _____________ | _______ | _____________ |
| Code Reviewer | _____________ | _______ | _____________ |
| QA Lead | _____________ | _______ | _____________ |
| Product Manager | _____________ | _______ | _____________ |

---

## Notes & Issues

**Resolved Issues** (Mark as complete):
- [ ] (Leave blank if no issues)

**Known Limitations**:
- [ ] (List any known limitations or future improvements)

**Future Enhancements**:
- [ ] Currency support beyond USD
- [ ] Partial refunds
- [ ] Subscription billing (Phase 6?)
- [ ] Payment method verification (3D Secure)
- [ ] Advanced fraud detection

---

**Last Updated**: 2025  
**Next Review**: [After 30 days of operation]  
**Owner**: [Team Lead]

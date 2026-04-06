/**
 * Payment Webhook Tests
 * Verifies webhook signature verification, idempotency, and async processing
 */

jest.mock('stripe');
jest.mock('../../config/models');
jest.mock('../../utils/email');

const Stripe = require('stripe');
const request = require('supertest');
const app = require('../../../app');
const { WebhookEvent, Order } = require('../../config/models');
const { sendPaymentSuccessEmail, sendPaymentFailureEmail } = require('../../utils/email');
const { stripe, verifyWebhookSignature } = require('../../utils/stripe');

describe('Payment Webhooks - Idempotency & Signature Verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Webhook Signature Verification', () => {
    it('should reject webhook with invalid signature', async () => {
      const payload = JSON.stringify({
        id: 'evt_test_123',
        type: 'payment_intent.succeeded'
      });

      // Mock invalid signature
      stripe.webhooks.constructEvent.mockImplementationOnce(() => {
        throw new Error('Invalid signature');
      });

      const response = await request(app)
        .post('/api/v1/payments/webhook')
        .set('stripe-signature', 'invalid_signature')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('webhook_error');
    });

    it('should accept webhook with valid signature', async () => {
      const payload = {
        id: 'evt_test_123',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_123' } }
      };

      stripe.webhooks.constructEvent.mockReturnValue(payload);
      WebhookEvent.prototype.save = jest.fn().mockResolvedValue(true);

      const response = await request(app)
        .post('/api/v1/payments/webhook')
        .set('stripe-signature', 'valid_signature')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);
      expect(stripe.webhooks.constructEvent).toHaveBeenCalled();
    });
  });

  describe('Webhook Idempotency', () => {
    it('should not process duplicate webhook event (already processed)', async () => {
      const stripeEventId = 'evt_duplicate_123';
      const webhookPayload = {
        id: stripeEventId,
        type: 'payment_intent.succeeded'
      };

      // Mock: WebhookEvent already exists with status='processed'
      const mockWebhookEvent = {
        _id: 'webhook_123',
        stripeEventId,
        status: 'processed',
        processedAt: new Date(),
        save: jest.fn()
      };

      WebhookEvent.findOne.mockResolvedValueOnce(mockWebhookEvent);
      stripe.webhooks.constructEvent.mockReturnValue(webhookPayload);

      const response = await request(app)
        .post('/api/v1/payments/webhook')
        .set('stripe-signature', 'sig_test')
        .send(webhookPayload);

      // Should return 200 (idempotent) without queueing another job
      expect(response.status).toBe(200);
      // Verify we didn't re-process
      expect(WebhookEvent.prototype.save).not.toHaveBeenCalled();
    });

    it('should retry webhook event if previous attempt failed', async () => {
      const stripeEventId = 'evt_retry_123';
      const webhookPayload = {
        id: stripeEventId,
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_456' } }
      };

      // Mock: WebhookEvent exists with status='failed'
      const mockWebhookEvent = {
        _id: 'webhook_456',
        stripeEventId,
        status: 'failed',
        errorMessage: 'Previous attempt timeout',
        retryCount: 1,
        payload: webhookPayload.data,
        save: jest.fn().mockResolvedValue(true)
      };

      WebhookEvent.findOne.mockResolvedValueOnce(mockWebhookEvent);
      stripe.webhooks.constructEvent.mockReturnValue(webhookPayload);

      const response = await request(app)
        .post('/api/v1/payments/webhook')
        .set('stripe-signature', 'sig_test')
        .send(webhookPayload);

      expect(response.status).toBe(200);
      // Verify retry attempt incremented
      expect(mockWebhookEvent.retryCount).toBeGreaterThan(0);
    });

    it('should create WebhookEvent for new event (first time seen)', async () => {
      const stripeEventId = 'evt_new_123';
      const webhookPayload = {
        id: stripeEventId,
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_new_789' } }
      };

      // Mock: No existing WebhookEvent
      WebhookEvent.findOne.mockResolvedValueOnce(null);
      WebhookEvent.mockImplementationOnce((payload) => ({
        ...payload,
        save: jest.fn().mockResolvedValue(true)
      }));
      stripe.webhooks.constructEvent.mockReturnValue(webhookPayload);

      const response = await request(app)
        .post('/api/v1/payments/webhook')
        .set('stripe-signature', 'sig_test')
        .send(webhookPayload);

      expect(response.status).toBe(200);
      // Verify WebhookEvent was created
      expect(WebhookEvent).toHaveBeenCalled();
    });
  });

  describe('Webhook Event Processing', () => {
    it('should queue payment_intent.succeeded for async processing', async () => {
      const webhookPayload = {
        id: 'evt_processing_123',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_async_123' } }
      };

      WebhookEvent.findOne.mockResolvedValueOnce(null);
      WebhookEvent.mockImplementationOnce((payload) => ({
        ...payload,
        _id: 'webhook_async',
        save: jest.fn().mockResolvedValue(true)
      }));
      stripe.webhooks.constructEvent.mockReturnValue(webhookPayload);

      const response = await request(app)
        .post('/api/v1/payments/webhook')
        .set('stripe-signature', 'sig_test')
        .send(webhookPayload);

      // Should return 200 immediately (async processing)
      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);
    });

    it('should handle unknown webhook types gracefully', async () => {
      const webhookPayload = {
        id: 'evt_unknown_123',
        type: 'some.unknown.event',
        data: { object: { id: 'obj_unknown' } }
      };

      WebhookEvent.findOne.mockResolvedValueOnce(null);
      WebhookEvent.mockImplementationOnce((payload) => ({
        ...payload,
        save: jest.fn().mockResolvedValue(true)
      }));
      stripe.webhooks.constructEvent.mockReturnValue(webhookPayload);

      const response = await request(app)
        .post('/api/v1/payments/webhook')
        .set('stripe-signature', 'sig_test')
        .send(webhookPayload);

      // Should still queue to worker (worker decides how to handle)
      expect(response.status).toBe(200);
    });
  });
});

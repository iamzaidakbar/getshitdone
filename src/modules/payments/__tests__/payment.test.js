/**
 * Payment Intent Tests
 * Verifies PaymentIntent creation with idempotency keys and refund logic
 */

jest.mock('stripe');
jest.mock('../../config/models');
jest.mock('../../utils/email');

const Stripe = require('stripe');
const request = require('supertest');
const app = require('../../../app');
const { Order, User } = require('../../config/models');
const { stripe } = require('../../utils/stripe');

describe('Payment Intent Creation & Refunds', () => {
  const mockUserId = 'user_123';
  const mockOrderId = 'order_456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Create Payment Intent', () => {
    it('should create PaymentIntent with idempotency key', async () => {
      const mockOrder = {
        _id: mockOrderId,
        userId: mockUserId,
        pricing: { total: 99.99 },
        status: 'pending',
        items: [],
        save: jest.fn().mockResolvedValue(true)
      };

      const mockPaymentIntent = {
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret_xyz',
        status: 'requires_payment_method'
      };

      Order.findById.mockResolvedValueOnce(mockOrder);
      stripe.paymentIntents.create.mockResolvedValueOnce(mockPaymentIntent);

      const response = await request(app)
        .post('/api/v1/payments/create-intent')
        .set('Authorization', `Bearer token_${mockUserId}`)
        .send({ orderId: mockOrderId });

      expect(response.status).toBe(200);
      expect(response.body.clientSecret).toBe(mockPaymentIntent.client_secret);
      expect(response.body.paymentIntentId).toBe(mockPaymentIntent.id);

      // Verify idempotency key was set
      expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 9999, // cents
          currency: 'usd'
        }),
        expect.objectContaining({
          idempotencyKey: `order-${mockOrderId}`
        })
      );

      // Verify Order document updated with paymentIntentId
      expect(mockOrder.save).toHaveBeenCalled();
      expect(mockOrder.paymentIntentId).toBe(mockPaymentIntent.id);
    });

    it('should return 404 if order not found', async () => {
      Order.findById.mockResolvedValueOnce(null);

      const response = await request(app)
        .post('/api/v1/payments/create-intent')
        .set('Authorization', `Bearer token_${mockUserId}`)
        .send({ orderId: mockOrderId });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('Order not found');
    });

    it('should return 403 if user does not own order', async () => {
      const mockOrder = {
        _id: mockOrderId,
        userId: 'different_user',
        save: jest.fn()
      };

      Order.findById.mockResolvedValueOnce(mockOrder);

      const response = await request(app)
        .post('/api/v1/payments/create-intent')
        .set('Authorization', `Bearer token_${mockUserId}`)
        .send({ orderId: mockOrderId });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('not authorized');
    });

    it('should handle Stripe API errors gracefully', async () => {
      const mockOrder = {
        _id: mockOrderId,
        userId: mockUserId,
        pricing: { total: 99.99 },
        save: jest.fn()
      };

      Order.findById.mockResolvedValueOnce(mockOrder);
      stripe.paymentIntents.create.mockRejectedValueOnce(
        new Error('Stripe API error: Card declined')
      );

      const response = await request(app)
        .post('/api/v1/payments/create-intent')
        .set('Authorization', `Bearer token_${mockUserId}`)
        .send({ orderId: mockOrderId });

      expect(response.status).toBe(500);
      expect(response.body.message).toContain('Payment processing failed');
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app)
        .post('/api/v1/payments/create-intent')
        .send({ orderId: mockOrderId });

      expect(response.status).toBe(401);
    });
  });

  describe('Refund Order - Hybrid Logic', () => {
    const mockUser = {
      _id: mockUserId,
      email: 'user@example.com'
    };

    it('should auto-refund for PENDING order (customer)', async () => {
      const mockOrder = {
        _id: mockOrderId,
        userId: mockUserId,
        status: 'pending',
        pricing: { total: 50.00 },
        paymentIntentId: 'pi_refund_123',
        paymentStatus: 'succeeded',
        refundedAmount: 0,
        timeline: [],
        save: jest.fn().mockResolvedValue(true)
      };

      User.findById.mockResolvedValueOnce(mockUser);
      Order.findById.mockResolvedValueOnce(mockOrder);
      stripe.refunds.create.mockResolvedValueOnce({
        id: 're_test_123',
        status: 'succeeded'
      });

      const response = await request(app)
        .post('/api/v1/payments/refund')
        .set('Authorization', `Bearer token_${mockUserId}`)
        .send({ orderId: mockOrderId, reason: 'customer_request' });

      expect(response.status).toBe(200);
      expect(mockOrder.paymentStatus).toBe('refunded');
      expect(mockOrder.refundedAmount).toBe(50.00);

      // Verify idempotency key
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          idempotencyKey: `refund-${mockOrderId}`
        })
      );
    });

    it('should auto-refund for CONFIRMED order (customer)', async () => {
      const mockOrder = {
        _id: mockOrderId,
        userId: mockUserId,
        status: 'confirmed',
        pricing: { total: 75.00 },
        paymentIntentId: 'pi_refund_456',
        paymentStatus: 'succeeded',
        refundedAmount: 0,
        timeline: [],
        save: jest.fn().mockResolvedValue(true)
      };

      User.findById.mockResolvedValueOnce(mockUser);
      Order.findById.mockResolvedValueOnce(mockOrder);
      stripe.refunds.create.mockResolvedValueOnce({
        id: 're_test_456',
        status: 'succeeded'
      });

      const response = await request(app)
        .post('/api/v1/payments/refund')
        .set('Authorization', `Bearer token_${mockUserId}`)
        .send({ orderId: mockOrderId, reason: 'customer_request' });

      expect(response.status).toBe(200);
      expect(mockOrder.paymentStatus).toBe('refunded');
    });

    it('should DENY refund for SHIPPED order (customer only)', async () => {
      const mockOrder = {
        _id: mockOrderId,
        userId: mockUserId,
        status: 'shipped',
        pricing: { total: 100.00 },
        paymentStatus: 'succeeded'
      };

      Order.findById.mockResolvedValueOnce(mockOrder);

      const response = await request(app)
        .post('/api/v1/payments/refund')
        .set('Authorization', `Bearer token_${mockUserId}`)
        .send({ orderId: mockOrderId, reason: 'customer_request' });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('admin only');
      // Verify refund NOT created
      expect(stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('should ALLOW admin to refund SHIPPED order', async () => {
      const mockOrder = {
        _id: mockOrderId,
        userId: 'other_user',
        status: 'shipped',
        pricing: { total: 100.00 },
        paymentIntentId: 'pi_admin_refund',
        paymentStatus: 'succeeded',
        refundedAmount: 0,
        timeline: [],
        save: jest.fn().mockResolvedValue(true)
      };

      const mockAdmin = {
        _id: 'admin_123',
        email: 'admin@example.com',
        role: 'admin'
      };

      User.findById.mockResolvedValueOnce(mockAdmin);
      Order.findById.mockResolvedValueOnce(mockOrder);
      stripe.refunds.create.mockResolvedValueOnce({
        id: 're_admin_123',
        status: 'succeeded'
      });

      const response = await request(app)
        .post('/api/v1/payments/refund')
        .set('Authorization', `Bearer token_admin_123`)
        .send({ orderId: mockOrderId, reason: 'damage_in_shipping' });

      expect(response.status).toBe(200);
      expect(mockOrder.paymentStatus).toBe('refunded');
      expect(stripe.refunds.create).toHaveBeenCalled();
    });

    it('should not refund order that was never paid', async () => {
      const mockOrder = {
        _id: mockOrderId,
        userId: mockUserId,
        status: 'pending',
        paymentStatus: 'failed',
        pricing: { total: 50.00 }
      };

      Order.findById.mockResolvedValueOnce(mockOrder);

      const response = await request(app)
        .post('/api/v1/payments/refund')
        .set('Authorization', `Bearer token_${mockUserId}`)
        .send({ orderId: mockOrderId, reason: 'customer_request' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('not paid');
      expect(stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('should not double-refund an already refunded order', async () => {
      const mockOrder = {
        _id: mockOrderId,
        userId: mockUserId,
        status: 'pending',
        paymentStatus: 'refunded',
        refundedAmount: 50.00,
        pricing: { total: 50.00 }
      };

      Order.findById.mockResolvedValueOnce(mockOrder);

      const response = await request(app)
        .post('/api/v1/payments/refund')
        .set('Authorization', `Bearer token_${mockUserId}`)
        .send({ orderId: mockOrderId, reason: 'customer_request' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('already refunded');
      expect(stripe.refunds.create).not.toHaveBeenCalled();
    });
  });

  describe('Idempotency for Refunds', () => {
    it('should use order ID as idempotency key to prevent duplicate refunds', async () => {
      const mockOrder = {
        _id: mockOrderId,
        userId: mockUserId,
        status: 'pending',
        paymentIntentId: 'pi_idempotent_test',
        paymentStatus: 'succeeded',
        refundedAmount: 0,
        pricing: { total: 100.00 },
        timeline: [],
        save: jest.fn().mockResolvedValue(true)
      };

      User.findById.mockResolvedValueOnce(mockUser);
      Order.findById.mockResolvedValueOnce(mockOrder);
      stripe.refunds.create.mockResolvedValueOnce({
        id: 're_idempotent_123',
        status: 'succeeded'
      });

      await request(app)
        .post('/api/v1/payments/refund')
        .set('Authorization', `Bearer token_${mockUserId}`)
        .send({ orderId: mockOrderId, reason: 'customer_request' });

      // Verify idempotency key includes orderId
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          idempotencyKey: `refund-${mockOrderId}`
        })
      );
    });
  });
});

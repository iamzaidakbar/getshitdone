/**
 * Orders Routes
 * Order management endpoints with atomic transactions
 */

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../../utils');
const { requireAuth, requireRole } = require('../../middlewares/auth');
const ordersController = require('./controller');

/**
 * POST /api/v1/orders
 * Create new order from cart
 * Auth: Required (customer)
 * Body: {
 *   shippingAddress: {
 *     street: string,
 *     city: string,
 *     state: string,
 *     zip: string,
 *     country: string
 *   },
 *   billingAddress?: { ... } (defaults to shipping address),
 *   paymentMethod: 'card' | 'paypal' | 'bank_transfer',
 *   couponCode?: string
 * }
 *
 * TRANSACTION:
 * 1. Validates cart not empty
 * 2. Locks prices
 * 3. Validates stock (atomic)
 * 4. Decrements inventory (with session)
 * 5. Creates order
 * 6. Clears cart
 * 7. Returns created order
 */
router.post(
  '/',
  requireAuth,
  asyncHandler(ordersController.createOrder)
);

/**
 * GET /api/v1/orders
 * Get user's orders with pagination
 * Auth: Required (customer)
 * Query: {
 *   page?: number (default: 1),
 *   limit?: number (default: 10),
 *   status?: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
 * }
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(ordersController.getUserOrders)
);

/**
 * GET /api/v1/orders/:orderId
 * Get specific order details
 * Auth: Required (customer can view own orders, admin can view any)
 */
router.get(
  '/:orderId',
  requireAuth,
  asyncHandler(ordersController.getOrderById)
);

/**
 * PATCH /api/v1/orders/:orderId/status
 * Update order status with state machine validation
 * Auth: Admin only
 * Body: {
 *   status: string (must be valid transition),
 *   notes?: string
 * }
 *
 * STATUS MACHINE:
 * pending → confirmed → processing → shipped → delivered
 * pending/confirmed → cancelled
 */
router.patch(
  '/:orderId/status',
  requireAuth,
  requireRole('admin'),
  asyncHandler(ordersController.updateOrderStatus)
);

/**
 * POST /api/v1/orders/:orderId/cancel
 * Cancel order (reverses inventory, marks cancelled)
 * Auth: Customer (own orders) or admin
 * Body: { reason?: string }
 *
 * TRANSACTION:
 * 1. Validates order can be cancelled (pending/confirmed status)
 * 2. Reverses stock for all items
 * 3. Updates order status
 * 4. Records timeline entry
 */
router.post(
  '/:orderId/cancel',
  requireAuth,
  asyncHandler(ordersController.cancelOrder)
);

/**
 * GET /api/v1/orders/admin/stats
 * Get order statistics and analytics
 * Auth: Admin only
 * Returns: {
 *   totalOrders,
 *   totalRevenue,
 *   ordersByStatus,
 *   topProducts[]
 * }
 */
router.get(
  '/admin/stats',
  requireAuth,
  requireRole('admin'),
  asyncHandler(ordersController.getOrderStats)
);

module.exports = router;

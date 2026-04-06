/**
 * Cart Routes
 * Shopping cart endpoints with TTL verification
 */

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../../utils');
const { requireAuth } = require('../../middlewares/auth');
const cartController = require('./controller');

/**
 * GET /api/v1/cart
 * Retrieve user's shopping cart
 * Auth: Required (customer)
 */
router.get('/', requireAuth, asyncHandler(cartController.getCart));

/**
 * POST /api/v1/cart/items
 * Add item to cart
 * Auth: Required (customer)
 * Body: {
 *   productId: string (ObjectId),
 *   quantity: number,
 *   selectedVariants?: object (color, size, etc.)
 * }
 */
router.post('/items', requireAuth, asyncHandler(cartController.addToCart));

/**
 * PATCH /api/v1/cart/items/:itemId
 * Update cart item quantity
 * Auth: Required (customer)
 * Body: { quantity: number }
 */
router.patch('/items/:itemId', requireAuth, asyncHandler(cartController.updateCartItem));

/**
 * DELETE /api/v1/cart/items/:itemId
 * Remove item from cart
 * Auth: Required (customer)
 */
router.delete('/items/:itemId', requireAuth, asyncHandler(cartController.removeFromCart));

/**
 * POST /api/v1/cart/verify
 * Verify cart prices and availability (call before checkout)
 * Auth: Required (customer)
 * Returns: { valid, priceChanges[], totalImpact }
 */
router.post('/verify', requireAuth, asyncHandler(cartController.verifyCartPrices));

/**
 * DELETE /api/v1/cart
 * Clear entire cart
 * Auth: Required (customer)
 */
router.delete('/', requireAuth, asyncHandler(cartController.clearCart));

module.exports = router;

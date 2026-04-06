/**
 * Cart Controller
 * Handles shopping cart operations with price locking at checkout
 */

const { Cart, Product } = require('../../config/models');
const { ApiError, ApiResponse, asyncHandler, logger } = require('../../utils');

/**
 * Get user's cart
 * GET /api/v1/cart
 */
const getCart = async (req, res, next) => {
  try {
    const userId = req.user.id;

    let cart = await Cart.findOne({ user: userId })
      .populate('items.productId', 'name price stock images')
      .lean();

    if (!cart) {
      // Create empty cart
      cart = {
        items: [],
        totalPrice: 0,
        itemCount: 0,
      };
    }

    res.json(
      new ApiResponse(200, cart, 'Cart retrieved successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Add item to cart
 * POST /api/v1/cart/items
 * Body: { productId, quantity, selectedVariants? }
 */
const addToCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId, quantity, selectedVariants } = req.body;

    // Verify product exists and has stock
    const product = await Product.findById(productId);
    if (!product) {
      throw new ApiError(404, 'Product not found');
    }

    if (product.stock < quantity) {
      throw new ApiError(400, 'Insufficient stock', {
        requested: quantity,
        available: product.stock,
      });
    }

    // Get or create cart
    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = new Cart({
        user: userId,
        items: [],
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      });
    }

    // Check if item already in cart
    const existingItem = cart.items.find(
      (item) => item.productId.toString() === productId && 
                JSON.stringify(item.selectedVariants || {}) === JSON.stringify(selectedVariants || {})
    );

    if (existingItem) {
      // Update quantity
      existingItem.quantity += quantity;
    } else {
      // Add new item
      cart.items.push({
        productId,
        quantity,
        selectedVariants: selectedVariants || {},
        priceLocked: null, // Price is NOT locked until checkout
      });
    }

    // Reset expiration on update
    cart.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await cart.save();

    logger.info('Item added to cart', {
      userId,
      productId,
      quantity,
    });

    // Return populated cart
    await cart.populate('items.productId', 'name price stock images');

    res.json(
      new ApiResponse(200, cart.toJSON(), 'Item added to cart')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Update cart item quantity
 * PATCH /api/v1/cart/items/:itemId
 * Body: { quantity }
 */
const updateCartItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;
    const { quantity } = req.body;

    if (quantity < 0) {
      throw new ApiError(400, 'Quantity must be positive');
    }

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      throw new ApiError(404, 'Cart not found');
    }

    const item = cart.items.id(itemId);
    if (!item) {
      throw new ApiError(404, 'Item not in cart');
    }

    // Verify stock before update
    const product = await Product.findById(item.productId);
    if (!product || product.stock < quantity) {
      throw new ApiError(400, 'Insufficient stock', {
        requested: quantity,
        available: product?.stock || 0,
      });
    }

    if (quantity === 0) {
      // Remove item
      item.deleteOne();
    } else {
      item.quantity = quantity;
    }

    await cart.save();

    logger.info('Cart item updated', {
      userId,
      itemId,
      quantity,
    });

    await cart.populate('items.productId', 'name price stock images');

    res.json(
      new ApiResponse(200, cart.toJSON(), 'Cart item updated')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Remove item from cart
 * DELETE /api/v1/cart/items/:itemId
 */
const removeFromCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      throw new ApiError(404, 'Cart not found');
    }

    const item = cart.items.id(itemId);
    if (!item) {
      throw new ApiError(404, 'Item not in cart');
    }

    item.deleteOne();
    await cart.save();

    logger.info('Item removed from cart', {
      userId,
      itemId,
    });

    await cart.populate('items.productId', 'name price stock images');

    res.json(
      new ApiResponse(200, cart.toJSON(), 'Item removed from cart')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Verify cart prices (called before checkout)
 * POST /api/v1/cart/verify
 * Re-fetches current prices and returns price changes
 */
const verifyCartPrices = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({ user: userId }).populate('items.productId');
    if (!cart || cart.items.length === 0) {
      throw new ApiError(400, 'Cart is empty');
    }

    const priceChanges = [];
    let hasChanges = false;

    // Verify each item's current price
    for (const item of cart.items) {
      const product = item.productId;

      // Check stock
      if (product.stock < item.quantity) {
        throw new ApiError(400, 'Item out of stock', {
          productId: product._id,
          requested: item.quantity,
          available: product.stock,
        });
      }

      // Check price changes
      if (product.price !== item.priceSnapshots?.[0]?.price) {
        hasChanges = true;
        priceChanges.push({
          productId: product._id,
          productName: product.name,
          oldPrice: item.priceSnapshots?.[0]?.price || product.price,
          newPrice: product.price,
          quantity: item.quantity,
          difference: (product.price - (item.priceSnapshots?.[0]?.price || product.price)) * item.quantity,
        });
      }
    }

    res.json(
      new ApiResponse(
        200,
        {
          valid: !hasChanges,
          priceChanges,
          totalImpact: priceChanges.reduce((sum, change) => sum + change.difference, 0),
        },
        hasChanges ? 'Price changes detected' : 'Cart prices verified'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Clear cart
 * DELETE /api/v1/cart
 */
const clearCart = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const result = await Cart.deleteOne({ user: userId });

    if (result.deletedCount === 0) {
      throw new ApiError(404, 'Cart not found');
    }

    logger.info('Cart cleared', { userId });

    res.json(new ApiResponse(200, null, 'Cart cleared'));
  } catch (error) {
    next(error);
  }
};

/**
 * Lock cart prices for checkout
 * @internal Used during order creation
 */
const lockCartPrices = async (userId) => {
  const cart = await Cart.findOne({ user: userId }).populate('items.productId');
  if (!cart) {
    throw new ApiError(404, 'Cart not found');
  }

  // Lock prices by creating snapshots
  for (const item of cart.items) {
    item.priceSnapshots = [
      {
        price: item.productId.price,
        lockedAt: new Date(),
      },
    ];
  }

  await cart.save();
  return cart;
};

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  verifyCartPrices,
  clearCart,
  lockCartPrices,
};

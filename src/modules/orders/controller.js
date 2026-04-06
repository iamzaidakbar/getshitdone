/**
 * Orders Controller
 * Handles order creation, state management, and transaction processing
 * Uses MongoDB transactions for atomicity on stock decrement
 */

const mongoose = require('mongoose');
const { Order, Product, Cart, User } = require('../../config/models');
const { ApiError, ApiResponse, asyncHandler, logger } = require('../../utils');
const { lockCartPrices } = require('../cart/controller');

/**
 * Order Status Machine
 * pending → confirmed → processing → shipped → delivered
 * Can transition to cancelled from pending or confirmed
 */
const ORDER_STATUSES = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
};

const ALLOWED_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

/**
 * Validate order status transition
 */
const canTransitionTo = (currentStatus, newStatus) => {
  return ALLOWED_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
};

/**
 * Create order from cart with atomic stock decrement
 * POST /api/v1/orders
 * Body: {
 *   shippingAddress: { street, city, state, zip, country },
 *   billingAddress?: { ... } (defaults to shipping),
 *   paymentMethod: 'card' | 'paypal' | 'bank_transfer',
 *   couponCode?: string
 * }
 *
 * TRANSACTION FLOW:
 * 1. Verify cart exists and not empty
 * 2. Lock cart prices
 * 3. Start MongoDB transaction session
 * 4. Validate stock for all items
 * 5. Decrement stock (atomic with session)
 * 6. Create order with locked prices
 * 7. Clear cart
 * 8. Commit transaction
 */
const createOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.id;
    const { shippingAddress, billingAddress, paymentMethod, couponCode } = req.body;

    // 1. Get user's cart
    const cart = await Cart.findOne({ user: userId })
      .populate('items.productId')
      .session(session);

    if (!cart || cart.items.length === 0) {
      throw new ApiError(400, 'Cart is empty');
    }

    // 2. Validate addresses
    if (!shippingAddress || !shippingAddress.street || !shippingAddress.city ||
        !shippingAddress.state || !shippingAddress.zip || !shippingAddress.country) {
      throw new ApiError(400, 'Complete shipping address is required');
    }

    // 3. Prepare order items and verify stock atomically
    const orderItems = [];
    let totalPrice = 0;
    let totalDiscount = 0;

    for (const cartItem of cart.items) {
      const product = cartItem.productId;

      // Stock validation - must be atomic in transaction
      const updatedProduct = await Product.findOneAndUpdate(
        {
          _id: product._id,
          stock: { $gte: cartItem.quantity },
        },
        {
          $inc: { stock: -cartItem.quantity },
          $push: { 
            inventory_history: {
              action: 'order_reserved',
              quantity: cartItem.quantity,
              orderId: new mongoose.Types.ObjectId(), // Placeholder
              timestamp: new Date(),
            }
          },
        },
        { new: true, session }
      );

      if (!updatedProduct) {
        throw new ApiError(409, `Insufficient stock for product: ${product.name}`, {
          productId: product._id,
          requested: cartItem.quantity,
          available: product.stock,
        });
      }

      const itemTotal = product.price * cartItem.quantity;
      totalPrice += itemTotal;

      orderItems.push({
        product: product._id,
        productName: product.name,
        productImage: product.images?.[0] || '',
        quantity: cartItem.quantity,
        unitPrice: product.price,
        total: itemTotal,
        selectedVariants: cartItem.selectedVariants || {},
      });
    }

    // 4. Apply coupon if provided
    if (couponCode) {
      // Coupon validation would go here
      // totalDiscount = await validateAndApplyCoupon(couponCode, totalPrice);
    }

    const finalPrice = totalPrice - totalDiscount;
    const taxAmount = Math.round(finalPrice * 0.10); // 10% tax
    const shippingCost = 10; // Fixed $10 shipping
    const grandTotal = finalPrice + taxAmount + shippingCost;

    // 5. Create order with transaction
    const orderData = {
      user: userId,
      items: orderItems,
      shippingAddress,
      billingAddress: billingAddress || shippingAddress,
      paymentMethod,
      pricing: {
        subtotal: finalPrice,
        discount: totalDiscount,
        tax: taxAmount,
        shipping: shippingCost,
        total: grandTotal,
      },
      status: ORDER_STATUSES.PENDING,
      timeline: [
        {
          status: ORDER_STATUSES.PENDING,
          timestamp: new Date(),
          message: 'Order created, awaiting payment confirmation',
        },
      ],
    };

    const order = await Order.create([orderData], { session });
    const createdOrder = order[0];

    // Update inventory history with actual orderId
    await Product.updateMany(
      { 'inventory_history.action': 'order_reserved' },
      { 
        $set: { 
          'inventory_history.$[last].orderId': createdOrder._id 
        }
      },
      { 
        arrayFilters: [{ 'last.action': 'order_reserved' }],
        session 
      }
    );

    // 6. Clear cart
    await Cart.deleteOne({ user: userId }, { session });

    // 7. Send order confirmation email (async, not transactional)
    const user = await User.findById(userId);
    // await sendOrderConfirmationEmail(user.email, createdOrder);

    await session.commitTransaction();

    logger.info('Order created successfully', {
      orderId: createdOrder._id,
      userId,
      total: grandTotal,
      itemCount: orderItems.length,
    });

    res.status(201).json(
      new ApiResponse(201, createdOrder, 'Order created successfully')
    );
  } catch (error) {
    await session.abortTransaction();
    logger.error('Order creation failed', { error: error.message, userId: req.user.id });
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * Get user's orders
 * GET /api/v1/orders
 * Query: { page?, limit?, status? }
 */
const getUserOrders = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    const filter = { user: userId };
    if (status && status in ORDER_STATUSES) {
      filter.status = status;
    }

    const orders = await Order.find(filter)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Order.countDocuments(filter);

    res.json(
      new ApiResponse(
        200,
        {
          orders,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
        'Orders retrieved successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get order details
 * GET /api/v1/orders/:orderId
 */
const getOrderById = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await Order.findById(orderId).populate('user', 'name email');

    if (!order) {
      throw new ApiError(404, 'Order not found');
    }

    // Users can only view their own orders (unless admin)
    if (order.user._id.toString() !== userId && req.user.role !== 'admin') {
      throw new ApiError(403, 'Access denied');
    }

    res.json(
      new ApiResponse(200, order, 'Order retrieved successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Update order status
 * PATCH /api/v1/orders/:orderId/status
 * Body: { status, notes? }
 * Admin only - with state machine validation
 */
const updateOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;

    if (!(status in ORDER_STATUSES)) {
      throw new ApiError(400, 'Invalid order status', {
        validStatuses: Object.values(ORDER_STATUSES),
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      throw new ApiError(404, 'Order not found');
    }

    // Validate transition
    if (!canTransitionTo(order.status, status)) {
      throw new ApiError(400, `Cannot transition from ${order.status} to ${status}`, {
        currentStatus: order.status,
        allowedStatuses: ALLOWED_TRANSITIONS[order.status],
      });
    }

    // Update order
    order.status = status;
    order.timeline.push({
      status,
      timestamp: new Date(),
      message: notes || `Order status updated to ${status}`,
    });

    await order.save();

    logger.info('Order status updated', {
      orderId,
      newStatus: status,
      previousStatus: order.status,
    });

    res.json(
      new ApiResponse(200, order, 'Order status updated successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel order
 * POST /api/v1/orders/:orderId/cancel
 * Customer or admin - reverses stock, marks as cancelled
 */
const cancelOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    const { reason } = req.body;

    const order = await Order.findById(orderId).session(session);
    if (!order) {
      throw new ApiError(404, 'Order not found');
    }

    // Check permissions
    if (order.user.toString() !== userId && req.user.role !== 'admin') {
      throw new ApiError(403, 'Access denied');
    }

    // Can only cancel pending or confirmed orders
    if (!canTransitionTo(order.status, ORDER_STATUSES.CANCELLED)) {
      throw new ApiError(400, `Cannot cancel order with status: ${order.status}`);
    }

    // Reverse stock for all items
    for (const item of order.items) {
      const updated = await Product.findByIdAndUpdate(
        item.product,
        {
          $inc: { stock: item.quantity },
          $push: {
            inventory_history: {
              action: 'order_cancelled_reversed',
              quantity: item.quantity,
              orderId: order._id,
              timestamp: new Date(),
            },
          },
        },
        { session, new: true }
      );

      if (!updated) {
        throw new ApiError(500, 'Failed to reverse stock');
      }
    }

    // Update order
    order.status = ORDER_STATUSES.CANCELLED;
    order.timeline.push({
      status: ORDER_STATUSES.CANCELLED,
      timestamp: new Date(),
      message: reason || 'Order cancelled by customer',
    });

    await order.save({ session });
    await session.commitTransaction();

    logger.info('Order cancelled', {
      orderId,
      userId,
      reason: reason || 'No reason provided',
    });

    res.json(
      new ApiResponse(200, order, 'Order cancelled successfully')
    );
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * Get order statistics (admin only)
 * GET /api/v1/orders/admin/stats
 */
const getOrderStats = async (req, res, next) => {
  try {
    const totalOrders = await Order.countDocuments();
    const totalRevenue = await Order.aggregate([
      {
        $group: {
          _id: null,
          revenue: { $sum: '$pricing.total' },
          avgOrderValue: { $avg: '$pricing.total' },
        },
      },
    ]);

    const ordersByStatus = await Order.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const topProducts = await Order.aggregate([
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          totalSold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.total' },
        },
      },
      { $sort: { totalSold: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'productInfo',
        },
      },
    ]);

    res.json(
      new ApiResponse(
        200,
        {
          totalOrders,
          totalRevenue: totalRevenue[0] || { revenue: 0, avgOrderValue: 0 },
          ordersByStatus,
          topProducts,
        },
        'Order statistics retrieved'
      )
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrder,
  getUserOrders,
  getOrderById,
  updateOrderStatus,
  cancelOrder,
  getOrderStats,
  ORDER_STATUSES,
  ALLOWED_TRANSITIONS,
};

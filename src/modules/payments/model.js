/**
 * Payment-Related Schemas
 * Includes Coupon, WebhookEvent, and PaymentLog models
 */

const mongoose = require('mongoose');

// =====================
// COUPON SCHEMA
// =====================

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['percentage', 'fixed'],
      required: true,
    },
    // Discount value: percentage (0-100) or fixed amount in cents
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    // Maximum amount off (for percentage discounts)
    maxDiscountAmount: {
      type: Number,
      min: 0,
    },
    // Minimum purchase amount required to use coupon (in cents)
    minPurchaseAmount: {
      type: Number,
      default: 0,
    },
    // Maximum number of times this coupon can be used
    maxUses: {
      type: Number,
      required: true,
    },
    // Number of times this coupon has been used
    usedCount: {
      type: Number,
      default: 0,
    },
    // Expiration date
    expiryDate: {
      type: Date,
      required: true,
    },
    // Applicable categories (null means all)
    applicableCategories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
      },
    ],
    // Applicable products (null means all)
    applicableProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    // Users who can use this coupon (null means all)
    applicableUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    description: String,
  },
  {
    timestamps: true,
  }
);

// Index for active coupon lookups
couponSchema.index({ code: 1, isActive: 1 });
couponSchema.index({ expiryDate: 1, isActive: 1 });

// Virtual to check if coupon is expired
couponSchema.virtual('isExpired').get(function () {
  return this.expiryDate < new Date();
});

// Virtual to check if coupon can still be used
couponSchema.virtual('canUse').get(function () {
  return this.isActive && !this.isExpired && this.usedCount < this.maxUses;
});

// Ensure virtuals are included in toJSON
couponSchema.set('toJSON', { virtuals: true });

// =====================
// WEBHOOK EVENT SCHEMA
// =====================

const webhookEventSchema = new mongoose.Schema(
  {
    // Unique Stripe event ID - used for idempotency
    stripeEventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Type of webhook event (e.g., payment_intent.succeeded, charge.refunded)
    type: {
      type: String,
      required: true,
      index: true,
    },
    // Full webhook payload from Stripe
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    // Processing status
    status: {
      type: String,
      enum: ['pending', 'processed', 'failed'],
      default: 'pending',
      index: true,
    },
    // When the webhook was successfully processed
    processedAt: Date,
    // Error message if processing failed
    errorMessage: String,
    // Number of retry attempts
    retryCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure stripeEventId is unique
webhookEventSchema.index({ stripeEventId: 1 }, { unique: true });
// Index for finding pending webhooks
webhookEventSchema.index({ status: 1, createdAt: -1 });

// =====================
// PAYMENT LOG SCHEMA
// =====================

const paymentLogSchema = new mongoose.Schema(
  {
    // Reference to the order
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    // Action type (payment_initiated, payment_succeeded, refund_issued, etc.)
    action: {
      type: String,
      required: true,
      index: true,
    },
    // Stripe PaymentIntent or Refund ID
    stripeIntentId: String,
    // Payment amount in dollars
    amount: {
      type: Number,
      required: true,
    },
    // Currency code
    currency: {
      type: String,
      default: 'USD',
    },
    // Additional metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt
  }
);

// Index for audit trail lookups
paymentLogSchema.index({ orderId: 1, createdAt: -1 });
paymentLogSchema.index({ action: 1 });

// =====================
// MODELS & EXPORTS
// =====================

const Coupon = mongoose.model('Coupon', couponSchema);
const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);
const PaymentLog = mongoose.model('PaymentLog', paymentLogSchema);

module.exports = {
  Coupon,
  WebhookEvent,
  PaymentLog,
};

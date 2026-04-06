/**
 * Coupon Schema
 * Stores coupon/discount codes with usage limits and expiration
 */

const mongoose = require('mongoose');

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

module.exports = mongoose.model('Coupon', couponSchema);

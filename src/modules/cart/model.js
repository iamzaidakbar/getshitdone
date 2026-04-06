/**
 * Cart Schema
 * Stores shopping cart with items and expiration
 * Uses TTL index to automatically delete abandoned carts after 30 days
 */

const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    items: [
      {
        _id: false,
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Product',
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        // Price snapshot at time of cart addition (in cents)
        price: {
          type: Number,
          required: true,
        },
        // Selected variant options
        selectedVariants: {
          type: Map,
          of: String,
        },
      },
    ],
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  },
  {
    timestamps: true,
  }
);

// TTL index to auto-delete expired carts
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for user lookups
cartSchema.index({ user: 1 });

// Virtual to calculate total items count
cartSchema.virtual('itemCount').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

// Virtual to calculate total price (in cents)
cartSchema.virtual('totalPrice').get(function () {
  return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
});

// Ensure virtuals are included in toJSON
cartSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Cart', cartSchema);

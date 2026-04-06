/**
 * Order Schema
 * Stores order information with items, shipping, payment, and timeline
 */

const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
        // Price snapshot at time of purchase (in cents)
        price: {
          type: Number,
          required: true,
        },
        selectedVariants: {
          type: Map,
          of: String,
        },
      },
    ],
    shippingAddress: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
      phone: String,
    },
    // Order status
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
      default: 'pending',
    },
    // Payment information
    payment: {
      method: {
        type: String,
        enum: ['credit_card', 'debit_card', 'paypal', 'stripe', 'bank_transfer'],
      },
      status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
        default: 'pending',
      },
      transactionId: String,
      paidAt: Date,
      // Total in cents
      amount: {
        type: Number,
        required: true,
      },
    },
    // Pricing breakdown
    pricing: {
      subtotal: Number, // in cents
      shipping: { type: Number, default: 0 }, // in cents
      tax: { type: Number, default: 0 }, // in cents
      discount: { type: Number, default: 0 }, // in cents
      total: Number, // in cents
    },
    // Timeline of status changes
    timeline: [
      {
        _id: false,
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String,
      },
    ],
    // Coupon/discount applied
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon',
    },
    notes: String,
  },
  {
    timestamps: true,
  }
);

// Add pagination plugin
orderSchema.plugin(mongoosePaginate);

// Compound indexes for common queries
orderSchema.index({ user: 1, status: 1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);

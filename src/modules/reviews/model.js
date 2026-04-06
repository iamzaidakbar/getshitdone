/**
 * Review Schema
 * Stores product reviews with verified purchase flag
 */

const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    title: {
      type: String,
      trim: true,
    },
    body: {
      type: String,
      trim: true,
    },
    // Flag to indicate if reviewer has made a verified purchase
    verifiedPurchase: {
      type: Boolean,
      default: false,
    },
    // Helpful votes count
    helpful: {
      type: Number,
      default: 0,
    },
    unhelpful: {
      type: Number,
      default: 0,
    },
    isApproved: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Add pagination plugin
reviewSchema.plugin(mongoosePaginate);

// Compound indexes for common queries
reviewSchema.index({ product: 1, isApproved: 1 });
reviewSchema.index({ user: 1, product: 1 }, { unique: true }); // One review per user per product
reviewSchema.index({ rating: -1 });
reviewSchema.index({ verifiedPurchase: 1 });

module.exports = mongoose.model('Review', reviewSchema);

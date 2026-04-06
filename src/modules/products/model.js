/**
 * Product Schema
 * Stores product information with variants, pricing, and ratings
 * Prices stored as integers (cents) to avoid float precision issues
 */

const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    sku: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
    },
    description: {
      type: String,
      trim: true,
    },
    // Price in cents (e.g., $19.99 = 1999)
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    // Discount price in cents
    discountPrice: {
      type: Number,
      min: 0,
    },
    stock: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    images: [
      {
        _id: false,
        url: String,
        alt: String,
        isPrimary: { type: Boolean, default: false },
      },
    ],
    variants: [
      {
        _id: false,
        name: String, // e.g., "Color", "Size"
        options: [String], // e.g., ["Red", "Blue", "Green"]
      },
    ],
    ratings: {
      average: {
        type: Number,
        min: 0,
        max: 5,
        default: 0,
      },
      count: {
        type: Number,
        default: 0,
      },
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Add pagination plugin
productSchema.plugin(mongoosePaginate);

// Compound indexes for common queries
productSchema.index({ category: 1, price: 1, stock: 1 });
productSchema.index({ slug: 1 });
productSchema.index({ sku: 1 });
productSchema.index({ seller: 1, isActive: 1 });
productSchema.index({ 'ratings.average': -1, 'ratings.count': -1 });

// Virtual to get discount percentage
productSchema.virtual('discountPercentage').get(function () {
  if (!this.discountPrice || !this.price) return 0;
  return Math.round(((this.price - this.discountPrice) / this.price) * 100);
});

// Ensure virtuals are included in toJSON
productSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);

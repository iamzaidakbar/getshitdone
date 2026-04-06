/**
 * Category Schema
 * Supports nested categories through self-referencing parent field
 */

const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
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
    description: {
      type: String,
      trim: true,
    },
    image: String,
    // Self-reference for nested categories (e.g., Electronics > Mobile Phones)
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for finding active categories by parent
categorySchema.index({ parent: 1, isActive: 1 });
categorySchema.index({ slug: 1 });

// Virtual to get path (breadcrumb)
categorySchema.virtual('path').set(function (val) {
  this._path = val;
});

categorySchema.virtual('path').get(async function () {
  if (this._path) return this._path;

  if (!this.parent) return [{ id: this._id, name: this.name }];

  const parent = await mongoose.model('Category').findById(this.parent);
  if (!parent) return [{ id: this._id, name: this.name }];

  const parentPath = await parent.path;
  return [...parentPath, { id: this._id, name: this.name }];
});

// Cache Invalidation Hooks
// Emit events to invalidate cache when category changes
const { eventEmitter, EVENTS } = require('../../utils/events');

categorySchema.post('save', function (doc) {
  // Invalidate single category cache
  eventEmitter.emit(EVENTS.CACHE_INVALIDATE_CATEGORY, {
    categoryId: doc._id.toString(),
    action: 'save',
  });

  // Invalidate entire category tree cache
  eventEmitter.emit(EVENTS.CACHE_INVALIDATE_CATEGORY_TREE);
});

categorySchema.post('findOneAndDelete', function (doc) {
  if (doc) {
    eventEmitter.emit(EVENTS.CACHE_INVALIDATE_CATEGORY, {
      categoryId: doc._id.toString(),
      action: 'delete',
    });
    eventEmitter.emit(EVENTS.CACHE_INVALIDATE_CATEGORY_TREE);
  }
});

categorySchema.post('deleteOne', function (doc) {
  if (doc) {
    eventEmitter.emit(EVENTS.CACHE_INVALIDATE_CATEGORY, {
      categoryId: doc._id.toString(),
      action: 'delete',
    });
    eventEmitter.emit(EVENTS.CACHE_INVALIDATE_CATEGORY_TREE);
  }
});

module.exports = mongoose.model('Category', categorySchema);

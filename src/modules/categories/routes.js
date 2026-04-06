/**
 * Categories Routes
 * Product category management endpoints
 */

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../../utils');
const { requireAuth, requireRole } = require('../../middlewares/auth');
const categoriesController = require('./controller');

/**
 * POST /api/v1/categories
 * Create new category
 * Auth: Admin only
 * Body: {
 *   name: string (required),
 *   description?: string,
 *   parentId?: string (ObjectId for subcategory)
 * }
 */
router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(categoriesController.createCategory)
);

/**
 * GET /api/v1/categories
 * Get all categories with filters
 * Auth: Public
 * Query: {
 *   parentId?: string (filter by parent category),
 *   includeChildren?: boolean (include all nested, default false for root only)
 * }
 */
router.get('/', asyncHandler(categoriesController.getAllCategories));

/**
 * GET /api/v1/categories/:id
 * Get category by ID or slug with breadcrumb and children
 * Auth: Public
 */
router.get('/:id', asyncHandler(categoriesController.getCategoryById));

/**
 * PATCH /api/v1/categories/:id
 * Update category
 * Auth: Admin only
 * Body: {
 *   name?: string,
 *   description?: string,
 *   parentId?: string (or null to make root)
 * }
 */
router.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(categoriesController.updateCategory)
);

/**
 * DELETE /api/v1/categories/:id
 * Delete category (soft delete)
 * Auth: Admin only
 * Note: Category must have no active children and no active products
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(categoriesController.deleteCategory)
);

module.exports = router;

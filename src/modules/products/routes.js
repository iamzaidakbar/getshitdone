/**
 * Products Routes
 * Handles product CRUD and management endpoints
 */

const express = require('express');
const { asyncHandler } = require('../../utils');
const { requireAuth, requireRole } = require('../../middlewares/auth');
const { cacheGet } = require('../../middlewares/cacheMiddleware');
const productController = require('./controller');

const router = express.Router();

/**
 * POST /api/v1/products
 * Create new product (admin)
 */
router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(productController.createProduct)
);

/**
 * GET /api/v1/products
 * Get all products with filters and pagination
 * Cached for 5 minutes
 */
router.get(
  '/',
  cacheGet((req) => {
    // Key includes query params for proper cache separation
    const page = req.query.page || 1;
    const limit = req.query.limit || 20;
    const sort = req.query.sort || 'createdAt';
    return `products:list:${page}:${limit}:${sort}`;
  }, 300),
  asyncHandler(productController.getAllProducts)
);

/**
 * GET /api/v1/products/search/faceted
 * Get products with faceted filtering
 * Cached for 5 minutes
 */
router.get(
  '/search/faceted',
  cacheGet((req) => {
    // Include all query params in cache key for faceted search
    const params = Object.keys(req.query).sort().map(k => `${k}=${req.query[k]}`).join('&');
    return `products:faceted:${params || 'all'}`;
  }, 300),
  asyncHandler(productController.getProductsWithFacets)
);

/**
 * GET /api/v1/products/:id
 * Get single product by ID or slug
 * Cached for 5 minutes
 */
router.get(
  '/:id',
  cacheGet((req) => `product:${req.params.id}`, 300),
  asyncHandler(productController.getProductById)
);

/**
 * PATCH /api/v1/products/:id
 * Update product (admin)
 */
router.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(productController.updateProduct)
);

/**
 * DELETE /api/v1/products/:id
 * Delete product (admin) - soft delete
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(productController.deleteProduct)
);

/**
 * POST /api/v1/products/:id/images
 * Add product image (admin)
 * Expects multipart/form-data with 'image' field
 */
router.post(
  '/:id/images',
  requireAuth,
  requireRole('admin'),
  // multer middleware would be added here
  asyncHandler(productController.addProductImage)
);

module.exports = router;

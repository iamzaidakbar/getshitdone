/**
 * Central route aggregator
 * Import all route modules and register them with the app
 *
 * Usage in app.js:
 * app.use('/api', require('./routes'));
 */

const express = require('express');

const router = express.Router();

// Import module routes
const authRoutes = require('../modules/auth/routes');
const productsRoutes = require('../modules/products/routes');
const categoriesRoutes = require('../modules/categories/routes');
const cartRoutes = require('../modules/cart/routes');
const ordersRoutes = require('../modules/orders/routes');
const paymentsRoutes = require('../modules/payments/routes');
const queuesRoutes = require('../modules/queues/routes');

// Register routes
router.use('/v1/auth', authRoutes);
router.use('/v1/products', productsRoutes);
router.use('/v1/categories', categoriesRoutes);
router.use('/v1/cart', cartRoutes);
router.use('/v1/orders', ordersRoutes);
router.use('/v1/payments', paymentsRoutes);
router.use('/admin/queues', queuesRoutes);

module.exports = router;

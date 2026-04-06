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

// Register routes
router.use('/v1/auth', authRoutes);

// TODO: Register additional module routes
// const userRoutes = require('./users');
// const productRoutes = require('./products');
// router.use('/v1/users', userRoutes);
// router.use('/v1/products', productRoutes);

module.exports = router;

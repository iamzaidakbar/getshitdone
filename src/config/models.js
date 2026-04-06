/**
 * Centralized Model Imports
 * Export all models from a single location for easy importing
 */

module.exports = {
  User: require('../modules/users/model'),
  Product: require('../modules/products/model'),
  Category: require('../modules/categories/model'),
  Cart: require('../modules/cart/model'),
  Order: require('../modules/orders/model'),
  Review: require('../modules/reviews/model'),
  Coupon: require('../modules/payments/model'),
};

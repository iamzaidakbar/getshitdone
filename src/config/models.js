/**
 * Centralized Model Imports
 * Export all models from a single location for easy importing
 */

const { Coupon, WebhookEvent, PaymentLog } = require('../modules/payments/model');

module.exports = {
  User: require('../modules/users/model'),
  Product: require('../modules/products/model'),
  Category: require('../modules/categories/model'),
  Cart: require('../modules/cart/model'),
  Order: require('../modules/orders/model'),
  Review: require('../modules/reviews/model'),
  Coupon,
  WebhookEvent,
  PaymentLog,
};

/**
 * Event Emitter Singleton
 * Centralized event bus for application-wide events
 * Used for cache invalidation and other decoupled operations
 */

const EventEmitter = require('events');

class AppEventEmitter extends EventEmitter {
  constructor() {
    super();
    // Set max listeners to avoid warnings in production
    this.setMaxListeners(20);
  }
}

// Create singleton instance
const eventEmitter = new AppEventEmitter();

// Define event names for cache invalidation
const EVENTS = {
  CACHE_INVALIDATE_PRODUCT: 'cache:invalidate:product',
  CACHE_INVALIDATE_PRODUCT_LIST: 'cache:invalidate:product:list',
  CACHE_INVALIDATE_CATEGORY: 'cache:invalidate:category',
  CACHE_INVALIDATE_CATEGORY_TREE: 'cache:invalidate:category:tree',
};

module.exports = {
  eventEmitter,
  EVENTS,
};

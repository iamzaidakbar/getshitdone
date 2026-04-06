/**
 * Cache Invalidation Listener
 * Listens for model change events and clears associated cache
 */

const { eventEmitter, EVENTS } = require('./events');
const { deleteFromCache, deletePatternFromCache } = require('./cache');
const logger = require('./logger');

/**
 * Initialize cache invalidation listeners
 * Should be called once on app startup
 */
const initializeCacheInvalidation = () => {
  // Invalidate single product cache
  eventEmitter.on(EVENTS.CACHE_INVALIDATE_PRODUCT, async (data) => {
    try {
      const { productId, action } = data;
      logger.info(`Cache invalidation: Product ${productId} (${action})`);
      await deleteFromCache(`product:${productId}`);
    } catch (err) {
      logger.warn(`Cache invalidation error for product: ${err.message}`);
    }
  });

  // Invalidate product listing cache
  eventEmitter.on(EVENTS.CACHE_INVALIDATE_PRODUCT_LIST, async () => {
    try {
      logger.info('Cache invalidation: All product listings');
      const deleted = await deletePatternFromCache('products:list:*');
      logger.debug(`Deleted ${deleted} product list cache keys`);
    } catch (err) {
      logger.warn(`Cache invalidation error for product list: ${err.message}`);
    }
  });

  // Invalidate single category cache
  eventEmitter.on(EVENTS.CACHE_INVALIDATE_CATEGORY, async (data) => {
    try {
      const { categoryId } = data;
      logger.info(`Cache invalidation: Category ${categoryId}`);
      await deleteFromCache(`category:${categoryId}`);
      // Also invalidate category listings that might include this category
      await deletePatternFromCache('categories:list:*');
    } catch (err) {
      logger.warn(`Cache invalidation error for category: ${err.message}`);
    }
  });

  // Invalidate category tree cache (used by listings)
  eventEmitter.on(EVENTS.CACHE_INVALIDATE_CATEGORY_TREE, async () => {
    try {
      logger.info('Cache invalidation: Category tree');
      const deleted = await deletePatternFromCache('categories:*');
      logger.debug(`Deleted ${deleted} category cache keys`);
    } catch (err) {
      logger.warn(`Cache invalidation error for category tree: ${err.message}`);
    }
  });

  logger.info('Cache invalidation listeners initialized');
};

module.exports = {
  initializeCacheInvalidation,
};

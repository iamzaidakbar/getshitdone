/**
 * Cache Middleware
 * Implements cache-aside pattern for read-only GET requests
 * Gracefully falls back to database if cache unavailable
 */

const { getFromCache, setToCache } = require('../utils/cache');
const logger = require('../utils/logger');

/**
 * Cache middleware factory
 * Creates a middleware that caches GET request responses
 * @param {string|Function} keyGenerator - Cache key or function to generate key from request
 * @param {number} ttl - Time to live in seconds (default: 300)
 * @returns {Function} Express middleware
 */
const cacheGet = (keyGenerator, ttl = 300) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    try {
      // Generate cache key
      let cacheKey;
      if (typeof keyGenerator === 'function') {
        cacheKey = keyGenerator(req);
      } else {
        cacheKey = keyGenerator;
      }

      // Try to get from cache
      const cached = await getFromCache(cacheKey);
      if (cached) {
        res.set('X-Cache', 'HIT');
        return res.status(200).json(cached);
      }

      // Mark as cache miss
      res.set('X-Cache', 'MISS');

      // Store original json method
      const originalJson = res.json;

      // Override res.json to cache successful responses
      res.json = function (data) {
        // Cache only successful responses (2xx status)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          setToCache(cacheKey, data, ttl).catch((err) => {
            logger.warn(`Failed to cache response for ${cacheKey}: ${err.message}`);
            // Don't re-throw - already sent response
          });
        }

        // Call original json method
        return originalJson.call(this, data);
      };

      next();
    } catch (err) {
      logger.warn(`Cache middleware error for key: ${err.message}`);
      // Fail open - continue without caching
      next();
    }
  };
};

/**
 * Invalidate cache for a key
 * Can be called from routes or services
 * @param {string|string[]} keys - Single key or array of keys to invalidate
 */
const invalidateCache = async (keys) => {
  if (!Array.isArray(keys)) {
    keys = [keys];
  }

  for (const key of keys) {
    try {
      const { deleteFromCache } = require('../utils/cache');
      await deleteFromCache(key);
    } catch (err) {
      logger.warn(`Failed to invalidate cache for ${key}: ${err.message}`);
    }
  }
};

module.exports = {
  cacheGet,
  invalidateCache,
};

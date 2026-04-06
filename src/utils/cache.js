/**
 * Cache Utility
 * Provides cache-aside pattern methods with graceful fallback
 * All methods fail silently - system continues without cache if Redis unavailable
 */

const { getRedisClient, isRedisConnected } = require('./redis-client');
const logger = require('./logger');

const DEFAULT_TTL = 300; // 5 minutes

/**
 * Get value from cache
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} Cached value (parsed JSON) or null if not found/Redis unavailable
 */
const getFromCache = async (key) => {
  if (!isRedisConnected()) {
    return null;
  }

  try {
    const client = getRedisClient();
    if (!client) {
      return null;
    }

    const value = await client.get(key);
    if (value) {
      logger.debug(`Cache HIT for key: ${key}`);
      try {
        return JSON.parse(value);
      } catch {
        // Return raw value if not JSON
        return value;
      }
    }

    logger.debug(`Cache MISS for key: ${key}`);
    return null;
  } catch (err) {
    logger.warn(`Cache GET error for key ${key}: ${err.message}`);
    return null;
  }
};

/**
 * Set value in cache with optional TTL
 * @param {string} key - Cache key
 * @param {any} value - Value to cache (will be JSON stringified)
 * @param {number} ttl - Time to live in seconds (default: 300)
 * @returns {Promise<boolean>} true if set successfully, false otherwise
 */
const setToCache = async (key, value, ttl = DEFAULT_TTL) => {
  if (!isRedisConnected()) {
    return false;
  }

  try {
    const client = getRedisClient();
    if (!client) {
      return false;
    }

    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await client.setEx(key, ttl, serialized);
    logger.debug(`Cache SET for key: ${key} (TTL: ${ttl}s)`);
    return true;
  } catch (err) {
    logger.warn(`Cache SET error for key ${key}: ${err.message}`);
    return false;
  }
};

/**
 * Delete single cache key
 * @param {string} key - Cache key to delete
 * @returns {Promise<boolean>} true if deleted, false otherwise
 */
const deleteFromCache = async (key) => {
  if (!isRedisConnected()) {
    return false;
  }

  try {
    const client = getRedisClient();
    if (!client) {
      return false;
    }

    await client.del(key);
    logger.info(`Cache DELETE for key: ${key}`);
    return true;
  } catch (err) {
    logger.warn(`Cache DELETE error for key ${key}: ${err.message}`);
    return false;
  }
};

/**
 * Delete cache keys matching a pattern
 * Uses Redis SCAN for memory efficiency (doesn't block)
 * @param {string} pattern - Key pattern (e.g., 'products:list:*')
 * @returns {Promise<number>} Number of keys deleted
 */
const deletePatternFromCache = async (pattern) => {
  if (!isRedisConnected()) {
    return 0;
  }

  try {
    const client = getRedisClient();
    if (!client) {
      return 0;
    }

    let count = 0;
    let cursor = 0;

    // Use SCAN to iterate through matching keys
    do {
      const reply = await client.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      });
      cursor = reply.cursor;
      const keys = reply.keys;

      if (keys.length > 0) {
        await client.del(keys);
        count += keys.length;
      }
    } while (cursor !== 0);

    logger.info(`Cache DELETE pattern: ${pattern} (${count} keys deleted)`);
    return count;
  } catch (err) {
    logger.warn(`Cache DELETE pattern error for ${pattern}: ${err.message}`);
    return 0;
  }
};

/**
 * Clear entire cache (dev only)
 * @returns {Promise<boolean>} true if cleared, false otherwise
 */
const clearCache = async () => {
  if (!isRedisConnected()) {
    return false;
  }

  try {
    const client = getRedisClient();
    if (!client) {
      return false;
    }

    if (process.env.NODE_ENV !== 'dev') {
      logger.warn('clearCache called in non-dev environment - ignoring');
      return false;
    }

    await client.flushDb();
    logger.info('Cache completely flushed (DEV ONLY)');
    return true;
  } catch (err) {
    logger.warn(`Cache FLUSH error: ${err.message}`);
    return false;
  }
};

/**
 * Cache-aside pattern helper
 * Automatically fetches from cache, or calls getter function and caches result
 * @param {string} key - Cache key
 * @param {Function} getter - Async function to fetch value if not cached
 * @param {number} ttl - Cache TTL in seconds (default: 300)
 * @returns {Promise<any>} Cached or newly fetched value
 */
const getOrSet = async (key, getter, ttl = DEFAULT_TTL) => {
  try {
    // Try cache first
    const cached = await getFromCache(key);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - fetch from getter
    const value = await getter();

    // Set in cache (non-blocking)
    setToCache(key, value, ttl).catch((err) => {
      logger.warn(`Failed to cache value for ${key}: ${err.message}`);
    });

    return value;
  } catch (err) {
    logger.error(`getOrSet error for key ${key}: ${err.message}`);
    throw err;
  }
};

module.exports = {
  getFromCache,
  setToCache,
  deleteFromCache,
  deletePatternFromCache,
  clearCache,
  getOrSet,
  DEFAULT_TTL,
};

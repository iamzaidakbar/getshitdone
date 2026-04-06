/**
 * Redis Client Singleton
 * Provides a single Redis connection instance for the entire application
 * Handles graceful connection and error management
 */

const { createClient } = require('redis');
const config = require('../config');
const logger = require('./logger');

let redisClient = null;
let isConnected = false;

/**
 * Initialize Redis client
 * @returns {Promise<void>}
 */
const initializeRedis = async () => {
  if (redisClient) {
    return;
  }

  try {
    redisClient = createClient({
      url: config.redis.url,
      socket: {
        reconnectStrategy: (retries) => {
          // Exponential backoff: 100ms, 200ms, 400ms, 800ms, etc.
          // Cap at 5 attempts (3.2 seconds)
          if (retries > 5) {
            logger.warn('Redis: Max reconnection attempts reached');
            return new Error('Max reconnection attempts reached');
          }
          return retries * 100;
        },
      },
    });

    redisClient.on('error', (err) => {
      logger.warn(`Redis error: ${err.message}`);
      isConnected = false;
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected');
      isConnected = true;
    });

    redisClient.on('disconnect', () => {
      logger.warn('Redis disconnected');
      isConnected = false;
    });

    await redisClient.connect();
    isConnected = true;
    logger.info('Redis client initialized');
  } catch (err) {
    logger.error(`Failed to initialize Redis: ${err.message}`);
    // Don't throw - allow app to run without Redis (graceful degradation)
    isConnected = false;
  }
};

/**
 * Get Redis client instance
 * @returns {Object} Redis client or null if not connected
 */
const getRedisClient = () => {
  if (!isConnected) {
    return null;
  }
  return redisClient;
};

/**
 * Close Redis connection
 * @returns {Promise<void>}
 */
const closeRedis = async () => {
  if (redisClient) {
    try {
      await redisClient.quit();
      redisClient = null;
      isConnected = false;
      logger.info('Redis connection closed');
    } catch (err) {
      logger.error(`Error closing Redis: ${err.message}`);
    }
  }
};

/**
 * Check if Redis is connected
 * @returns {Boolean}
 */
const isRedisConnected = () => isConnected;

module.exports = {
  initializeRedis,
  getRedisClient,
  closeRedis,
  isRedisConnected,
};

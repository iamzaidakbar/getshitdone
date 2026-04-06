/**
 * Bull Queue Configuration
 * Initializes 4 independent queues for different job types
 */

const Queue = require('bull');
const config = require('../config');
const logger = require('../utils/logger');

// Extract Redis URL components for Bull config
const redisConfig = {
  redis: config.redis.url,
};

/**
 * Email Queue
 * Time-sensitive: order confirmations, shipping updates, password resets
 */
const emailQueue = new Queue('email', redisConfig);

emailQueue.on('error', (err) => {
  logger.error(`Email queue error: ${err.message}`);
});

emailQueue.on('failed', (job, err) => {
  logger.warn(`Email job ${job.id} failed: ${err.message}`);
});

emailQueue.on('completed', (job) => {
  logger.debug(`Email job ${job.id} completed`);
});

/**
 * Inventory Queue
 * Priority: Low-stock alerts, restock notifications
 */
const inventoryQueue = new Queue('inventory', redisConfig);

inventoryQueue.on('error', (err) => {
  logger.error(`Inventory queue error: ${err.message}`);
});

inventoryQueue.on('failed', (job, err) => {
  logger.warn(`Inventory job ${job.id} failed: ${err.message}`);
});

inventoryQueue.on('completed', (job) => {
  logger.debug(`Inventory job ${job.id} completed`);
});

/**
 * Images Queue
 * Resource-intensive: Image processing, resizing, S3 uploads
 */
const imagesQueue = new Queue('images', redisConfig);

imagesQueue.on('error', (err) => {
  logger.error(`Images queue error: ${err.message}`);
});

imagesQueue.on('failed', (job, err) => {
  logger.warn(`Images job ${job.id} failed: ${err.message}`);
});

imagesQueue.on('completed', (job) => {
  logger.debug(`Images job ${job.id} completed`);
});

/**
 * Analytics Queue
 * Batch processing: View/purchase event logging
 */
const analyticsQueue = new Queue('analytics', redisConfig);

analyticsQueue.on('error', (err) => {
  logger.error(`Analytics queue error: ${err.message}`);
});

analyticsQueue.on('failed', (job, err) => {
  logger.warn(`Analytics job ${job.id} failed: ${err.message}`);
});

analyticsQueue.on('completed', (job) => {
  logger.debug(`Analytics job ${job.id} completed`);
});

/**
 * Set default job options per queue
 */

// Email: Fast processing, 3 retries
emailQueue.setDefaultJobOptions({
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  timeout: 30000, // 30 seconds
  removeOnComplete: true,
});

// Inventory: Reliable delivery, 5 retries
inventoryQueue.setDefaultJobOptions({
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  timeout: 20000, // 20 seconds
  removeOnComplete: true,
});

// Images: Resource-heavy, moderate retries
imagesQueue.setDefaultJobOptions({
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  timeout: 60000, // 60 seconds
  removeOnComplete: true,
});

// Analytics: Batch processing, reliable
analyticsQueue.setDefaultJobOptions({
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  timeout: 120000, // 120 seconds
  removeOnComplete: false, // Keep for audit trail
});

logger.info('All Bull queues initialized');

module.exports = {
  emailQueue,
  inventoryQueue,
  imagesQueue,
  analyticsQueue,
};

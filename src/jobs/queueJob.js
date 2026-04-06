/**
 * Queue Job Utilities
 * Provides functions to enqueue jobs to appropriate queues
 * Handles graceful error cases (don't crash request if queuing fails)
 */

const {
  emailQueue,
  inventoryQueue,
  imagesQueue,
  analyticsQueue,
} = require('./queues');
const logger = require('../utils/logger');

/**
 * Enqueue email job
 * @param {Object} jobData - Job data
 *   - jobType: 'order-confirmation' | 'shipping-update' | 'password-reset'
 *   - email: recipient email
 *   - userId: user ID
 *   - templateData: variables for email template
 * @returns {Promise<Object|null>} Job object or null if queue unavailable
 */
const enqueueEmail = async (jobData) => {
  try {
    const job = await emailQueue.add(jobData, {
      priority: 10, // Higher priority
    });
    logger.debug(`Email job enqueued: ${job.id}`);
    return job;
  } catch (error) {
    logger.warn(`Failed to enqueue email job: ${error.message}`);
    // Return null but don't throw - request shouldn't fail
    return null;
  }
};

/**
 * Enqueue inventory alert job
 * @param {Object} jobData - Job data
 *   - jobType: 'low-stock-alert' | 'restock-notification' | 'stock-update'
 *   - productId: product ID
 *   - currentStock: current inventory level
 *   - threshold: warning threshold
 * @returns {Promise<Object|null>} Job object or null if queue unavailable
 */
const enqueueInventoryAlert = async (jobData) => {
  try {
    const job = await inventoryQueue.add(jobData, {
      priority: 8,
    });
    logger.debug(`Inventory job enqueued: ${job.id}`);
    return job;
  } catch (error) {
    logger.warn(`Failed to enqueue inventory job: ${error.message}`);
    return null;
  }
};

/**
 * Enqueue image processing job
 * @param {Object} jobData - Job data
 *   - uploadId: unique upload identifier
 *   - sourceUrl: URL or path to source image
 *   - productId: product ID
 *   - operations: array of resize operations
 * @returns {Promise<Object|null>} Job object or null if queue unavailable
 */
const enqueueImage = async (jobData) => {
  try {
    const job = await imagesQueue.add(jobData, {
      priority: 5,
    });
    logger.debug(`Image job enqueued: ${job.id}`);
    return job;
  } catch (error) {
    logger.warn(`Failed to enqueue image job: ${error.message}`);
    return null;
  }
};

/**
 * Enqueue analytics event
 * @param {Object} jobData - Job data
 *   - events: array of event objects
 *   - sessionId: session identifier
 *   - userId: user ID (optional)
 * @returns {Promise<Object|null>} Job object or null if queue unavailable
 */
const enqueueAnalytics = async (jobData) => {
  try {
    const job = await analyticsQueue.add(jobData, {
      priority: 1, // Lower priority
    });
    logger.debug(`Analytics job enqueued: ${job.id}`);
    return job;
  } catch (error) {
    logger.warn(`Failed to enqueue analytics job: ${error.message}`);
    return null;
  }
};

module.exports = {
  enqueueEmail,
  enqueueInventoryAlert,
  enqueueImage,
  enqueueAnalytics,
};

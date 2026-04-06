/**
 * Inventory Job Processor
 * Handles: low-stock-alert, restock-notification, stock-update
 * Checks inventory, sends notifications, logs to database
 */

const { enqueueEmail } = require('../queueJob');
const config = require('../../config');
const logger = require('../../utils/logger');

/**
 * Low stock threshold (units)
 */
const LOW_STOCK_THRESHOLD = 10;

/**
 * Process inventory job
 * @param {Object} job - Bull job object
 * @returns {Object} Result data
 */
const processorHandler = async (job) => {
  try {
    const { jobType, productId, currentStock, threshold, adminEmail } = job.data;

    logger.info(`Processing inventory job [${job.id}]: ${jobType} for product ${productId}`);

    let result = {
      jobType,
      productId,
      processedAt: new Date().toISOString(),
    };

    // Handle different inventory job types
    switch (jobType) {
      case 'low-stock-alert':
        {
          // Alert admin when stock falls below threshold
          if (currentStock <= threshold) {
            const adminEmails = adminEmail || process.env.ADMIN_EMAIL || 'admin@getshitdone.com';

            // Queue email notification to admin
            await enqueueEmail({
              jobType: 'low-stock-notification',
              email: adminEmails,
              templateData: {
                productId,
                currentStock,
                threshold,
                alertType: 'admin',
              },
            });

            result.alerted = true;
            result.type = 'low-stock-alert';
            logger.info(`Low stock alert queued for product ${productId}: ${currentStock}/${threshold}`);
          } else {
            result.alerted = false;
            logger.debug(`Stock above threshold for product ${productId}: ${currentStock}/${threshold}`);
          }
        }
        break;

      case 'restock-notification':
        {
          // Notify users on waitlist that item is back in stock
          // This would typically query a waitlist/notification preference
          result.type = 'restock-notification';
          result.notificationsSent = 0;
          logger.info(`Restock notification processed for product ${productId}`);
          // TODO: Query user waitlist and send emails
        }
        break;

      case 'stock-update':
        {
          // Log stock update event for analytics/audit trail
          result.type = 'stock-update';
          result.stockLevel = currentStock;
          logger.info(`Stock update logged for product ${productId}: ${currentStock} units`);
          // TODO: Log to InventoryEvent collection in MongoDB
        }
        break;

      default:
        throw new Error(`Unknown inventory job type: ${jobType}`);
    }

    return result;
  } catch (error) {
    logger.error(`Inventory processor error [${job.id}]: ${error.message}`);
    throw error; // Bull will handle retry
  }
};

module.exports = processorHandler;

/**
 * Queues Admin Routes
 * Exposes Bull Board UI for queue monitoring and management
 * Admin-only access required
 */

const express = require('express');
const { createBullBoard } = require('bull-board');
const { BullAdapter } = require('bull-board/bullAdapter');
const { requireAuth, requireRole } = require('../../middlewares/auth');
const {
  emailQueue,
  inventoryQueue,
  imagesQueue,
  analyticsQueue,
} = require('../../jobs/queues');
const logger = require('../../utils/logger');

const router = express.Router();

/**
 * Create Bull Board instance with all queue adapters
 * @type {BullBoard}
 */
let bullBoard = null;

/**
 * Initialize Bull Board (lazy initialization)
 * Called on first request to the queue admin routes
 */
const initializeBullBoard = () => {
  if (!bullBoard) {
    try {
      const queues = [
        new BullAdapter(emailQueue, { readOnlyMode: false }),
        new BullAdapter(inventoryQueue, { readOnlyMode: false }),
        new BullAdapter(imagesQueue, { readOnlyMode: false }),
        new BullAdapter(analyticsQueue, { readOnlyMode: false }),
      ];

      bullBoard = createBullBoard({
        queues,
        serverAdapter: {
          basePath: '/api/admin/queues',
          disableCsrfProtection: false,
        },
      });

      logger.info('Bull Board initialized with 4 queue adapters');
    } catch (error) {
      logger.error('Failed to initialize Bull Board', { error: error.message });
      throw error;
    }
  }

  return bullBoard;
};

/**
 * Admin-only middleware for queue routes
 * Ensures user is authenticated and has admin role
 */
const adminQueueAuth = (req, res, next) => {
  requireAuth(req, res, () => {
    requireRole('admin')(req, res, next);
  });
};

/**
 * GET /api/admin/queues — Bull Board UI
 * Requires authentication + admin role
 * @description Displays real-time queue status, job progress, failed jobs, etc.
 */
router.get('/', adminQueueAuth, (req, res) => {
  try {
    const board = initializeBullBoard();

    // Render Bull Board UI
    const html = board.serverAdapter.getUIPath();

    res.status(200).json({
      success: true,
      message: 'Bull Board UI available',
      path: '/api/admin/queues',
      queues: ['email', 'inventory', 'images', 'analytics'],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error accessing Bull Board', {
      error: error.message,
      userId: req.user?.id,
    });
    res.status(500).json({
      success: false,
      message: 'Failed to load Bull Board',
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/queues/stats — Queue Statistics
 * Returns aggregate stats for all queues
 * Requires authentication + admin role
 */
router.get('/stats', adminQueueAuth, async (req, res) => {
  try {
    const queues = [emailQueue, inventoryQueue, imagesQueue, analyticsQueue];
    const stats = {};

    for (const queue of queues) {
      const counts = await queue.getJobCounts();
      stats[queue.name] = {
        active: counts.active,
        waiting: counts.waiting,
        delayed: counts.delayed,
        failed: counts.failed,
        completed: counts.completed,
        paused: counts.paused,
      };
    }

    res.status(200).json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error fetching queue stats', {
      error: error.message,
      userId: req.user?.id,
    });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch queue statistics',
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/queues/:queueName/jobs — Get Jobs from Specific Queue
 * Returns paginated list of jobs from a specific queue
 * Requires authentication + admin role
 * @param {string} queueName - Name of queue (email|inventory|images|analytics)
 * @query {number} status - Filter by status (active|waiting|failed|completed)
 * @query {number} limit - Number of jobs to return (default: 10)
 * @query {number} start - Pagination start index (default: 0)
 */
router.get('/:queueName/jobs', adminQueueAuth, async (req, res) => {
  try {
    const queueMap = {
      email: emailQueue,
      inventory: inventoryQueue,
      images: imagesQueue,
      analytics: analyticsQueue,
    };

    const queue = queueMap[req.params.queueName];
    if (!queue) {
      return res.status(404).json({
        success: false,
        message: `Queue '${req.params.queueName}' not found`,
        availableQueues: Object.keys(queueMap),
      });
    }

    const { status = 'waiting', limit = 10, start = 0 } = req.query;
    const validStatuses = ['active', 'waiting', 'failed', 'completed', 'delayed', 'paused'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status '${status}'`,
        validStatuses,
      });
    }

    const jobs = await queue.getJobs([status], start, start + parseInt(limit) - 1);

    res.status(200).json({
      success: true,
      data: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        status: job.getState(),
        data: job.data,
        progress: job.progress(),
        attempts: job.attempts,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
        createdAt: job.createdAt(),
        finishedOn: job.finishedOn,
      })),
      total: jobs.length,
      pagination: { start, limit, status },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error fetching queue jobs', {
      queueName: req.params.queueName,
      error: error.message,
      userId: req.user?.id,
    });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch queue jobs',
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/queues/:queueName/jobs/:jobId/retry — Retry Failed Job
 * Re-enqueue a failed job to be retried
 * Requires authentication + admin role
 */
router.post('/:queueName/jobs/:jobId/retry', adminQueueAuth, async (req, res) => {
  try {
    const queueMap = {
      email: emailQueue,
      inventory: inventoryQueue,
      images: imagesQueue,
      analytics: analyticsQueue,
    };

    const queue = queueMap[req.params.queueName];
    if (!queue) {
      return res.status(404).json({
        success: false,
        message: `Queue '${req.params.queueName}' not found`,
      });
    }

    const job = await queue.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: `Job '${req.params.jobId}' not found in queue '${req.params.queueName}'`,
      });
    }

    await job.retry();

    logger.info('Job retry initiated', {
      queueName: req.params.queueName,
      jobId: req.params.jobId,
      userId: req.user?.id,
    });

    res.status(200).json({
      success: true,
      message: `Job ${req.params.jobId} queued for retry`,
      data: { jobId: job.id, status: await job.getState() },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error retrying job', {
      queueName: req.params.queueName,
      jobId: req.params.jobId,
      error: error.message,
      userId: req.user?.id,
    });
    res.status(500).json({
      success: false,
      message: 'Failed to retry job',
      error: error.message,
    });
  }
});

/**
 * DELETE /api/admin/queues/:queueName/jobs/:jobId — Delete Job
 * Remove a job from the queue
 * Requires authentication + admin role
 */
router.delete('/:queueName/jobs/:jobId', adminQueueAuth, async (req, res) => {
  try {
    const queueMap = {
      email: emailQueue,
      inventory: inventoryQueue,
      images: imagesQueue,
      analytics: analyticsQueue,
    };

    const queue = queueMap[req.params.queueName];
    if (!queue) {
      return res.status(404).json({
        success: false,
        message: `Queue '${req.params.queueName}' not found`,
      });
    }

    const job = await queue.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: `Job '${req.params.jobId}' not found`,
      });
    }

    await job.remove();

    logger.info('Job deleted', {
      queueName: req.params.queueName,
      jobId: req.params.jobId,
      userId: req.user?.id,
    });

    res.status(200).json({
      success: true,
      message: `Job ${req.params.jobId} deleted`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error deleting job', {
      queueName: req.params.queueName,
      jobId: req.params.jobId,
      error: error.message,
      userId: req.user?.id,
    });
    res.status(500).json({
      success: false,
      message: 'Failed to delete job',
      error: error.message,
    });
  }
});

module.exports = router;

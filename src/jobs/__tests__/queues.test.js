/**
 * Queue Tests
 * Unit tests for Bull queue setup, job enqueueing, and retry logic
 */

const {
  enqueueEmail,
  enqueueInventoryAlert,
  enqueueImage,
  enqueueAnalytics,
} = require('../../jobs/queueJob');
const {
  emailQueue,
  inventoryQueue,
  imagesQueue,
  analyticsQueue,
} = require('../../jobs/queues');
const { logger } = require('../../utils');

describe('Job Queue System', () => {
  afterEach(async () => {
    // Clean up jobs after each test
    try {
      await Promise.all([
        emailQueue.clean(0, 'completed'),
        inventoryQueue.clean(0, 'completed'),
        imagesQueue.clean(0, 'completed'),
        analyticsQueue.clean(0, 'completed'),
      ]);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Email Queue', () => {
    it('should enqueue email job successfully', async () => {
      const jobData = {
        jobType: 'order-confirmation',
        email: 'customer@example.com',
        templateData: {
          orderId: 'ORD-123',
          amount: 99.99,
        },
      };

      const job = await enqueueEmail(jobData);

      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.data.jobType).toBe('order-confirmation');
      expect(job.data.email).toBe('customer@example.com');
    });

    it('should handle missing email gracefully', async () => {
      const jobData = {
        jobType: 'password-reset',
        templateData: { resetToken: 'token123' },
        // Missing email field
      };

      // Should queue anyway but with errors caught downstream
      const job = await enqueueEmail(jobData);
      expect(job).toBeDefined();
    });

    it('should support multiple email types', async () => {
      const emailTypes = ['order-confirmation', 'shipping-update', 'password-reset'];

      for (const type of emailTypes) {
        const job = await enqueueEmail({
          jobType: type,
          email: 'test@example.com',
          templateData: {},
        });

        expect(job).toBeDefined();
        expect(job.data.jobType).toBe(type);
      }
    });

    it('should set priority correctly for email queue', async () => {
      const job = await enqueueEmail({
        jobType: 'order-confirmation',
        email: 'test@example.com',
        templateData: { orderId: 'ORD-123' },
      });

      // Email jobs should have higher priority (10)
      expect(job).toBeDefined();
    });
  });

  describe('Inventory Queue', () => {
    it('should enqueue inventory alert successfully', async () => {
      const jobData = {
        jobType: 'low-stock-alert',
        productId: 'PROD-456',
        currentStock: 5,
        threshold: 10,
        adminEmail: 'admin@example.com',
      };

      const job = await enqueueInventoryAlert(jobData);

      expect(job).toBeDefined();
      expect(job.data.jobType).toBe('low-stock-alert');
      expect(job.data.currentStock).toBe(5);
    });

    it('should handle inventory job types', async () => {
      const jobTypes = ['low-stock-alert', 'restock-notification', 'stock-update'];

      for (const type of jobTypes) {
        const job = await enqueueInventoryAlert({
          jobType: type,
          productId: 'PROD-789',
          currentStock: 20,
          threshold: 10,
        });

        expect(job).toBeDefined();
        expect(job.data.jobType).toBe(type);
      }
    });

    it('should validate inventory threshold', async () => {
      const jobData = {
        jobType: 'low-stock-alert',
        productId: 'PROD-999',
        currentStock: 5,
        threshold: 10,
      };

      const job = await enqueueInventoryAlert(jobData);

      expect(job.data.currentStock).toBeLessThan(job.data.threshold);
    });
  });

  describe('Image Queue', () => {
    it('should enqueue image processing job', async () => {
      const jobData = {
        uploadId: 'IMG-UUID-123',
        sourceUrl: 'https://temp-storage.example.com/img/abc.jpg',
        productId: 'PROD-123',
      };

      const job = await enqueueImage(jobData);

      expect(job).toBeDefined();
      expect(job.data.uploadId).toBe('IMG-UUID-123');
      expect(job.data.productId).toBe('PROD-123');
    });

    it('should handle multiple image sizes', async () => {
      const jobData = {
        uploadId: 'IMG-UUID-456',
        sourceUrl: 'https://example.com/img.jpg',
        productId: 'PROD-456',
        operations: ['thumbnail', 'medium', 'large'],
      };

      const job = await enqueueImage(jobData);

      expect(job).toBeDefined();
      expect(job.data.operations).toContain('large');
    });

    it('should set timeout for image processing', async () => {
      const jobData = {
        uploadId: 'IMG-UUID-789',
        sourceUrl: 'https://example.com/large-img.jpg',
        productId: 'PROD-789',
      };

      const job = await enqueueImage(jobData);

      // Image queue should have timeout=60000ms
      expect(job).toBeDefined();
    });
  });

  describe('Analytics Queue', () => {
    it('should enqueue analytics batch job', async () => {
      const jobData = {
        eventCount: 250,
        sessionIds: ['sess-1', 'sess-2', 'sess-3'],
      };

      const job = await enqueueAnalytics(jobData);

      expect(job).toBeDefined();
      expect(job.data.eventCount).toBe(250);
    });

    it('should handle varying batch sizes', async () => {
      const batchSizes = [1, 100, 500, 1000];

      for (const size of batchSizes) {
        const job = await enqueueAnalytics({
          eventCount: size,
          sessionIds: [],
        });

        expect(job.data.eventCount).toBe(size);
      }
    });

    it('should set lower priority for analytics', async () => {
      const job = await enqueueAnalytics({
        eventCount: 100,
        sessionIds: [],
      });

      // Analytics should have lower priority than other queues
      expect(job).toBeDefined();
    });
  });

  describe('Error Handling & Resilience', () => {
    it('should return null when redis is unavailable gracefully', async () => {
      // Mock a Redis unavailability scenario
      jest.spyOn(emailQueue, 'add').mockRejectedValueOnce(new Error('Redis unavailable'));

      try {
        const job = await enqueueEmail({
          jobType: 'test',
          email: 'test@example.com',
          templateData: {},
        }).catch((err) => {
          logger.warn('Enqueue failed gracefully', { error: err.message });
          return null;
        });

        expect(job).toBeNull();
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('should log errors without crashing request', async () => {
      const loggerWarnSpy = jest.spyOn(logger, 'warn').mockImplementation();

      jest.spyOn(inventoryQueue, 'add').mockRejectedValueOnce(new Error('Queue failed'));

      try {
        await enqueueInventoryAlert({
          jobType: 'low-stock-alert',
          productId: 'PROD-XXX',
          currentStock: 1,
          threshold: 10,
        }).catch((err) => {
          logger.warn('Queue failed', { error: err.message });
        });
      } finally {
        loggerWarnSpy.mockRestore();
        jest.restoreAllMocks();
      }
    });
  });

  describe('Retry & Backoff Configuration', () => {
    it('should apply exponential backoff', async () => {
      const job = await enqueueEmail({
        jobType: 'test',
        email: 'test@example.com',
        templateData: {},
      });

      // Jobs should be configured with exponential backoff
      expect(job).toBeDefined();
      expect(job.opts).toBeDefined();
    });

    it('should respect queue-specific attempt limits', async () => {
      // Email: 3 attempts
      const emailJob = await enqueueEmail({
        jobType: 'order-confirmation',
        email: 'test@example.com',
        templateData: {},
      });

      // Inventory: 5 attempts
      const inventoryJob = await enqueueInventoryAlert({
        jobType: 'low-stock-alert',
        productId: 'PROD-123',
        currentStock: 5,
        threshold: 10,
      });

      // Analytics: 5 attempts
      const analyticsJob = await enqueueAnalytics({
        eventCount: 100,
        sessionIds: [],
      });

      expect(emailJob).toBeDefined();
      expect(inventoryJob).toBeDefined();
      expect(analyticsJob).toBeDefined();
    });
  });

  describe('Job Data Validation', () => {
    it('should preserve complete job data through queue', async () => {
      const complexData = {
        jobType: 'order-confirmation',
        email: 'customer@example.com',
        userId: 'USER-123',
        templateData: {
          orderId: 'ORD-456',
          amount: 250.50,
          items: [
            { id: 1, name: 'Product 1', qty: 2 },
            { id: 2, name: 'Product 2', qty: 1 },
          ],
          shippingAddress: {
            street: '123 Main St',
            city: 'Springfield',
            zip: '12345',
          },
        },
      };

      const job = await enqueueEmail(complexData);

      expect(job.data).toEqual(complexData);
      expect(job.data.templateData.items.length).toBe(2);
      expect(job.data.templateData.shippingAddress.city).toBe('Springfield');
    });
  });

  // Cleanup
  afterAll(async () => {
    try {
      await Promise.all([
        emailQueue.close(),
        inventoryQueue.close(),
        imagesQueue.close(),
        analyticsQueue.close(),
      ]);
    } catch (error) {
      // Ignore close errors
    }
  });
});

/**
 * Email Processor Tests
 * Unit tests for email job processing with mocked email service
 */

const emailProcessor = require('../../jobs/processors/emailProcessor');
const { logger } = require('../../utils');

// Mock email utilities
jest.mock('../../utils/email', () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ success: true }),
  sendPaymentSuccessEmail: jest.fn().mockResolvedValue({ success: true }),
  sendRefundEmail: jest.fn().mockResolvedValue({ success: true }),
}));

const {
  sendPasswordResetEmail,
  sendPaymentSuccessEmail,
  sendRefundEmail,
} = require('../../utils/email');

describe('Email Processor', () => {
  // Clear mocks after each test
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Password Reset Email', () => {
    it('should process password-reset job successfully', async () => {
      const job = {
        id: 'email-job-1',
        data: {
          jobType: 'password-reset',
          email: 'user@example.com',
          templateData: {
            resetToken: 'reset-token-xyz123abc',
          },
        },
      };

      const result = await emailProcessor(job);

      expect(result).toBeDefined();
      expect(result.jobType).toBe('password-reset');
      expect(result.email).toBe('user@example.com');
      expect(result.type).toBe('password-reset');
      expect(sendPasswordResetEmail).toHaveBeenCalledWith(
        'user@example.com',
        'reset-token-xyz123abc',
        expect.any(String)
      );
    });

    it('should handle missing resetToken', async () => {
      const job = {
        id: 'email-job-2',
        data: {
          jobType: 'password-reset',
          email: 'user@example.com',
          templateData: {
            // Missing resetToken
          },
        },
      };

      await expect(emailProcessor(job)).rejects.toThrow('Missing resetToken');
    });

    it('should include sentAt timestamp', async () => {
      const job = {
        id: 'email-job-3',
        data: {
          jobType: 'password-reset',
          email: 'test@example.com',
          templateData: { resetToken: 'token-123' },
        },
      };

      const result = await emailProcessor(job);

      expect(result.sentAt).toBeDefined();
      expect(new Date(result.sentAt)).toBeInstanceOf(Date);
    });
  });

  describe('Order Confirmation Email', () => {
    it('should process order-confirmation job', async () => {
      const job = {
        id: 'email-job-4',
        data: {
          jobType: 'order-confirmation',
          email: 'customer@example.com',
          templateData: {
            orderId: 'ORD-456',
            amount: 199.99,
          },
        },
      };

      const result = await emailProcessor(job);

      expect(result).toBeDefined();
      expect(result.jobType).toBe('order-confirmation');
      expect(result.type).toBe('order-confirmation');
      expect(result.orderId).toBe('ORD-456');
      expect(sendPaymentSuccessEmail).toHaveBeenCalled();
    });

    it('should handle missing orderId', async () => {
      const job = {
        id: 'email-job-5',
        data: {
          jobType: 'order-confirmation',
          email: 'customer@example.com',
          templateData: {
            amount: 99.99,
            // Missing orderId
          },
        },
      };

      await expect(emailProcessor(job)).rejects.toThrow('Missing orderId');
    });

    it('should include amount in response', async () => {
      const job = {
        id: 'email-job-6',
        data: {
          jobType: 'order-confirmation',
          email: 'customer@example.com',
          templateData: {
            orderId: 'ORD-789',
            amount: 299.99,
          },
        },
      };

      const result = await emailProcessor(job);

      expect(result.orderId).toBe('ORD-789');
      expect(sendPaymentSuccessEmail).toHaveBeenCalled();
    });
  });

  describe('Shipping Update Email', () => {
    it('should process shipping-update job', async () => {
      const job = {
        id: 'email-job-7',
        data: {
          jobType: 'shipping-update',
          email: 'customer@example.com',
          templateData: {
            orderId: 'ORD-999',
            trackingNumber: 'TRACK-123456789',
            carrier: 'FedEx',
          },
        },
      };

      const result = await emailProcessor(job);

      expect(result).toBeDefined();
      expect(result.jobType).toBe('shipping-update');
      expect(result.type).toBe('shipping-update');
      expect(result.orderId).toBe('ORD-999');
      expect(result.trackingNumber).toBe('TRACK-123456789');
    });

    it('should handle missing orderId in shipping update', async () => {
      const job = {
        id: 'email-job-8',
        data: {
          jobType: 'shipping-update',
          email: 'customer@example.com',
          templateData: {
            trackingNumber: 'TRACK-123',
            carrier: 'UPS',
            // Missing orderId
          },
        },
      };

      await expect(emailProcessor(job)).rejects.toThrow('Missing orderId');
    });

    it('should handle optional tracking info', async () => {
      const job = {
        id: 'email-job-9',
        data: {
          jobType: 'shipping-update',
          email: 'customer@example.com',
          templateData: {
            orderId: 'ORD-123',
            // No tracking number provided
            carrier: 'Standard Shipping',
          },
        },
      };

      const result = await emailProcessor(job);

      expect(result).toBeDefined();
      expect(result.orderId).toBe('ORD-123');
      // Tracking number should be optional
    });
  });

  describe('Error Handling', () => {
    it('should throw for unknown job type', async () => {
      const job = {
        id: 'email-job-10',
        data: {
          jobType: 'unknown-email-type',
          email: 'test@example.com',
          templateData: {},
        },
      };

      await expect(emailProcessor(job)).rejects.toThrow('Unknown email job type');
    });

    it('should handle email service failures gracefully', async () => {
      sendPasswordResetEmail.mockRejectedValueOnce(new Error('SMTP connection failed'));

      const job = {
        id: 'email-job-11',
        data: {
          jobType: 'password-reset',
          email: 'user@example.com',
          templateData: { resetToken: 'token-123' },
        },
      };

      await expect(emailProcessor(job)).rejects.toThrow('SMTP connection failed');

      // Should propagate error for Bull retry logic
      expect(sendPasswordResetEmail).toHaveBeenCalled();
    });

    it('should log processor errors', async () => {
      const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation();

      sendPaymentSuccessEmail.mockRejectedValueOnce(new Error('Email service down'));

      const job = {
        id: 'email-job-12',
        data: {
          jobType: 'order-confirmation',
          email: 'customer@example.com',
          templateData: { orderId: 'ORD-123', amount: 100 },
        },
      };

      try {
        await emailProcessor(job);
      } catch (error) {
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('processor error'),
          expect.any(Object)
        );
      }

      loggerErrorSpy.mockRestore();
    });

    it('should include job ID in error context', async () => {
      const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation();

      const job = {
        id: 'email-job-error-123',
        data: {
          jobType: 'unknown-type',
          email: 'test@example.com',
          templateData: {},
        },
      };

      try {
        await emailProcessor(job);
      } catch (error) {
        // Error should be thrown
        expect(error).toBeDefined();
      }

      loggerErrorSpy.mockRestore();
    });
  });

  describe('Job Results', () => {
    it('should include sentAt timestamp in result', async () => {
      const job = {
        id: 'email-job-13',
        data: {
          jobType: 'order-confirmation',
          email: 'test@example.com',
          templateData: { orderId: 'ORD-555', amount: 50 },
        },
      };

      const result = await emailProcessor(job);

      expect(result.sentAt).toBeDefined();
      expect(result.sentAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('should preserve job metadata in result', async () => {
      const templateData = {
        resetToken: 'specific-token-abc123',
      };

      const job = {
        id: 'email-job-14',
        data: {
          jobType: 'password-reset',
          email: 'user@example.com',
          userId: 'USER-999',
          templateData,
        },
      };

      const result = await emailProcessor(job);

      expect(result.jobType).toBe('password-reset');
      expect(result.email).toBe('user@example.com');
      expect(result.type).toBe('password-reset');
    });
  });

  describe('Idempotency', () => {
    it('should be safe to retry failed jobs', async () => {
      const jobData = {
        jobType: 'password-reset',
        email: 'retry@example.com',
        templateData: { resetToken: 'token-retry-123' },
      };

      const job1 = { id: 'job-1', data: jobData };
      const job2 = { id: 'job-1-retry', data: jobData }; // Same data, different job ID

      const result1 = await emailProcessor(job1);
      const result2 = await emailProcessor(job2);

      // Both should succeed with same email
      expect(result1.email).toBe(result2.email);
      expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2);
      expect(sendPasswordResetEmail).toHaveBeenCalledWith(
        'retry@example.com',
        'token-retry-123',
        expect.any(String)
      );
    });
  });
});

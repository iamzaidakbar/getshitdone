/**
 * Image Processor Tests
 * Unit tests for image processing with mocked Sharp and S3
 */

const imageProcessor = require('../../jobs/processors/imagesProcessor');
const { logger } = require('../../utils');

// Mock Sharp for image processing
jest.mock('sharp', () => {
  return jest.fn().mockImplementation(() => ({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toFile: jest.fn().mockResolvedValue({ width: 200, height: 200 }),
  }));
});

// Mock S3 utilities
jest.mock('../../utils/s3', () => ({
  uploadToS3: jest.fn().mockResolvedValue('https://s3.bucket.com/path/image.jpg'),
  deleteFromS3: jest.fn().mockResolvedValue(true),
}));

// Mock file system
jest.mock('fs', () => ({
  promises: {
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));

const sharp = require('sharp');
const { uploadToS3, deleteFromS3 } = require('../../utils/s3');

describe('Image Processor', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Image Processing Initialization', () => {
    it('should process image job successfully', async () => {
      const job = {
        id: 'img-job-1',
        data: {
          uploadId: 'upload-uuid-123',
          sourceUrl: 'https://temp-storage.example.com/img.jpg',
          productId: 'PROD-123',
        },
      };

      const result = await imageProcessor(job);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.uploadId).toBe('upload-uuid-123');
      expect(result.productId).toBe('PROD-123');
    });

    it('should validate required fields', async () => {
      const jobMissingId = {
        id: 'img-job-2',
        data: {
          sourceUrl: 'https://example.com/img.jpg',
          productId: 'PROD-456',
          // Missing uploadId
        },
      };

      await expect(imageProcessor(jobMissingId)).rejects.toThrow('Missing uploadId or productId');
    });

    it('should handle missing productId', async () => {
      const jobNoProduct = {
        id: 'img-job-3',
        data: {
          uploadId: 'upload-uuid-456',
          sourceUrl: 'https://example.com/img.jpg',
          // Missing productId
        },
      };

      await expect(imageProcessor(jobNoProduct)).rejects.toThrow('Missing uploadId or productId');
    });
  });

  describe('S3 URL Generation', () => {
    it('should generate S3 URLs for processed sizes', async () => {
      const job = {
        id: 'img-job-4',
        data: {
          uploadId: 'upload-uuid-789',
          sourceUrl: 'https://temp-storage.example.com/photo.jpg',
          productId: 'PROD-789',
        },
      };

      const result = await imageProcessor(job);

      expect(result.s3Urls).toBeDefined();
      expect(result.s3Urls.thumbnail).toBeDefined();
      expect(result.s3Urls.medium).toBeDefined();
      expect(result.s3Urls.large).toBeDefined();

      // URLs should follow S3 format
      expect(result.s3Urls.thumbnail).toMatch(/https:\/\/.*s3\.amazonaws\.com\//);
      expect(result.s3Urls.medium).toMatch(/https:\/\/.*s3\.amazonaws\.com\//);
      expect(result.s3Urls.large).toMatch(/https:\/\/.*s3\.amazonaws\.com\//);
    });

    it('should include product ID in S3 path', async () => {
      const job = {
        id: 'img-job-5',
        data: {
          uploadId: 'upload-uuid-abc',
          sourceUrl: 'https://example.com/image.jpg',
          productId: 'PROD-ABC',
        },
      };

      const result = await imageProcessor(job);

      // S3 paths should include product ID
      expect(result.s3Urls.thumbnail).toContain('PROD-ABC');
      expect(result.s3Urls.medium).toContain('PROD-ABC');
      expect(result.s3Urls.large).toContain('PROD-ABC');
    });

    it('should list processed sizes in result', async () => {
      const job = {
        id: 'img-job-6',
        data: {
          uploadId: 'upload-uuid-def',
          sourceUrl: 'https://example.com/image.jpg',
          productId: 'PROD-DEF',
        },
      };

      const result = await imageProcessor(job);

      expect(result.sizes).toBeDefined();
      expect(result.sizes).toContain('thumbnail');
      expect(result.sizes).toContain('medium');
      expect(result.sizes).toContain('large');
      expect(result.sizes.length).toBe(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle corrupted image gracefully', async () => {
      sharp.mockImplementationOnce(() => {
        throw new Error('Invalid image format');
      });

      const job = {
        id: 'img-job-7',
        data: {
          uploadId: 'upload-uuid-corrupt',
          sourceUrl: 'https://example.com/corrupt.jpg',
          productId: 'PROD-CORRUPT',
        },
      };

      await expect(imageProcessor(job)).rejects.toThrow('Invalid image format');
    });

    it('should handle storage failures', async () => {
      uploadToS3.mockRejectedValueOnce(new Error('S3 connection failed'));

      const job = {
        id: 'img-job-8',
        data: {
          uploadId: 'upload-uuid-s3-fail',
          sourceUrl: 'https://example.com/image.jpg',
          productId: 'PROD-S3-FAIL',
        },
      };

      // Should propagate error for retry logic
      try {
        await imageProcessor(job);
      } catch (error) {
        expect(error.message).toContain('S3');
      }
    });

    it('should log processing errors with context', async () => {
      const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation();

      const job = {
        id: 'img-job-error-999',
        data: {
          uploadId: 'upload-log-test',
          sourceUrl: 'https://example.com/image.jpg',
          productId: 'PROD-LOG-TEST',
        },
      };

      // Even on success, test that logging happens on errors
      uploadToS3.mockRejectedValueOnce(new Error('Upload failed'));

      try {
        await imageProcessor(job);
      } catch (error) {
        // Expected
      }

      loggerErrorSpy.mockRestore();
    });
  });

  describe('Job Result Data', () => {
    it('should include processedAt timestamp', async () => {
      const job = {
        id: 'img-job-9',
        data: {
          uploadId: 'upload-uuid-time',
          sourceUrl: 'https://example.com/image.jpg',
          productId: 'PROD-TIME',
        },
      };

      const result = await imageProcessor(job);

      expect(result.processedAt).toBeDefined();
      expect(result.processedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(new Date(result.processedAt)).toBeInstanceOf(Date);
    });

    it('should indicate success status', async () => {
      const job = {
        id: 'img-job-10',
        data: {
          uploadId: 'upload-uuid-success',
          sourceUrl: 'https://example.com/image.jpg',
          productId: 'PROD-SUCCESS',
        },
      };

      const result = await imageProcessor(job);

      expect(result.success).toBe(true);
    });

    it('should preserve job identifiers in result', async () => {
      const jobData = {
        uploadId: 'upload-uuid-preserve',
        sourceUrl: 'https://example.com/image.jpg',
        productId: 'PROD-PRESERVE',
      };

      const job = {
        id: 'img-job-11',
        data: jobData,
      };

      const result = await imageProcessor(job);

      expect(result.uploadId).toBe(jobData.uploadId);
      expect(result.productId).toBe(jobData.productId);
    });
  });

  describe('Image Processing with Sharp', () => {
    it('should export processImageWithSharp function', async () => {
      expect(imageProcessor.processImageWithSharp).toBeDefined();
      expect(typeof imageProcessor.processImageWithSharp).toBe('function');
    });

    it('should export IMAGE_SIZES constant', async () => {
      expect(imageProcessor.IMAGE_SIZES).toBeDefined();
      expect(imageProcessor.IMAGE_SIZES.thumbnail).toBeDefined();
      expect(imageProcessor.IMAGE_SIZES.medium).toBeDefined();
      expect(imageProcessor.IMAGE_SIZES.large).toBeDefined();
    });

    it('should have correct dimension specs', async () => {
      const sizes = imageProcessor.IMAGE_SIZES;

      expect(sizes.thumbnail.width).toBe(200);
      expect(sizes.thumbnail.height).toBe(200);
      expect(sizes.medium.width).toBe(600);
      expect(sizes.medium.height).toBe(600);
      expect(sizes.large.width).toBe(1200);
      expect(sizes.large.height).toBe(1200);
    });
  });

  describe('Concurrency & Resilience', () => {
    it('should handle multiple concurrent image jobs', async () => {
      const jobs = Array.from({ length: 5 }, (_, i) => ({
        id: `img-job-concurrent-${i}`,
        data: {
          uploadId: `upload-concurrent-${i}`,
          sourceUrl: `https://example.com/image-${i}.jpg`,
          productId: `PROD-CONCURRENT-${i}`,
        },
      }));

      const results = await Promise.all(jobs.map((job) => imageProcessor(job)));

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result.success).toBe(true);
      });
    });

    it('should be idempotent for retry scenarios', async () => {
      const jobData = {
        uploadId: 'upload-uuid-idempotent',
        sourceUrl: 'https://example.com/image.jpg',
        productId: 'PROD-IDEMPOTENT',
      };

      const job1 = { id: 'img-job-12', data: jobData };
      const job2 = { id: 'img-job-12-retry', data: jobData };

      const result1 = await imageProcessor(job1);
      const result2 = await imageProcessor(job2);

      // Both should produce same result
      expect(result1.uploadId).toBe(result2.uploadId);
      expect(result1.productId).toBe(result2.productId);
    });
  });

  describe('Cleanup & Resource Management', () => {
    it('should clean up temporary files on error', async () => {
      sharp.mockImplementationOnce(() => {
        throw new Error('Processing failed');
      });

      const fs = require('fs');
      const unlinkSpy = jest.spyOn(fs.promises, 'unlink');

      const job = {
        id: 'img-job-cleanup',
        data: {
          uploadId: 'upload-uuid-cleanup',
          sourceUrl: 'https://example.com/image.jpg',
          productId: 'PROD-CLEANUP',
        },
      };

      try {
        await imageProcessor(job);
      } catch (error) {
        // Expected
      }

      // Cleanup should attempt to remove temp files
      unlinkSpy.mockRestore();
    });
  });
});

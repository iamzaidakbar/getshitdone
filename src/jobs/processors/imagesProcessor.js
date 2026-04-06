/**
 * Image Processing Job Processor
 * Handles: Image resizing, compression, and S3 upload
 * Uses Sharp for processing and AWS S3 for storage
 */

const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const { uploadToS3, deleteFromS3 } = require('../../utils/s3');
const logger = require('../../utils/logger');

// Image processing dimensions
const IMAGE_SIZES = {
  thumbnail: { width: 200, height: 200, name: 'thumbnail' },
  medium: { width: 600, height: 600, name: 'medium' },
  large: { width: 1200, height: 1200, name: 'large' },
};

const JPEG_QUALITY = 80;
const S3_BUCKET = process.env.AWS_S3_BUCKET || 'getshitdone-images';

/**
 * Process image job
 * @param {Object} job - Bull job object
 * @returns {Object} Result data with S3 URLs
 */
const processorHandler = async (job) => {
  let localFiles = [];
  try {
    const { uploadId, sourceUrl, productId } = job.data;

    logger.info(`Processing image job [${job.id}]: ${uploadId} for product ${productId}`);

    // Validate inputs
    if (!uploadId || !productId) {
      throw new Error('Missing uploadId or productId in job data');
    }

    // TODO: In production:
    // 1. Download source image from sourceUrl or temp storage
    // 2. Validate image format
    // 3. Process with Sharp

    // For now, simulate processing and return placeholder URLs
    const s3Urls = {
      thumbnail: null,
      medium: null,
      large: null,
    };

    // Simulate URL generation (in production, these would be actual S3 URLs)
    const baseKey = `products/${productId}/${uploadId}`;
    s3Urls.thumbnail = `https://${S3_BUCKET}.s3.amazonaws.com/${baseKey}/thumbnail.jpg`;
    s3Urls.medium = `https://${S3_BUCKET}.s3.amazonaws.com/${baseKey}/medium.jpg`;
    s3Urls.large = `https://${S3_BUCKET}.s3.amazonaws.com/${baseKey}/large.jpg`;

    const result = {
      success: true,
      uploadId,
      productId,
      s3Urls,
      processedAt: new Date().toISOString(),
      sizes: Object.keys(IMAGE_SIZES),
    };

    logger.info(`Image processing completed [${job.id}]: ${uploadId}`);
    return result;
  } catch (error) {
    logger.error(`Image processor error [${job.id}]: ${error.message}`);

    // Clean up any local files
    for (const file of localFiles) {
      try {
        await fs.unlink(file);
        logger.debug(`Cleaned up temp file: ${file}`);
      } catch (err) {
        logger.warn(`Failed to clean up temp file ${file}: ${err.message}`);
      }
    }

    throw error; // Bull will handle retry
  }
};

/**
 * Process image with Sharp (actual implementation for production)
 * This function is exposed for testing and future use
 * @private
 */
const processImageWithSharp = async (inputPath, outputDir, uploadId) => {
  const results = {};

  try {
    // Read source image
    const sourceImage = sharp(inputPath);

    // Process each size
    for (const [sizeKey, sizeConfig] of Object.entries(IMAGE_SIZES)) {
      const outputPath = path.join(outputDir, `${uploadId}-${sizeConfig.name}.jpg`);

      await sourceImage
        .resize(sizeConfig.width, sizeConfig.height, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: JPEG_QUALITY })
        .toFile(outputPath);

      results[sizeKey] = outputPath;
      logger.debug(`Processed ${sizeConfig.name} image: ${outputPath}`);
    }

    return results;
  } catch (error) {
    logger.error(`Sharp processing error: ${error.message}`);
    throw error;
  }
};

module.exports = processorHandler;
module.exports.processImageWithSharp = processImageWithSharp;
module.exports.IMAGE_SIZES = IMAGE_SIZES;

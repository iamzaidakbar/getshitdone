/**
 * AWS S3 Utility
 * Handles image uploads and deletions from S3
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const logger = require('./logger');

// Initialize S3 client
let s3Client = null;

/**
 * Initialize S3 client if AWS credentials are configured
 * @returns {Object|null} S3 client or null if not configured
 */
const initializeS3 = () => {
  if (s3Client) {
    return s3Client;
  }

  try {
    // Check if AWS credentials are available
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || 'us-east-1';

    if (!accessKeyId || !secretAccessKey) {
      logger.warn('AWS credentials not configured - S3 uploads will be disabled');
      return null;
    }

    s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    logger.info(`S3 client initialized for region: ${region}`);
    return s3Client;
  } catch (err) {
    logger.error(`Failed to initialize S3 client: ${err.message}`);
    return null;
  }
};

/**
 * Upload buffer to S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key (path)
 * @param {Buffer} buffer - File buffer to upload
 * @returns {Promise<string|null>} S3 URL or null if upload fails
 */
const uploadToS3 = async (bucket, key, buffer) => {
  try {
    const client = initializeS3();
    if (!client) {
      logger.warn(`S3 upload skipped for ${key} - S3 not configured`);
      return null;
    }

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg',
      CacheControl: 'max-age=31536000', // 1 year
    });

    const response = await client.send(command);
    const s3Url = `https://${bucket}.s3.amazonaws.com/${key}`;

    logger.info(`Image uploaded to S3: ${key}`);
    return s3Url;
  } catch (err) {
    logger.error(`Failed to upload to S3: ${err.message}`);
    throw err;
  }
};

/**
 * Delete object from S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key (path)
 * @returns {Promise<boolean>} true if deleted, false otherwise
 */
const deleteFromS3 = async (bucket, key) => {
  try {
    const client = initializeS3();
    if (!client) {
      logger.warn(`S3 delete skipped for ${key} - S3 not configured`);
      return false;
    }

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await client.send(command);
    logger.info(`Image deleted from S3: ${key}`);
    return true;
  } catch (err) {
    logger.error(`Failed to delete from S3: ${err.message}`);
    // Don't throw - deletion failures shouldn't block job
    return false;
  }
};

/**
 * Get S3 URL for a key
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @returns {string} Full S3 URL
 */
const getS3Url = (bucket, key) => {
  return `https://${bucket}.s3.amazonaws.com/${key}`;
};

module.exports = {
  initializeS3,
  uploadToS3,
  deleteFromS3,
  getS3Url,
};

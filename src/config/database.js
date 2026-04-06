/**
 * MongoDB Connection Configuration
 * Establishes connection with production-grade settings
 */

const mongoose = require('mongoose');
const config = require('./index');
const { logger } = require('../utils');

const connectDB = async () => {
  try {
    logger.info(`🔗 Connecting to MongoDB (${config.env})...`);

    const conn = await mongoose.connect(config.mongoose.url, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      w: 'majority',
    });

    logger.info(`✅ MongoDB Connected: ${conn.connection.host}:${conn.connection.port}`);
    return conn;
  } catch (error) {
    const isLocalMongo = config.mongoose.url.includes('localhost') || config.mongoose.url.includes('127.0.0.1');
    const message = isLocalMongo 
      ? `❌ MongoDB Connection Failed. Make sure MongoDB is running locally.\n   Start MongoDB with: mongod\n   Or update MONGODB_URI in .env.${config.env} to point to a remote database.`
      : `❌ MongoDB Connection Error: ${error.message}\n   Check your connection string and network connectivity.`;
    
    logger.error(message);
    throw error;
  }
};

// Global error handlers for connection
mongoose.connection.on('error', (err) => {
  logger.error('🔴 MongoDB Connection Error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️  MongoDB Disconnected');
});

mongoose.connection.on('reconnected', () => {
  logger.info('✅ MongoDB Reconnected');
});

module.exports = connectDB;

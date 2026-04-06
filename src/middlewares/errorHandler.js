/**
 * Global Error Handler Middleware
 * Catches all errors and returns consistent API response
 */

const { ApiError, ApiResponse, logger } = require('../utils');

const errorHandler = (err, req, res, next) => {
  // Log error details
  logger.error({
    message: err.message,
    statusCode: err.statusCode || 500,
    path: req.path,
    method: req.method,
    stack: err.stack,
  });

  // Handle operational errors
  if (err instanceof ApiError) {
    const response = new ApiResponse(
      err.statusCode,
      err.details || null,
      err.message
    );
    return res.status(err.statusCode).json(response);
  }

  // Handle Joi validation errors
  if (err.isJoi) {
    const response = new ApiResponse(
      400,
      null,
      `Validation Error: ${err.message}`
    );
    return res.status(400).json(response);
  }

  // Handle MongoDB validation errors
  if (err.name === 'ValidationError') {
    const response = new ApiResponse(
      400,
      null,
      'MongoDB Validation Error: ' + err.message
    );
    return res.status(400).json(response);
  }

  // Handle MongoDB duplicate key errors
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const response = new ApiResponse(
      400,
      null,
      `Duplicate field value: ${field}`
    );
    return res.status(400).json(response);
  }

  // Default error response
  const response = new ApiResponse(
    err.statusCode || 500,
    null,
    err.message || 'Internal Server Error'
  );
  res.status(err.statusCode || 500).json(response);
};

module.exports = errorHandler;

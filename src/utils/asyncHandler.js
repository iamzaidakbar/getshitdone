/**
 * AsyncHandler wrapper to eliminate try/catch boilerplate
 * Catches any errors in async route handlers and passes to error middleware
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Express middleware
 */

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;

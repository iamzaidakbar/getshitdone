/**
 * Stripe Utility Module
 * Centralized Stripe client and webhook verification
 */

const Stripe = require('stripe');
const config = require('../config');
const { ApiError } = require('./index');

// Initialize Stripe client with secret key
const stripe = new Stripe(config.stripe.secretKey, {
  apiVersion: '2024-04-10',
});

/**
 * Verify Stripe webhook signature
 * @param {Buffer} rawBody - Raw request body as buffer
 * @param {string} signature - Stripe-Signature header value
 * @returns {Object} Verified event object
 * @throws {ApiError} If signature is invalid
 */
const verifyWebhookSignature = (rawBody, signature) => {
  try {
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.stripe.webhookSecret
    );
    return event;
  } catch (err) {
    throw new ApiError(400, `Invalid webhook signature: ${err.message}`);
  }
};

module.exports = {
  stripe,
  verifyWebhookSignature,
};

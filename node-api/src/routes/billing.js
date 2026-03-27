// src/routes/billing.js — Stripe subscription management
// Requires: npm install stripe
const express = require('express');
const router  = express.Router();
const { logger } = require('../utils/logger');

// Initialize Stripe with your secret key from .env
let stripe;
try {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} catch(e) {
  logger.warn('Stripe SDK not installed. Run: npm install stripe');
}

// ─── POST /v1/billing/subscribe ───────────────────────────────────────────────
router.post('/subscribe', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      error: 'STRIPE_NOT_CONFIGURED',
      message: 'Add STRIPE_SECRET_KEY to .env and run npm install stripe'
    });
  }

  try {
    const { payment_method_id, price_id, plan, email } = req.body;

    if (!payment_method_id || !price_id) {
      return res.status(400).json({ success: false, error: 'MISSING_PARAMS', message: 'payment_method_id and price_id are required' });
    }

    // In production: look up or create customer from your DB using req.apiKey
    const customer = await stripe.customers.create({
      email: email || `api_${req.apiKey?.slice(-8)}@afripay.dev`,
      payment_method: payment_method_id,
      invoice_settings: { default_payment_method: payment_method_id },
      metadata: { api_key: req.apiKey, plan }
    });

    const subscription = await stripe.subscriptions.create({
      customer:   customer.id,
      items:      [{ price: price_id }],
      expand:     ['latest_invoice.payment_intent'],
      metadata:   { api_key: req.apiKey, plan }
    });

    const invoice = subscription.latest_invoice;
    const intent  = invoice?.payment_intent;

    if (intent?.status === 'requires_action') {
      return res.json({
        success:              false,
        requires_action:      true,
        payment_intent_secret: intent.client_secret
      });
    }

    logger.info(`Subscription created: ${subscription.id} | plan=${plan} | key=...${req.apiKey?.slice(-6)}`);

    return res.json({
      success:         true,
      subscription_id: subscription.id,
      plan,
      status:          subscription.status,
      current_period_end: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null
    });

  } catch (err) {
    logger.error(`Billing subscribe error: ${err.message}`);
    return res.status(400).json({
      success: false,
      error:   'STRIPE_ERROR',
      message: err.message
    });
  }
});

// ─── GET /v1/billing/subscription ─────────────────────────────────────────────
router.get('/subscription', async (req, res) => {
  if (!stripe) return res.status(503).json({ success: false, error: 'STRIPE_NOT_CONFIGURED' });

  try {
    // In production: look up customer ID from DB using req.apiKey
    return res.json({
      success: true,
      plan:    'pro',
      status:  'active',
      message: 'Connect your DB to return real subscription data'
    });
  } catch (err) {
    logger.error(`Billing fetch error: ${err.message}`);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
});

// ─── POST /v1/billing/cancel ──────────────────────────────────────────────────
router.post('/cancel', async (req, res) => {
  if (!stripe) return res.status(503).json({ success: false, error: 'STRIPE_NOT_CONFIGURED' });

  try {
    const { subscription_id } = req.body;
    if (!subscription_id) return res.status(400).json({ success: false, error: 'MISSING_SUBSCRIPTION_ID' });

    const deleted = await stripe.subscriptions.cancel(subscription_id);
    logger.info(`Subscription cancelled: ${subscription_id}`);

    return res.json({ success: true, status: deleted.status });
  } catch (err) {
    logger.error(`Billing cancel error: ${err.message}`);
    return res.status(400).json({ success: false, error: 'STRIPE_ERROR', message: err.message });
  }
});

// ─── POST /v1/billing/webhook ─────────────────────────────────────────────────
// Register this URL in your Stripe dashboard: POST /v1/billing/webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.sendStatus(200);

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn(`Stripe webhook signature failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'invoice.payment_succeeded':
      logger.info(`Stripe payment succeeded: ${event.data.object.subscription}`);
      // TODO: upgrade API key tier in your DB
      break;
    case 'invoice.payment_failed':
      logger.warn(`Stripe payment failed: ${event.data.object.subscription}`);
      // TODO: downgrade/suspend API key
      break;
    case 'customer.subscription.deleted':
      logger.info(`Stripe subscription cancelled: ${event.data.object.id}`);
      // TODO: revert to free tier
      break;
  }

  return res.json({ received: true });
});

module.exports = router;

// ─── GET /v1/billing/config ────────────────────────────────────────────────────
// Returns Stripe publishable key + price IDs to the frontend (safe to expose)
router.get('/config', (req, res) => {
  const configured = !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY);
  res.json({
    success:        true,
    configured,
    publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
    prices: {
      starter: process.env.STRIPE_PRICE_STARTER || null,
      pro:     process.env.STRIPE_PRICE_PRO     || null,
      ultra:   process.env.STRIPE_PRICE_ULTRA   || null,
    },
    setup_instructions: configured ? null : {
      step1: 'Add STRIPE_PUBLISHABLE_KEY=pk_live_... to your .env',
      step2: 'Add STRIPE_SECRET_KEY=sk_live_... to your .env',
      step3: 'Create products in Stripe Dashboard → Products',
      step4: 'Add STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_ULTRA price IDs to .env',
      step5: 'Run: npm install stripe',
      docs:  'https://dashboard.stripe.com/products'
    }
  });
});

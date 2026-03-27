// src/utils/transactionStore.js — In-memory store with Redis-ready interface
// Drop-in: set REDIS_URL in .env to switch to Redis automatically

const { logger } = require('./logger');

let redisClient = null;

// Try to connect to Redis if URL is provided
if (process.env.REDIS_URL) {
  try {
    const Redis = require('ioredis');
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false
    });
    redisClient.on('connect',  () => logger.info('TransactionStore: Redis connected'));
    redisClient.on('error',    (e) => {
      logger.warn(`TransactionStore: Redis error — falling back to in-memory (${e.message})`);
      redisClient = null;
    });
  } catch {
    logger.warn('TransactionStore: ioredis not available — using in-memory store');
  }
}

// ─── In-Memory Fallback ────────────────────────────────────────────────────────
const memStore = new Map();           // id          → transaction object
const refIndex  = new Map();          // provider_ref → id   (for webhook lookups)

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Redis Helpers ─────────────────────────────────────────────────────────────
const TX_PREFIX  = 'afp:tx:';
const REF_PREFIX = 'afp:ref:';
const TTL_S      = 7 * 24 * 60 * 60;   // 7 days in seconds

// ─── Public API ───────────────────────────────────────────────────────────────

async function saveTransaction(tx) {
  try {
    if (redisClient) {
      await redisClient.set(`${TX_PREFIX}${tx.id}`, JSON.stringify(tx), 'EX', TTL_S);
      if (tx.provider_ref) {
        await redisClient.set(`${REF_PREFIX}${tx.provider_ref}`, tx.id, 'EX', TTL_S);
      }
    } else {
      memStore.set(tx.id, { ...tx, _expiresAt: Date.now() + TTL_MS });
      if (tx.provider_ref) refIndex.set(tx.provider_ref, tx.id);
    }
    logger.debug(`Transaction saved: ${tx.id}`);
  } catch (err) {
    logger.error(`saveTransaction error: ${err.message}`);
    throw err;
  }
}

async function getTransaction(id) {
  try {
    if (redisClient) {
      const raw = await redisClient.get(`${TX_PREFIX}${id}`);
      return raw ? JSON.parse(raw) : null;
    } else {
      const tx = memStore.get(id);
      if (!tx) return null;
      if (Date.now() > tx._expiresAt) { memStore.delete(id); return null; }
      return tx;
    }
  } catch (err) {
    logger.error(`getTransaction error: ${err.message}`);
    return null;
  }
}

async function getTransactionByProviderRef(providerRef) {
  try {
    if (redisClient) {
      const id = await redisClient.get(`${REF_PREFIX}${providerRef}`);
      return id ? getTransaction(id) : null;
    } else {
      const id = refIndex.get(providerRef);
      return id ? getTransaction(id) : null;
    }
  } catch (err) {
    logger.error(`getTransactionByProviderRef error: ${err.message}`);
    return null;
  }
}

async function updateTransaction(id, updates) {
  try {
    const tx = await getTransaction(id);
    if (!tx) {
      logger.warn(`updateTransaction: ${id} not found`);
      return null;
    }
    const updated = { ...tx, ...updates, updated_at: new Date().toISOString() };

    if (redisClient) {
      await redisClient.set(`${TX_PREFIX}${id}`, JSON.stringify(updated), 'EX', TTL_S);
    } else {
      memStore.set(id, { ...updated, _expiresAt: tx._expiresAt });
    }

    logger.debug(`Transaction updated: ${id} → ${updates.status || '(no status change)'}`);
    return updated;
  } catch (err) {
    logger.error(`updateTransaction error: ${err.message}`);
    throw err;
  }
}

// Periodic cleanup of expired in-memory entries (runs every 10 minutes)
if (!redisClient) {
  setInterval(() => {
    const now = Date.now();
    let pruned = 0;
    for (const [id, tx] of memStore.entries()) {
      if (now > tx._expiresAt) {
        if (tx.provider_ref) refIndex.delete(tx.provider_ref);
        memStore.delete(id);
        pruned++;
      }
    }
    if (pruned > 0) logger.debug(`TransactionStore: pruned ${pruned} expired entries`);
  }, 10 * 60 * 1000);
}

module.exports = { saveTransaction, getTransaction, getTransactionByProviderRef, updateTransaction };

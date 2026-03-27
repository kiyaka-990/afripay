// src/utils/logger.js — Winston structured logger
const { createLogger, format, transports } = require('winston');

const { combine, timestamp, colorize, printf, json, errors } = format;

const isProd = process.env.NODE_ENV === 'production';

// ─── Human-readable format for development ────────────────────────────────────
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const extras = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} [${level}] ${message}${stack ? `\n${stack}` : ''}${extras}`;
  })
);

// ─── JSON format for production (Datadog, CloudWatch, etc.) ───────────────────
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  format: isProd ? prodFormat : devFormat,
  transports: [
    new transports.Console()
  ],
  // Prevent unhandled exceptions from crashing the process silently
  exceptionHandlers: [new transports.Console()],
  rejectionHandlers: [new transports.Console()]
});

// Convenience: suppress all output during tests
if (process.env.NODE_ENV === 'test') {
  logger.silent = true;
}

module.exports = { logger };

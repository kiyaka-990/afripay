// src/middleware/requestId.js — Attach X-Request-ID to every request/response
const { v4: uuidv4 } = require('uuid');

function requestId(req, res, next) {
  // Honour an existing ID from upstream proxy/gateway, or generate a fresh one
  const id = req.headers['x-request-id'] || `req_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
}

module.exports = { requestId };

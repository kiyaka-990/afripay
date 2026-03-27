// src/utils/networkDetector.js — Phone number → network/country detection
// Primary: calls Rust core (napi binding) if available
// Fallback: pure JS regex rules for all supported African markets

let rustCore = null;
try {
  rustCore = require('../../rust-core/afripay_core.node');
} catch {
  // Rust binary not compiled — use JS fallback (development mode)
}

// ─── Network Detection Rules ──────────────────────────────────────────────────
// Format: { pattern, network, country, country_code, currency, prefix }
const NETWORK_RULES = [
  // Kenya — M-Pesa (Safaricom)
  { pattern: /^(?:\+?254|0)7(?:0[0-9]|1[0-9]|2[0-9]|4[0-3]|4[5-9]|5[6-9]|6[89]|9[0-2])\d{6}$/, network: 'mpesa',    country: 'Kenya',    country_code: 'KE', currency: 'KES' },
  // Kenya — Airtel
  { pattern: /^(?:\+?254|0)7(?:3[0-9]|5[0-5]|8[0-9])\d{6}$/,                                      network: 'airtel',   country: 'Kenya',    country_code: 'KE', currency: 'KES' },
  // Uganda — MTN
  { pattern: /^(?:\+?256|0)7(?:6[0-9]|7[0-9]|8[0-9])\d{6}$/,                                      network: 'mtn_momo', country: 'Uganda',   country_code: 'UG', currency: 'UGX' },
  // Uganda — Airtel
  { pattern: /^(?:\+?256|0)7(?:0[0-9]|5[0-9])\d{6}$/,                                              network: 'airtel',   country: 'Uganda',   country_code: 'UG', currency: 'UGX' },
  // Tanzania — M-Pesa (Vodacom)
  { pattern: /^(?:\+?255|0)7(?:4[0-9]|5[0-9]|6[0-9])\d{6}$/,                                      network: 'mpesa',    country: 'Tanzania', country_code: 'TZ', currency: 'TZS' },
  // Tanzania — Airtel
  { pattern: /^(?:\+?255|0)7(?:8[0-9]|9[0-9])\d{6}$/,                                              network: 'airtel',   country: 'Tanzania', country_code: 'TZ', currency: 'TZS' },
  // Ghana — MTN
  { pattern: /^(?:\+?233|0)(?:24|54|55|59)\d{7}$/,                                                  network: 'mtn_momo', country: 'Ghana',    country_code: 'GH', currency: 'GHS' },
  // Ghana — Airtel/Tigo
  { pattern: /^(?:\+?233|0)(?:26|56|57)\d{7}$/,                                                     network: 'airtel',   country: 'Ghana',    country_code: 'GH', currency: 'GHS' },
  // Nigeria — MTN
  { pattern: /^(?:\+?234|0)(?:803|806|813|814|816|903|906)\d{7}$/,                                  network: 'mtn_momo', country: 'Nigeria',  country_code: 'NG', currency: 'NGN' },
  // Nigeria — Airtel
  { pattern: /^(?:\+?234|0)(?:802|808|812|701|708)\d{7}$/,                                          network: 'airtel',   country: 'Nigeria',  country_code: 'NG', currency: 'NGN' },
  // Rwanda — MTN
  { pattern: /^(?:\+?250|0)7(?:2[0-9]|3[0-9]|8[0-9])\d{6}$/,                                      network: 'mtn_momo', country: 'Rwanda',   country_code: 'RW', currency: 'RWF' },
  // Zambia — MTN / Airtel
  { pattern: /^(?:\+?260|0)9(?:6[0-9])\d{6}$/,                                                      network: 'mtn_momo', country: 'Zambia',   country_code: 'ZM', currency: 'ZMW' },
  { pattern: /^(?:\+?260|0)9(?:7[0-9])\d{6}$/,                                                      network: 'airtel',   country: 'Zambia',   country_code: 'ZM', currency: 'ZMW' }
];

const CURRENCY_MAP = {
  KE: 'KES', UG: 'UGX', TZ: 'TZS', GH: 'GHS', NG: 'NGN', RW: 'RWF', ZM: 'ZMW'
};

function normalizePhone(phone, countryCode) {
  // Strip spaces and dashes
  let p = phone.replace(/[\s\-()]/g, '');
  // Convert leading 0 to international format
  const dialCodes = { KE: '254', UG: '256', TZ: '255', GH: '233', NG: '234', RW: '250', ZM: '260' };
  const dial = dialCodes[countryCode];
  if (dial && p.startsWith('0')) p = `+${dial}${p.slice(1)}`;
  if (dial && p.startsWith(dial)) p = `+${p}`;
  return p;
}

function detectNetwork(phone) {
  // Try Rust core first (faster, more accurate)
  if (rustCore?.detectNetwork) {
    try {
      return rustCore.detectNetwork(phone);
    } catch {
      // fall through to JS
    }
  }

  for (const rule of NETWORK_RULES) {
    if (rule.pattern.test(phone)) {
      return {
        is_valid:     true,
        network:      rule.network,
        country:      rule.country,
        country_code: rule.country_code,
        normalized:   normalizePhone(phone, rule.country_code),
        currency:     rule.currency
      };
    }
  }

  return { is_valid: false, network: null, country: null, country_code: null, normalized: phone };
}

function getCurrencyForCountry(countryCode) {
  return CURRENCY_MAP[countryCode] || 'USD';
}

module.exports = { detectNetwork, getCurrencyForCountry, NETWORK_RULES };

# AfriPay — Unified Mobile Money API

**One API. M-Pesa, MTN MoMo, Airtel Money. 7 African countries.**

AfriPay wraps Safaricom Daraja, MTN MoMo, and Airtel Money into a single,
clean REST API. Pass a phone number and amount — AfriPay auto-detects the
network and routes the payment. No more juggling three different SDKs,
auth flows, and callback formats.

## What makes it different

- **Rust-powered core** — network detection, phone normalisation, HMAC
  signing, and token management run in compiled Rust (~50× faster than JS
  for these hot-path operations).
- **Auto network detection** — detects M-Pesa/MTN/Airtel from the phone
  number prefix. No `network` field required.
- **Unified response format** — every provider returns the same JSON shape.
- **7 countries** — Kenya, Uganda, Ghana, Tanzania, Rwanda, Zambia, Nigeria.
- **Production-ready** — rate limiting, request IDs, structured logging,
  webhook signature verification, Docker-ready.

---

## Project Structure

```
afripay/
├── rust-core/          Rust library: phone detection, signing, validation
│   ├── Cargo.toml
│   └── src/lib.rs
├── node-api/           Express API server
│   ├── src/
│   │   ├── server.js
│   │   ├── routes/     pay, status, disburse, balance, webhooks, keys, health
│   │   ├── services/   mpesa.js, mtnMomo.js, airtel.js
│   │   ├── middleware/ authenticate, rateLimiter, errorHandler, requestId
│   │   └── utils/      networkDetector, transactionStore, logger
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
├── dashboard/          Developer portal (HTML/CSS/JS — no framework needed)
│   └── index.html
└── docker-compose.yml
```

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/yourname/afripay
cd afripay/node-api
npm install
cp .env.example .env
# Fill in your Daraja / MTN MoMo / Airtel credentials
```

### 2. Run in development

```bash
npm run dev
# API running at http://localhost:3000
```

### 3. Run tests

```bash
npm test
```

### 4. Deploy with Docker

```bash
cd afripay
docker-compose up -d
```

---

## API Reference

### Base URL
```
https://api.afripay.dev        (production)
http://localhost:3000           (local)
```

### Authentication
Every request needs your API key:
```
Authorization: Bearer afp_live_your_key_here
# or
X-API-Key: afp_live_your_key_here
```

---

### POST /v1/pay

Initiate a payment. AfriPay prompts the customer's phone (STK Push for
M-Pesa, USSD prompt for MTN/Airtel).

**Request body**
```json
{
  "phone":       "+254712345678",   // required — any format accepted
  "amount":      500,               // required — positive number, max 150000
  "currency":    "KES",             // optional — auto-inferred from phone
  "reference":   "ORDER-001",       // required — max 20 chars
  "description": "Payment for X",   // optional — max 100 chars
  "callback_url":"https://...",     // optional — override default webhook URL
  "network":     "auto"             // optional — "auto"|"mpesa"|"mtn_momo"|"airtel"
}
```

**Response 202**
```json
{
  "success":        true,
  "transaction_id": "afp_a3f9b2c1d4e5f6a7b8c9",
  "provider_ref":   "ws_CO_25072024123456789",
  "status":         "pending",
  "network":        "mpesa",
  "phone":          "254712345678",
  "amount":         500,
  "currency":       "KES",
  "country":        "Kenya",
  "message":        "Customer will receive a prompt on their phone.",
  "check_status":   "GET /v1/status/afp_a3f9b2c1d4e5f6a7b8c9"
}
```

---

### GET /v1/status/:transaction_id

Poll for payment status. Returns `pending`, `success`, `failed`, or `cancelled`.

```bash
curl https://api.afripay.dev/v1/status/afp_a3f9b2c1d4e5f6a7b8c9 \
  -H "Authorization: Bearer afp_live_your_key"
```

---

### POST /v1/disburse

Send money OUT to a phone number (payroll, refunds, commissions).

```json
{
  "phone":     "+256771234567",
  "amount":    25000,
  "currency":  "UGX",
  "reference": "SALARY-JUN",
  "note":      "June salary"
}
```

---

### GET /v1/balance

Check your paybill / MoMo account balance.

```bash
curl https://api.afripay.dev/v1/balance?network=mpesa \
  -H "Authorization: Bearer afp_live_your_key"
```

---

## Webhooks

AfriPay receives callbacks from M-Pesa/MTN/Airtel and normalises them.
All webhook endpoints are at:

```
POST /v1/webhooks/mpesa/stk      M-Pesa STK Push result
POST /v1/webhooks/mpesa/c2b      M-Pesa C2B confirmation
POST /v1/webhooks/mtn            MTN MoMo result
POST /v1/webhooks/airtel         Airtel Money result
```

---

## Supported Countries & Networks

| Country  | Code | M-Pesa | MTN MoMo | Airtel |
|----------|------|--------|----------|--------|
| Kenya    | KE   | ✅     | —        | ✅     |
| Uganda   | UG   | —      | ✅       | ✅     |
| Ghana    | GH   | —      | ✅       | ✅     |
| Tanzania | TZ   | ✅     | —        | ✅     |
| Rwanda   | RW   | —      | ✅       | —      |
| Zambia   | ZM   | —      | ✅       | —      |
| Nigeria  | NG   | —      | —        | ✅     |

---

## Pricing (RapidAPI)

| Plan    | Price   | Calls/month | Networks |
|---------|---------|-------------|----------|
| Free    | $0      | 500         | Sandbox  |
| Starter | $19/mo  | 5,000       | All live |
| Pro     | $79/mo  | 50,000      | All live |
| Ultra   | $249/mo | Unlimited   | All live |

Overage: $0.005 per call above quota.

---

## Rust Core — What it does

The `rust-core` crate handles the performance-critical hot path:

- **Phone detection** — prefix-based network/country lookup (no regex backtracking)
- **Phone normalisation** — handles local formats (0712...), short (712...), E.164
- **M-Pesa password** — Base64(shortcode + passkey + timestamp) generation
- **HMAC-SHA256** — webhook signing and verification
- **API key generation** — cryptographically random key pairs
- **Request validation** — amount limits, currency whitelist, reference length

The Node.js API loads it as a native addon via Neon bindings.
Falls back to the JavaScript equivalent automatically if not compiled.

---

## Going Live

### M-Pesa (Daraja)
1. Register at https://developer.safaricom.co.ke
2. Create an app → get Consumer Key + Secret
3. Apply for a Paybill number (or use your existing Till)
4. Submit go-live request with company letterhead

### MTN MoMo
1. Register at https://momodeveloper.mtn.com
2. Subscribe to Collections + Disbursements products
3. Generate sandbox User ID + API Key via the provisioning API
4. Complete KYC → get production credentials

### Airtel Money
1. Register at https://developers.airtel.africa
2. Get Client ID + Secret
3. Complete onboarding → production access

---

## License
MIT — use freely, sell the API, keep the code.

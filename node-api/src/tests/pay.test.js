// src/tests/pay.test.js
const request = require('supertest');
const app     = require('../server');

// Mock provider services so tests don't hit real APIs
jest.mock('../services/mpesa',   () => ({
  stkPush:      jest.fn().mockResolvedValue({ provider_ref: 'ws_CO_test123', network: 'mpesa' }),
  queryStatus:  jest.fn().mockResolvedValue({ status: 'pending' }),
  b2cPay:       jest.fn().mockResolvedValue({ conversation_id: 'conv_test', network: 'mpesa' }),
  getBalance:   jest.fn().mockResolvedValue({ network: 'mpesa' })
}));
jest.mock('../services/mtnMomo', () => ({
  requestPayment:   jest.fn().mockResolvedValue({ provider_ref: 'mtn_ref_test', network: 'mtn_momo' }),
  getPaymentStatus: jest.fn().mockResolvedValue({ status: 'pending' }),
  transfer:         jest.fn().mockResolvedValue({ provider_ref: 'mtn_disburse_test', network: 'mtn_momo' }),
  getBalance:       jest.fn().mockResolvedValue({ network: 'mtn_momo' })
}));
jest.mock('../services/airtel',  () => ({
  ussdPush:            jest.fn().mockResolvedValue({ provider_ref: 'airtel_ref_test', network: 'airtel' }),
  getTransactionStatus:jest.fn().mockResolvedValue({ status: 'pending' }),
  disburse:            jest.fn().mockResolvedValue({ provider_ref: 'airtel_disburse', network: 'airtel' })
}));

const TEST_KEY = 'afp_test_abc123def456789012345';

describe('GET /health', () => {
  it('returns 200 with service info', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.networks).toContain('mpesa');
  });
});

describe('POST /v1/pay', () => {
  it('rejects missing API key', async () => {
    const res = await request(app).post('/v1/pay').send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('MISSING_API_KEY');
  });

  it('rejects invalid phone', async () => {
    const res = await request(app)
      .post('/v1/pay')
      .set('X-API-Key', TEST_KEY)
      .send({ phone: '000', amount: 100, reference: 'TEST' });
    expect(res.status).toBe(400);
  });

  it('initiates M-Pesa payment for Safaricom number', async () => {
    const res = await request(app)
      .post('/v1/pay')
      .set('X-API-Key', TEST_KEY)
      .send({ phone: '+254712345678', amount: 500, reference: 'ORDER-001' });
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.network).toBe('mpesa');
    expect(res.body.transaction_id).toMatch(/^afp_/);
  });

  it('initiates MTN MoMo payment for Uganda number', async () => {
    const res = await request(app)
      .post('/v1/pay')
      .set('X-API-Key', TEST_KEY)
      .send({ phone: '+256771234567', amount: 10000, reference: 'ORDER-002' });
    expect(res.status).toBe(202);
    expect(res.body.network).toBe('mtn_momo');
    expect(res.body.country).toBe('Uganda');
  });

  it('rejects amount exceeding limit', async () => {
    const res = await request(app)
      .post('/v1/pay')
      .set('X-API-Key', TEST_KEY)
      .send({ phone: '+254712345678', amount: 999999, reference: 'BIG' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('rejects reference over 20 chars', async () => {
    const res = await request(app)
      .post('/v1/pay')
      .set('X-API-Key', TEST_KEY)
      .send({ phone: '+254712345678', amount: 100, reference: 'THIS-IS-WAY-TOO-LONG-REF' });
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/disburse', () => {
  it('sends B2C payment for M-Pesa number', async () => {
    const res = await request(app)
      .post('/v1/disburse')
      .set('X-API-Key', TEST_KEY)
      .send({ phone: '+254712345678', amount: 200, reference: 'REFUND-01' });
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.network).toBe('mpesa');
  });
});

describe('GET /health', () => {
  it('lists supported countries', async () => {
    const res = await request(app).get('/health');
    expect(res.body.countries).toEqual(expect.arrayContaining(['KE', 'UG', 'GH']));
  });
});

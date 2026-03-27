// src/services/mpesa.js - Safaricom Daraja API integration
const axios = require('axios');
const { logger } = require('../utils/logger');

const BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

// Token cache — avoid hitting OAuth on every request
let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const { data } = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (parseInt(data.expires_in) - 30) * 1000
  };

  logger.debug('M-Pesa token refreshed');
  return tokenCache.token;
}

function generatePassword() {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey   = process.env.MPESA_PASSKEY;
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const password  = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  return { password, timestamp };
}

// STK Push — prompts customer's phone to enter PIN
async function stkPush({ phone, amount, reference, description, callbackUrl }) {
  const token = await getAccessToken();
  const { password, timestamp } = generatePassword();

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   'CustomerPayBillOnline',
    Amount:            Math.ceil(amount),   // M-Pesa requires integers
    PartyA:            phone,
    PartyB:            process.env.MPESA_SHORTCODE,
    PhoneNumber:       phone,
    CallBackURL:       callbackUrl || process.env.MPESA_CALLBACK_URL,
    AccountReference:  reference.slice(0, 12),
    TransactionDesc:   (description || reference).slice(0, 13)
  };

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (data.ResponseCode !== '0') {
    throw new Error(`M-Pesa STK Push failed: ${data.ResponseDescription}`);
  }

  return {
    provider_ref:    data.CheckoutRequestID,
    merchant_ref:    data.MerchantRequestID,
    response_code:   data.ResponseCode,
    response_desc:   data.ResponseDescription,
    network:         'mpesa'
  };
}

// Query STK Push status
async function queryStatus(checkoutRequestId) {
  const token = await getAccessToken();
  const { password, timestamp } = generatePassword();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      CheckoutRequestID: checkoutRequestId
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return {
    result_code: data.ResultCode,
    result_desc: data.ResultDesc,
    status: data.ResultCode === '0' ? 'success' : data.ResultCode === '1032' ? 'cancelled' : 'failed'
  };
}

// B2C — send money to a customer
async function b2cPay({ phone, amount, occasion, remarks }) {
  const token = await getAccessToken();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/b2c/v1/paymentrequest`,
    {
      InitiatorName:      process.env.MPESA_INITIATOR_NAME,
      SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
      CommandID:          'BusinessPayment',
      Amount:             Math.ceil(amount),
      PartyA:             process.env.MPESA_SHORTCODE,
      PartyB:             phone,
      Remarks:            (remarks || 'Payment').slice(0, 100),
      QueueTimeOutURL:    process.env.MPESA_TIMEOUT_URL,
      ResultURL:          process.env.MPESA_RESULT_URL,
      Occasion:           (occasion || '').slice(0, 100)
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return {
    conversation_id:   data.ConversationID,
    originator_ref:    data.OriginatorConversationID,
    response_code:     data.ResponseCode,
    network:           'mpesa'
  };
}

// Account Balance
async function getBalance() {
  const token = await getAccessToken();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/accountbalance/v1/query`,
    {
      Initiator:          process.env.MPESA_INITIATOR_NAME,
      SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
      CommandID:          'AccountBalance',
      PartyA:             process.env.MPESA_SHORTCODE,
      IdentifierType:     '4',
      Remarks:            'Balance check',
      QueueTimeOutURL:    process.env.MPESA_TIMEOUT_URL,
      ResultURL:          process.env.MPESA_RESULT_URL
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return {
    conversation_id: data.ConversationID,
    response_code:   data.ResponseCode,
    network:         'mpesa'
  };
}

module.exports = { stkPush, queryStatus, b2cPay, getBalance };

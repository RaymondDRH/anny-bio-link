// Crea una orden de PayPal (Next Flight Academy). Precio según código secreto (servidor).
const crypto = require('crypto');

const BASE = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

// Catálogo de códigos → precio en CENTAVOS. Sin código = precio normal.
const CODES = {};
// Código de prueba LIVE de $1: ACTIVO solo si existe la env var LIVE_TEST_CODE.
if (process.env.LIVE_TEST_CODE) CODES[String(process.env.LIVE_TEST_CODE).trim().toUpperCase()] = 100;
const BASE_AMOUNT = 69700; // $697 (precio original)

function priceForValue(code) {
  let cents = BASE_AMOUNT;
  if (code) {
    const k = String(code).trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(CODES, k)) cents = CODES[k];
  }
  return (cents / 100).toFixed(2); // string para PayPal, ej "1.00"
}

let _token = null;
let _tokenExp = 0;

async function getAccessToken() {
  if (_token && Date.now() < _tokenExp) return _token;
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString('base64');
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('paypal_auth_failed');
  _token = data.access_token;
  _tokenExp = Date.now() + ((data.expires_in || 300) - 60) * 1000;
  return _token;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const value = priceForValue(body && body.code);

    const token = await getAccessToken();
    const r = await fetch(`${BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': crypto.randomUUID(),
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: 'USD', value },
            description: 'Next Flight Academy',
          },
        ],
      }),
    });
    const order = await r.json();
    if (!order.id) {
      return res.status(500).json({ error: 'order_failed', details: order });
    }
    res.status(200).json({ id: order.id });
  } catch (error) {
    console.error('PayPal create-order error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

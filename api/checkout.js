const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Catálogo de códigos secretos → precio en CENTAVOS. Sin código = precio normal.
const CODES = {};
// Código de prueba LIVE de $1: ACTIVO solo si existe la env var LIVE_TEST_CODE.
if (process.env.LIVE_TEST_CODE) CODES[String(process.env.LIVE_TEST_CODE).trim().toUpperCase()] = 100;
const BASE_AMOUNT = 69700; // $697 (precio original)

function priceFor(code) {
  if (!code) return BASE_AMOUNT;
  const k = String(code).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CODES, k) ? CODES[k] : BASE_AMOUNT;
}

// Crea/actualiza un Customer con los datos del comprador y lo adjunta al
// PaymentIntent ANTES de cobrar, para que el recibo y el panel de Stripe
// identifiquen quién pagó (nombre completo + correo + teléfono).
// NO bloqueante: si algo falla, el pago igual continúa.
async function attachCustomer({ paymentIntentId, name, email, phone }) {
  if (!paymentIntentId || !email) return { ok: false, reason: 'missing_data' };
  let customer = null;
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing && existing.data && existing.data.length) {
    customer = existing.data[0];
    await stripe.customers.update(customer.id, {
      name: name || customer.name || undefined,
      phone: phone || customer.phone || undefined,
    });
  } else {
    customer = await stripe.customers.create({
      name: name || undefined,
      email,
      phone: phone || undefined,
    });
  }
  await stripe.paymentIntents.update(paymentIntentId, {
    customer: customer.id,
    receipt_email: email,
  });
  return { ok: true };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    // Rama: adjuntar Customer a un PaymentIntent existente (antes de cobrar).
    if (body.action === 'attach-customer') {
      try {
        const result = await attachCustomer({
          paymentIntentId: body.paymentIntentId,
          name: body.name ? String(body.name).trim() : '',
          email: body.email ? String(body.email).trim() : '',
          phone: body.phone ? String(body.phone).trim() : '',
        });
        return res.status(200).json(result);
      } catch (e) {
        console.error('attach-customer error:', e.message);
        return res.status(200).json({ ok: false, error: e.message }); // nunca bloquear el pago
      }
    }

    // Rama por defecto: crear el PaymentIntent.
    const code = body.code ? String(body.code).trim() : '';
    const amount = priceFor(code);

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      description: 'Next Flight Academy',
      metadata: { product: 'next-fly-academy', code: code },
    });

    res.status(200).json({ clientSecret: paymentIntent.client_secret, amount });
  } catch (error) {
    console.error('Stripe error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

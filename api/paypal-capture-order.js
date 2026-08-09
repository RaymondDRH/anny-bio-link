// Captura (cobra) una orden de PayPal aprobada y notifica a Anny la venta.
const { sendReceiptToAnny } = require('../lib/receipt');
const { enviarCorreo, escaparHtml } = require('../lib/mailer');
const { marcarComprado, guardarLeadCheckout } = require('../lib/leads-estado');
const { normalizarTelefono } = require('../lib/telefono');
const BASE = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

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

// --- Notificación de venta a Anny (Telegram + correo) ---
async function notifyAnny({ name, email, phone, amount, method }) {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = ['7832130304', '7263847739']; // Anny + Raymond
  const msg =
    `🎉 *¡Nueva venta!* — Next Flight Academy\n\n` +
    `💰 $${amount} USD\n` +
    `💳 Método: ${method}\n` +
    `👤 ${name || '—'}\n` +
    `✉️ ${email || '—'}\n` +
    `📱 ${phone || '—'}`;
  if (tgToken) {
    for (const chatId of chatIds) {
      try {
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }),
        });
      } catch (e) { console.error('tg notify', e.message); }
    }
  }
  // Critico: sin este correo, Anny sabe que hubo venta (Telegram) pero no tiene
  // los datos del comprador para darle el acceso.
  await enviarCorreo(
    {
      from: 'Anny Gómez <ventas@annygomez.com>',
      to: ['annygomezleal@gmail.com'],
      subject: `🎉 Nueva venta — Next Flight Academy ($${amount})`,
      html:
        `<h2>¡Nueva venta! 🎉</h2>` +
        `<p><b>Producto:</b> Next Flight Academy</p>` +
        `<p><b>Monto:</b> $${escaparHtml(amount)} USD</p>` +
        `<p><b>Método:</b> ${escaparHtml(method)}</p>` +
        `<p><b>Cliente:</b> ${escaparHtml(name) || '—'}</p>` +
        `<p><b>Correo:</b> ${escaparHtml(email) || '—'}</p>` +
        `<p><b>Teléfono:</b> ${escaparHtml(phone) || '—'}</p>`,
    },
    { critico: true, etiqueta: `aviso de venta a Anny — PayPal ($${amount})` },
  );
}

// --- Correo de bienvenida al comprador (branding Next Fly) ---
function welcomeHtml(name, amount) {
  const hi = name ? (', ' + escaparHtml(name)) : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;1,500&family=Poppins:wght@300;400;500&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;font-family:'Poppins','Helvetica Neue',Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#2a0a12;border-radius:18px;overflow:hidden;border:1px solid rgba(196,154,60,0.28)"><tr><td><img src="https://annygomez.com/next-fly-banner-email.jpg" alt="Next Flight Academy" width="560" style="width:100%;display:block"></td></tr><tr><td style="padding:38px 40px 30px;text-align:center"><h1 style="margin:0 0 10px;font-family:'Playfair Display',Georgia,serif;font-size:27px;color:#e3b95a;font-weight:500">¡Te damos la bienvenida a bordo${hi}! &#9992;&#65039;</h1><p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#f5edd8">Tu compra de <strong>Next Flight Academy</strong> está <strong style="color:#e3b95a">confirmada</strong>. ¡Qué emoción tenerte en este viaje!</p><div style="background:rgba(255,255,255,0.04);border:1px solid rgba(196,154,60,0.28);border-radius:14px;padding:18px 22px;margin:4px 0 20px;text-align:left"><p style="margin:0 0 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#e3b95a">Recibo de compra</p><p style="margin:0 0 5px;font-size:14px;color:#f5edd8"><strong>Comprador:</strong> ${escaparHtml(name) || '—'}</p><p style="margin:0 0 5px;font-size:14px;color:#f5edd8"><strong>Producto:</strong> Next Flight Academy</p><p style="margin:0;font-size:14px;color:#f5edd8"><strong>Monto pagado:</strong> $${escaparHtml(amount) || '—'} USD</p></div><div style="background:rgba(196,154,60,0.10);border:1px solid rgba(196,154,60,0.25);border-radius:14px;padding:22px 26px;margin:6px 0 24px"><p style="margin:0;font-size:14px;line-height:1.7;color:#f5edd8">&#127915; Tus <strong>accesos a la plataforma</strong> se están preparando y los recibirás <strong style="color:#e3b95a">en las próximas horas</strong>. Mantente pendiente de tu correo.</p></div><p style="margin:0 0 10px;font-size:14px;color:#f5edd8">¿Tienes alguna duda? Escríbenos:</p><p style="margin:0 0 4px;font-size:14px;color:#e3b95a">&#128247; Instagram: <a href="https://instagram.com/annygomezleal" style="color:#e3b95a;text-decoration:none">@annygomezleal</a></p><p style="margin:0 0 26px;font-size:14px;color:#e3b95a">&#128172; WhatsApp: <a href="https://wa.me/12516509950" style="color:#e3b95a;text-decoration:none">+1 251 650 9950</a></p><p style="margin:0;font-size:13px;color:rgba(245,237,216,0.6)">Prepárate para despegar &#128640;</p></td></tr><tr><td style="background:#140309;padding:18px 40px;text-align:center;border-top:1px solid rgba(196,154,60,0.18)"><p style="margin:0 0 6px;font-size:11px;color:rgba(245,237,216,0.45)">Tu compra la gestion&oacute; <strong style="color:rgba(245,237,216,0.68)">Anny G&oacute;mez</strong> &middot; annygomez.com</p><p style="margin:0;font-size:10px;line-height:1.5;color:rgba(245,237,216,0.32)">Next Flight Academy es una marca de terceros. Anny G&oacute;mez te da acceso al programa.</p></td></tr></table></td></tr></table></body></html>`;
}

async function sendWelcome(toEmail, name, amount) {
  if (!toEmail) return { ok: false, intentos: 0, motivo: 'sin_destinatario' };
  // EL MAS CRITICO DE TODOS: es la unica confirmacion que recibe alguien que
  // acaba de pagar $697. Si no llega, pago y no tiene ni prueba de la compra.
  return enviarCorreo(
    {
      from: 'Anny Gómez <ventas@annygomez.com>',
      to: [toEmail],
      subject: '✈️ ¡Te damos la bienvenida! Tu compra de Next Flight Academy está confirmada',
      html: welcomeHtml(name, amount),
    },
    { critico: true, etiqueta: `bienvenida al comprador — PayPal (${toEmail})` },
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const orderID = body && body.orderID;
    if (!orderID) return res.status(400).json({ error: 'missing orderID' });

    const token = await getAccessToken();
    const r = await fetch(`${BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await r.json();

    const cap = data &&
      data.purchase_units && data.purchase_units[0] &&
      data.purchase_units[0].payments && data.purchase_units[0].payments.captures &&
      data.purchase_units[0].payments.captures[0];
    const amountVal = cap && cap.amount ? cap.amount.value : '0.00';
    const completed = data.status === 'COMPLETED' &&
      cap && cap.status === 'COMPLETED';

    if (completed) {
      // PayPal ya envía el recibo al comprador automáticamente.
      // Tomamos los datos del comprador de la respuesta de PayPal (verificados).
      const payer = data.payer || {};
      const payerName = payer.name
        ? [payer.name.given_name, payer.name.surname].filter(Boolean).join(' ')
        : '';
      const payerPhone = (payer.phone && payer.phone.phone_number && payer.phone.phone_number.national_number) || body.phone;
      await notifyAnny({
        name: payerName || body.name,
        email: payer.email_address || body.email,
        phone: payerPhone,
        amount: amountVal,
        method: 'PayPal',
      });
      // Correo de bienvenida al comprador
      await sendWelcome(payer.email_address || body.email, payerName || body.name, amountVal);
      // PayPal recoge sus propios datos y NO pasa por el formulario, asi que
      // aqui nunca existia un lead que marcar: marcarComprado afectaba 0 filas
      // y la compradora no aparecia en Supabase. Se crea (o se completa) el
      // lead con los datos verificados de PayPal y luego se marca comprado.
      // El pais sale de la direccion de PayPal: declarado, no adivinado.
      const telPaypal = normalizarTelefono(
        payerPhone,
        (payer.address && payer.address.country_code) || '',
      );
      await guardarLeadCheckout({
        p_name: payerName || body.name || '',
        p_email: payer.email_address || body.email || '',
        p_origen: 'paypal',
        p_telefono: telPaypal.e164 || null,
        p_telefono_crudo: telPaypal.original || null,
        p_telefono_ok: telPaypal.original ? telPaypal.valido : null,
        p_producto: 'next-fly-academy',
      });
      // Cierra el ciclo del lead: 'intentando' -> 'compro'. Fail-open.
      await marcarComprado(payer.email_address || body.email);
      // Recibo PDF a Anny (correo + Telegram)
      const mesesNF = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      const dNF = new Date();
      await sendReceiptToAnny({
        name: payerName || body.name,
        email: payer.email_address || body.email,
        phone: payerPhone,
        amount: amountVal,
        method: 'PayPal',
        txId: (cap && cap.id) || orderID,
        date: `${dNF.getUTCDate()} ${mesesNF[dNF.getUTCMonth()]} ${dNF.getUTCFullYear()}`,
        product: 'Next Flight Academy',
      });
    }

    res.status(completed ? 200 : 500).json({
      status: completed ? 'COMPLETED' : (data.status || 'FAILED'),
      captureId: completed ? cap.id : undefined,
      details: completed ? undefined : data,
    });
  } catch (error) {
    console.error('PayPal capture-order error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

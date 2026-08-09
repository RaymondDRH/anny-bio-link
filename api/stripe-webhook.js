// Webhook de Stripe: cuando un pago con tarjeta tiene éxito, notifica la venta a Anny.
// Verifica la autenticidad consultando el PaymentIntent en la API de Stripe (anti-spoof).
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendReceiptToAnny } = require('../lib/receipt');
const { enviarCorreo, escaparHtml } = require('../lib/mailer');
const { marcarComprado } = require('../lib/leads-estado');

// Stripe: solo Telegram (Anny ya recibe el correo de su propia cuenta Stripe).
async function notifyAnny({ name, email, phone, amount, method, product }) {
  const prod = product || 'Next Flight Academy';
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = ['7832130304', '7263847739']; // Anny + Raymond
  const msg =
    `🎉 *¡Nueva venta!* — ${prod}\n\n` +
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
  // Correo interno a Anny con los datos completos del comprador (para dar acceso).
  // Critico: sin este correo, Anny sabe que hubo venta (Telegram) pero no tiene
  // los datos para dar el acceso.
  await enviarCorreo(
    {
      from: 'Anny Gómez <ventas@annygomez.com>',
      to: ['annygomezleal@gmail.com'],
      subject: `🎉 Nueva venta — ${prod} ($${amount})`,
      html:
        `<h2>¡Nueva venta! 🎉</h2>` +
        `<p><b>Producto:</b> ${escaparHtml(prod)}</p>` +
        `<p><b>Monto:</b> $${escaparHtml(amount)} USD</p>` +
        `<p><b>Método:</b> ${escaparHtml(method)}</p>` +
        `<p><b>Cliente:</b> ${escaparHtml(name) || '—'}</p>` +
        `<p><b>Correo:</b> ${escaparHtml(email) || '—'}</p>` +
        `<p><b>Teléfono:</b> ${escaparHtml(phone) || '—'}</p>`,
    },
    { critico: true, etiqueta: `aviso de venta a Anny ($${amount})` },
  );
}

// --- Correo de bienvenida al comprador (branding Next Fly) ---
function welcomeHtml(name, amount) {
  const hi = name ? (', ' + escaparHtml(name)) : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;1,500&family=Poppins:wght@300;400;500&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;font-family:'Poppins','Helvetica Neue',Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#2a0a12;border-radius:18px;overflow:hidden;border:1px solid rgba(196,154,60,0.28)"><tr><td><img src="https://annygomez.com/next-fly-banner-email.jpg" alt="Next Flight Academy" width="560" style="width:100%;display:block"></td></tr><tr><td style="padding:38px 40px 30px;text-align:center"><h1 style="margin:0 0 10px;font-family:'Playfair Display',Georgia,serif;font-size:27px;color:#e3b95a;font-weight:500">¡Te damos la bienvenida a bordo${hi}! &#9992;&#65039;</h1><p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#f5edd8">Tu compra de <strong>Next Flight Academy</strong> está <strong style="color:#e3b95a">confirmada</strong>. ¡Qué emoción tenerte en este viaje!</p><div style="background:rgba(255,255,255,0.04);border:1px solid rgba(196,154,60,0.28);border-radius:14px;padding:18px 22px;margin:4px 0 20px;text-align:left"><p style="margin:0 0 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#e3b95a">Recibo de compra</p><p style="margin:0 0 5px;font-size:14px;color:#f5edd8"><strong>Comprador:</strong> ${escaparHtml(name) || '—'}</p><p style="margin:0 0 5px;font-size:14px;color:#f5edd8"><strong>Producto:</strong> Next Flight Academy</p><p style="margin:0;font-size:14px;color:#f5edd8"><strong>Monto pagado:</strong> $${escaparHtml(amount) || '—'} USD</p></div><div style="background:rgba(196,154,60,0.10);border:1px solid rgba(196,154,60,0.25);border-radius:14px;padding:22px 26px;margin:6px 0 24px"><p style="margin:0;font-size:14px;line-height:1.7;color:#f5edd8">&#127915; Tus <strong>accesos a la plataforma</strong> se están preparando y los recibirás <strong style="color:#e3b95a">en las próximas horas</strong>. Mantente pendiente de tu correo.</p></div><p style="margin:0 0 10px;font-size:14px;color:#f5edd8">¿Tienes alguna duda? Escríbenos:</p><p style="margin:0 0 4px;font-size:14px;color:#e3b95a">&#128247; Instagram: <a href="https://instagram.com/annygomezleal" style="color:#e3b95a;text-decoration:none">@annygomezleal</a></p><p style="margin:0 0 26px;font-size:14px;color:#e3b95a">&#128172; WhatsApp: <a href="https://wa.me/12516509950" style="color:#e3b95a;text-decoration:none">+1 251 650 9950</a></p><p style="margin:0;font-size:13px;color:rgba(245,237,216,0.6)">Prepárate para despegar &#128640;</p></td></tr><tr><td style="background:#140309;padding:18px 40px;text-align:center;border-top:1px solid rgba(196,154,60,0.18)"><p style="margin:0;font-size:11px;color:rgba(245,237,216,0.45)">Anny G&oacute;mez &middot; annygomez.com</p></td></tr></table></td></tr></table></body></html>`;
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
    { critico: true, etiqueta: `bienvenida al comprador (${toEmail})` },
  );
}

module.exports = async (req, res) => {
  try {
    let event = req.body;
    if (typeof event === 'string') { try { event = JSON.parse(event); } catch (e) { event = {}; } }

    if (event && event.type === 'payment_intent.succeeded' && event.data && event.data.object) {
      const piId = event.data.object.id;
      // Verificación anti-spoof: confirmamos el PaymentIntent directo con Stripe.
      const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
      if (pi && pi.status === 'succeeded') {
        const amount = (pi.amount / 100).toFixed(2);
        const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
        const bd = charge && charge.billing_details ? charge.billing_details : {};
        await notifyAnny({
          name: bd.name,
          email: pi.receipt_email || bd.email,
          phone: bd.phone,
          amount,
          method: 'Tarjeta (Stripe)',
          product: pi.description || 'Venta',
        });
        // Correo de bienvenida + recibo PDF a Anny SOLO para Next Fly (el webhook escucha toda la cuenta)
        if ((pi.metadata && pi.metadata.product === 'next-fly-academy') || (pi.description || '').includes('Next Fl')) {
          await sendWelcome(pi.receipt_email || bd.email, bd.name, amount);
          // Cierra el ciclo del lead: pasa de 'intentando' a 'compro' para que
          // no se le escriba como si hubiera abandonado. Fail-open.
          await marcarComprado(pi.receipt_email || bd.email);
          const pmType = (charge && charge.payment_method_details && charge.payment_method_details.type) || 'card';
          const pmMap = { card: 'Tarjeta', affirm: 'Affirm', cashapp: 'Cash App', us_bank_account: 'Transferencia', link: 'Link', klarna: 'Klarna', afterpay_clearpay: 'Afterpay' };
          const mesesNF = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
          const dNF = new Date((pi.created || (Date.now() / 1000)) * 1000);
          await sendReceiptToAnny({
            name: bd.name,
            email: pi.receipt_email || bd.email,
            phone: bd.phone,
            amount,
            method: pmMap[pmType] || pmType,
            txId: (charge && charge.id) || pi.id,
            date: `${dNF.getUTCDate()} ${mesesNF[dNF.getUTCMonth()]} ${dNF.getUTCFullYear()}`,
            product: 'Next Flight Academy',
          });
        }
      }
    }
    // Siempre 200 para que Stripe no reintente indefinidamente.
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('stripe-webhook error:', error.message);
    res.status(200).json({ received: true });
  }
};

// Webhook de Stripe: cuando un pago con tarjeta tiene éxito, notifica la venta a Anny.
// Verifica la autenticidad consultando el PaymentIntent en la API de Stripe (anti-spoof).
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendReceiptToAnny } = require('../lib/receipt');
const { enviarCorreo, escaparHtml } = require('../lib/mailer');
const { marcarComprado } = require('../lib/leads-estado');

// Stripe: solo Telegram (Anny ya recibe el correo de su propia cuenta Stripe).
async function notifyAnny({ name, email, phone, amount, method, product, nota }) {
  const prod = product || 'Next Flight Academy';
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = ['7832130304', '7263847739']; // Anny + Raymond
  const msg =
    `🎉 *¡Nueva venta!* — ${prod}\n\n` +
    `💰 $${amount} USD\n` +
    `💳 Método: ${method}\n` +
    `👤 ${name || '—'}\n` +
    `✉️ ${email || '—'}\n` +
    `📱 ${phone || '—'}` +
    (nota ? `\n\n${nota}` : '');
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
        `<p><b>Teléfono:</b> ${escaparHtml(phone) || '—'}</p>` +
        (nota ? `<p style="margin-top:14px;padding:12px 14px;background:#FBF6F2;border-left:3px solid #C4855A;color:#2E1A10"><b>${escaparHtml(nota)}</b></p>` : ''),
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

// ---------------------------------------------------------------------------
// PLAN DE PAGO EN 2 PARTES
// El enlace de la clienta es su propio id de Customer. Se lo mandamos por
// correo porque el navegador no siempre lo conserva: si borra cookies, cambia
// de telefono o paga desde otro dispositivo, el correo es su unica forma de
// volver a encontrar el pago que le falta.
// ---------------------------------------------------------------------------
const PLAN_2P = '2-partes';

function enlacePlan(customerId) {
  return `https://annygomez.com/pago/?p=${encodeURIComponent(customerId)}`;
}

// Bienvenida + saldo pendiente en UN SOLO correo.
// La clienta entra a la academia desde la primera parte, asi que merece su
// bienvenida completa. Pero el correo tiene que dejar igual de claro que
// debe la segunda: si solo dijera "bienvenida", el saldo se vuelve invisible
// y nadie vuelve a pagar algo que cree terminado.
function parte1Html(name, pagado, falta, link) {
  const hi = name ? (', ' + escaparHtml(name)) : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;1,500&family=Poppins:wght@300;400;500&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;font-family:'Poppins','Helvetica Neue',Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#2a0a12;border-radius:18px;overflow:hidden;border:1px solid rgba(196,154,60,0.28)"><tr><td><img src="https://annygomez.com/next-fly-banner-email.jpg" alt="Next Flight Academy" width="560" style="width:100%;display:block"></td></tr><tr><td style="padding:38px 40px 30px;text-align:center"><h1 style="margin:0 0 10px;font-family:'Playfair Display',Georgia,serif;font-size:27px;color:#e3b95a;font-weight:500">¡Te damos la bienvenida a bordo${hi}! &#9992;&#65039;</h1><p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#f5edd8">Ya tienes tu lugar en <strong>Next Flight Academy</strong>. ¡Qué emoción tenerte en este viaje!</p><div style="background:rgba(196,154,60,0.10);border:1px solid rgba(196,154,60,0.25);border-radius:14px;padding:22px 26px;margin:0 0 24px"><p style="margin:0;font-size:14px;line-height:1.7;color:#f5edd8">&#127915; Tus <strong>accesos a la plataforma</strong> se están preparando y los recibirás <strong style="color:#e3b95a">en las próximas horas</strong>. Mantente pendiente de tu correo.</p></div><div style="height:1px;background:rgba(196,154,60,0.22);margin:0 0 24px"></div><p style="margin:0 0 14px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#e3b95a">Tu pago en 2 partes</p><table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="background:rgba(111,191,139,0.10);border:1px solid rgba(111,191,139,0.45);border-radius:12px;padding:14px 18px;text-align:left"><span style="font-size:13px;color:#6FBF8B;font-weight:600">&#10003; Primera parte &middot; $${escaparHtml(pagado)} USD &middot; PAGADA</span></td></tr><tr><td style="height:8px"></td></tr><tr><td style="background:rgba(196,154,60,0.10);border:1px solid rgba(196,154,60,0.45);border-radius:12px;padding:14px 18px;text-align:left"><span style="font-size:13px;color:#e3b95a;font-weight:600">2 &middot; Segunda parte &middot; $${escaparHtml(falta)} USD &middot; PENDIENTE</span></td></tr></table><p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#f5edd8">Para completar la segunda parte, entra aquí. <strong>Guarda este enlace</strong>: es tuyo y siempre te muestra lo que llevas pagado.</p><table cellpadding="0" cellspacing="0" style="margin:0 auto 20px"><tr><td style="background:#C49A3C;border-radius:12px"><a href="${link}" style="display:inline-block;padding:14px 30px;color:#330C15;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:.1em;text-transform:uppercase">Pagar la segunda parte</a></td></tr></table><p style="margin:0 0 26px;font-size:12px;line-height:1.6;color:rgba(245,237,216,0.55);word-break:break-all">${link}</p><p style="margin:0 0 10px;font-size:14px;color:#f5edd8">¿Tienes alguna duda? Escríbenos:</p><p style="margin:0 0 4px;font-size:14px;color:#e3b95a">&#128247; Instagram: <a href="https://instagram.com/annygomezleal" style="color:#e3b95a;text-decoration:none">@annygomezleal</a></p><p style="margin:0 0 26px;font-size:14px;color:#e3b95a">&#128172; WhatsApp: <a href="https://wa.me/12516509950" style="color:#e3b95a;text-decoration:none">+1 251 650 9950</a></p><p style="margin:0;font-size:13px;color:rgba(245,237,216,0.6)">Prepárate para despegar &#128640;</p></td></tr><tr><td style="background:#140309;padding:18px 40px;text-align:center;border-top:1px solid rgba(196,154,60,0.18)"><p style="margin:0;font-size:11px;color:rgba(245,237,216,0.45)">Anny G&oacute;mez &middot; annygomez.com</p></td></tr></table></td></tr></table></body></html>`;
}

// Cierre del plan. NO es una bienvenida: a esta clienta ya se le dio la
// bienvenida y el acceso cuando pago la primera parte. Volver a decirle
// "bienvenida a bordo" al final la trataria como recien llegada cuando
// lleva tiempo dentro. Aqui lo que corresponde es cerrar la cuenta y dar
// las gracias.
function parte2Html(name, pagado, total) {
  const hi = name ? (', ' + escaparHtml(name)) : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;1,500&family=Poppins:wght@300;400;500&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;font-family:'Poppins','Helvetica Neue',Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#2a0a12;border-radius:18px;overflow:hidden;border:1px solid rgba(196,154,60,0.28)"><tr><td><img src="https://annygomez.com/next-fly-banner-email.jpg" alt="Next Flight Academy" width="560" style="width:100%;display:block"></td></tr><tr><td style="padding:38px 40px 30px;text-align:center"><h1 style="margin:0 0 10px;font-family:'Playfair Display',Georgia,serif;font-size:27px;color:#e3b95a;font-weight:500">¡Completaste tu pago${hi}!</h1><p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#f5edd8">Recibimos tu segunda parte de <strong style="color:#e3b95a">$${escaparHtml(pagado)} USD</strong>. Con esto tu inscripción a <strong>Next Flight Academy</strong> queda <strong style="color:#e3b95a">pagada por completo</strong>. Gracias por confiar en este vuelo.</p><p style="margin:0 0 14px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#e3b95a">Resumen de tu pago</p><table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="background:rgba(111,191,139,0.10);border:1px solid rgba(111,191,139,0.45);border-radius:12px;padding:14px 18px;text-align:left"><span style="font-size:13px;color:#6FBF8B;font-weight:600">&#10003; Primera parte &middot; $${escaparHtml(pagado)} USD &middot; PAGADA</span></td></tr><tr><td style="height:8px"></td></tr><tr><td style="background:rgba(111,191,139,0.10);border:1px solid rgba(111,191,139,0.45);border-radius:12px;padding:14px 18px;text-align:left"><span style="font-size:13px;color:#6FBF8B;font-weight:600">&#10003; Segunda parte &middot; $${escaparHtml(pagado)} USD &middot; PAGADA</span></td></tr></table><table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px"><tr><td style="border-top:1px solid rgba(196,154,60,0.25);padding-top:14px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="left" style="font-size:13px;color:rgba(245,237,216,0.72)">Total pagado</td><td align="right" style="font-family:'Playfair Display',Georgia,serif;font-size:16px;color:#f5edd8">$${escaparHtml(total)} USD</td></tr></table></td></tr></table><p style="margin:0 0 10px;font-size:14px;color:#f5edd8">¿Tienes alguna duda? Escríbenos:</p><p style="margin:0 0 4px;font-size:14px;color:#e3b95a">&#128247; Instagram: <a href="https://instagram.com/annygomezleal" style="color:#e3b95a;text-decoration:none">@annygomezleal</a></p><p style="margin:0 0 26px;font-size:14px;color:#e3b95a">&#128172; WhatsApp: <a href="https://wa.me/12516509950" style="color:#e3b95a;text-decoration:none">+1 251 650 9950</a></p><p style="margin:0;font-size:13px;color:rgba(245,237,216,0.6)">Nos vemos dentro &#128640;</p></td></tr><tr><td style="background:#140309;padding:18px 40px;text-align:center;border-top:1px solid rgba(196,154,60,0.18)"><p style="margin:0;font-size:11px;color:rgba(245,237,216,0.45)">Anny G&oacute;mez &middot; annygomez.com</p></td></tr></table></td></tr></table></body></html>`;
}

async function sendParte2(toEmail, name, pagado, total) {
  if (!toEmail) return { ok: false, intentos: 0, motivo: 'sin_destinatario' };
  return enviarCorreo(
    {
      from: 'Anny Gómez <ventas@annygomez.com>',
      to: [toEmail],
      subject: '✈️ ¡Completaste tu pago! — Next Flight Academy',
      html: parte2Html(name, pagado, total),
    },
    { critico: true, etiqueta: `parte 2 de 2 al comprador (${toEmail})` },
  );
}

async function sendParte1(toEmail, name, pagado, falta, link) {
  if (!toEmail) return { ok: false, intentos: 0, motivo: 'sin_destinatario' };
  // Critico: sin este correo la clienta no tiene forma de volver a su enlace
  // y la segunda parte no se cobra nunca.
  return enviarCorreo(
    {
      from: 'Anny Gómez <ventas@annygomez.com>',
      to: [toEmail],
      subject: '✈️ ¡Te damos la bienvenida a bordo! — aquí completas tu segunda parte',
      html: parte1Html(name, pagado, falta, link),
    },
    { critico: true, etiqueta: `parte 1 de 2 al comprador (${toEmail})` },
  );
}

module.exports = async (req, res) => {
  try {
    let event = req.body;
    if (typeof event === 'string') { try { event = JSON.parse(event); } catch (e) { event = {}; } }

    if (event && event.type === 'payment_intent.succeeded' && event.data && event.data.object) {
      const piId = event.data.object.id;
      // Verificación anti-spoof: confirmamos el PaymentIntent directo con Stripe.
      // Se expande tambien el customer: en el plan de 2 partes los datos de la
      // clienta viven ahi, y billing_details puede venir vacio.
      const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge', 'customer'] });
      if (pi && pi.status === 'succeeded') {
        const amount = (pi.amount / 100).toFixed(2);
        const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
        const bd = charge && charge.billing_details ? charge.billing_details : {};
        const cust = pi.customer && typeof pi.customer === 'object' && !pi.customer.deleted ? pi.customer : null;
        const custId = cust ? cust.id : (typeof pi.customer === 'string' ? pi.customer : '');

        const nombre = bd.name || (cust && cust.name) || '';
        const correo = pi.receipt_email || bd.email || (cust && cust.email) || '';
        const telefono = bd.phone || (cust && cust.phone) || '';

        // Parte del plan de 2 pagos (0 = compra normal de contado).
        const parte = (pi.metadata && pi.metadata.plan === PLAN_2P) ? Number(pi.metadata.parte || 0) : 0;
        // El total se calcula del monto real, no se escribe fijo: en un plan de
        // prueba de $1 un "$697" a mano seria mentira en el correo y en el recibo.
        const totalPlan = (Number(amount) * 2).toFixed(2);
        const nota = parte === 1
          ? `PAGO EN 2 PARTES — pagó la 1ra de 2. Le falta $${amount} USD.`
          : (parte === 2 ? `PAGO EN 2 PARTES — completó el pago ($${totalPlan} USD en total).` : '');

        await notifyAnny({
          name: nombre,
          email: correo,
          phone: telefono,
          amount,
          method: 'Tarjeta (Stripe)',
          product: pi.description || 'Venta',
          nota,
        });
        // Correo de bienvenida + recibo PDF a Anny SOLO para Next Fly (el webhook escucha toda la cuenta)
        if ((pi.metadata && pi.metadata.product === 'next-fly-academy') || (pi.description || '').includes('Next Fl')) {
          if (parte === 1) {
            // Ojo: NO va la bienvenida normal. Diria "tu compra esta confirmada"
            // y aun debe la mitad. Va el correo de la 1ra parte con su enlace.
            await sendParte1(correo, nombre, amount, amount, enlacePlan(custId));
          } else if (parte === 2) {
            // Cierre, NO bienvenida: ya fue recibida en la primera parte.
            await sendParte2(correo, nombre, amount, totalPlan);
          } else {
            await sendWelcome(correo, nombre, amount);
          }
          // Cierra el ciclo del lead: pasa de 'intentando' a 'compro' para que
          // no se le escriba como si hubiera abandonado. Fail-open.
          await marcarComprado(correo);
          const pmType = (charge && charge.payment_method_details && charge.payment_method_details.type) || 'card';
          const pmMap = { card: 'Tarjeta', affirm: 'Affirm', cashapp: 'Cash App', us_bank_account: 'Transferencia', link: 'Link', klarna: 'Klarna', afterpay_clearpay: 'Afterpay' };
          const mesesNF = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
          const dNF = new Date((pi.created || (Date.now() / 1000)) * 1000);
          await sendReceiptToAnny({
            name: nombre,
            email: correo,
            phone: telefono,
            amount,
            method: pmMap[pmType] || pmType,
            txId: (charge && charge.id) || pi.id,
            date: `${dNF.getUTCDate()} ${mesesNF[dNF.getUTCMonth()]} ${dNF.getUTCFullYear()}`,
            // El recibo debe decir QUE se pago. Poner "Next Flight Academy" a
            // secas en un pago de $348.50 haria pensar que el curso costo eso.
            product: parte ? `Next Flight Academy — parte ${parte} de 2` : 'Next Flight Academy',
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

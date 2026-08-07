// Genera el recibo en PDF (branding Anny) y lo envía a Anny por correo + Telegram.
// Módulo compartido (fuera de /api para NO contar como función serverless).
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { enviarCorreo } = require('./mailer');

const COPPER = rgb(0.769, 0.522, 0.353); // #C4855A
const ESPRESSO = rgb(0.18, 0.102, 0.063); // #2E1A10
const TOPO = rgb(0.549, 0.416, 0.345); // #8C6A58
const CREAM = rgb(0.984, 0.965, 0.949); // #FBF6F2
const NUDE = rgb(0.91, 0.851, 0.804); // #E8D9CD
const WHITE = rgb(1, 1, 1);

// Enlace de afiliada de Anny para registrar al comprador en la academia (dueña: Daniela Patiño).
const AFFILIATE_LINK = 'https://daniela-patino.mykajabi.com/offers/WyVYd33B/checkout?cid=8b751b5e-9726-461f-a2dd-95f702cffd4f';

function clean(s) {
  // pdf-lib (WinAnsi) no soporta emojis; dejamos texto seguro.
  return String(s == null ? '' : s).replace(/[^\x00-\xFF]/g, '').trim() || '-';
}

async function buildReceiptPDF(data) {
  const name = clean(data.name);
  const amount = clean(data.amount);
  const method = clean(data.method);
  const txId = clean(data.txId);
  const date = clean(data.date);
  const email = clean(data.email);
  const phone = clean(data.phone);
  const product = clean(data.product || 'Next Flight Academy');

  const doc = await PDFDocument.create();
  const W = 420, H = 560;
  const page = doc.addPage([W, H]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifB = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansB = await doc.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: CREAM });

  // Encabezado con degradado cobre -> crema y borde inferior diagonal (estilo Stripe)
  const agFont = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const STRIPS = 150;
  for (let i = 0; i < STRIPS; i++) {
    const t = i / (STRIPS - 1);
    const col = rgb(0.769 + (0.984 - 0.769) * t, 0.522 + (0.965 - 0.522) * t, 0.353 + (0.949 - 0.353) * t);
    const h = 122 - 36 * t; // más alto a la izquierda -> diagonal hacia la derecha
    const sw = W / STRIPS;
    page.drawRectangle({ x: i * sw, y: H - h, width: sw + 0.8, height: h, color: col });
  }

  // Monograma AG con doble anillo, montado sobre el degradado
  const cx = W / 2, cy = H - 94;
  page.drawEllipse({ x: cx, y: cy, xScale: 34, yScale: 34, color: WHITE, borderColor: COPPER, borderWidth: 1.4 });
  page.drawEllipse({ x: cx, y: cy, xScale: 28, yScale: 28, borderColor: COPPER, borderWidth: 0.6 });
  const agW = agFont.widthOfTextAtSize('AG', 23);
  page.drawText('AG', { x: cx - agW / 2, y: cy - 8, size: 23, font: agFont, color: COPPER });

  const center = (text, y, font, size, color) => {
    const t = clean(text);
    const tw = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: (W - tw) / 2, y, size, font, color });
  };

  let y = H - 150;
  center('Recibo de Anny Carolina Gómez de Reyes', y, serif, 14, ESPRESSO); y -= 18;
  center(product, y, sans, 10, TOPO); y -= 34;

  // Monto pagado + fecha (estilo Stripe)
  page.drawText('MONTO PAGADO', { x: 42, y, size: 8, font: sansB, color: TOPO });
  page.drawText('FECHA', { x: 250, y, size: 8, font: sansB, color: TOPO });
  y -= 17;
  page.drawText('$' + amount + ' USD', { x: 42, y, size: 15, font: serifB, color: ESPRESSO });
  page.drawText(date, { x: 250, y, size: 12, font: sans, color: ESPRESSO });
  y -= 28;

  page.drawLine({ start: { x: 42, y }, end: { x: W - 42, y }, thickness: 1, color: NUDE });
  y -= 22;

  page.drawText('DETALLE DE LA COMPRA', { x: 42, y, size: 8, font: sansB, color: COPPER });
  y -= 20;

  const row = (label, value) => {
    page.drawText(label, { x: 42, y, size: 10, font: sans, color: TOPO });
    const v = clean(value);
    const vw = sansB.widthOfTextAtSize(v, 10);
    const maxX = W - 42;
    page.drawText(v, { x: Math.max(180, maxX - vw), y, size: 10, font: sansB, color: ESPRESSO });
    y -= 19;
  };
  row('Producto', product);
  row('Comprador', name);
  if (email !== '-') row('Correo', email);
  if (phone !== '-') row('Teléfono', phone);
  row('Método de pago', method);
  row('ID de transacción', txId);

  y -= 6;
  page.drawLine({ start: { x: 42, y }, end: { x: W - 42, y }, thickness: 1, color: NUDE });
  y -= 24;
  page.drawText('Monto pagado', { x: 42, y, size: 12, font: sansB, color: ESPRESSO });
  const tot = '$' + amount + ' USD';
  const totW = serifB.widthOfTextAtSize(tot, 17);
  page.drawText(tot, { x: W - 42 - totW, y: y - 2, size: 17, font: serifB, color: COPPER });

  center('Instagram @annygomezleal   ·   WhatsApp +1 251 650 9950', 62, sans, 8.5, TOPO);
  center('Anny Gómez   ·   © 2026', 44, sans, 8.5, TOPO);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

function safeFile(name) {
  return 'recibo-' + String(name || 'compra').normalize('NFD').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') + '.pdf';
}

function receiptEmailHtml({ name, email, phone, amount, txId, method }) {
  return (
    '<div style="font-family:Poppins,Helvetica,Arial,sans-serif;background:#FBF6F2;padding:24px">' +
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #E8D9CD;border-radius:16px;overflow:hidden">' +
    '<div style="background:#C4855A;padding:16px 26px"><span style="color:#ffffff;font-size:16px;font-weight:600;font-family:Georgia,serif">Pago recibido &middot; Next Flight Academy</span></div>' +
    '<div style="padding:24px 26px">' +
    '<p style="margin:0 0 16px;color:#2E1A10;font-size:14px;line-height:1.6">Se registr&oacute; un nuevo pago. Datos del comprador:</p>' +
    '<table style="width:100%;font-size:14px;color:#2E1A10;border-collapse:collapse">' +
    `<tr><td style="padding:5px 0;color:#8C6A58">Comprador</td><td style="text-align:right;font-weight:600">${name || '-'}</td></tr>` +
    `<tr><td style="padding:5px 0;color:#8C6A58">Correo</td><td style="text-align:right;font-weight:600">${email || '-'}</td></tr>` +
    `<tr><td style="padding:5px 0;color:#8C6A58">Tel&eacute;fono</td><td style="text-align:right;font-weight:600">${phone || '-'}</td></tr>` +
    `<tr><td style="padding:5px 0;color:#8C6A58">Monto</td><td style="text-align:right;font-weight:600">$${amount} USD</td></tr>` +
    `<tr><td style="padding:5px 0;color:#8C6A58">M&eacute;todo</td><td style="text-align:right;font-weight:600">${method || '-'}</td></tr>` +
    `<tr><td style="padding:5px 0;color:#8C6A58">Transacci&oacute;n</td><td style="text-align:right;font-weight:600;font-size:12px">${txId || '-'}</td></tr>` +
    '</table>' +
    '<div style="background:#FBF6F2;border:1px solid #E8D9CD;border-radius:12px;padding:18px;margin:22px 0 8px;text-align:center">' +
    '<p style="margin:0 0 14px;color:#2E1A10;font-size:13.5px;line-height:1.6">Registra a esta persona en la academia para darle acceso, desde tu enlace de afiliada:</p>' +
    `<a href="${AFFILIATE_LINK}" style="display:inline-block;background:#C4855A;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:13px 26px;border-radius:999px">Registrar al cliente en la academia &rarr;</a>` +
    '</div>' +
    '<p style="margin:14px 0 0;color:#8C6A58;font-size:12.5px">Adjunto encontrar&aacute;s el recibo en PDF.</p>' +
    '</div></div></div>'
  );
}

async function sendReceiptEmail(pdfBuffer, data) {
  // Critico: lleva el comprobante de un cobro. Si no sale, hay que enterarse.
  return enviarCorreo(
    {
      from: 'Anny Gomez <ventas@annygomez.com>',
      to: ['annygomezleal@gmail.com'],
      subject: `Pago recibido — ${data.name || 'Nuevo cliente'} ($${data.amount})`,
      html: receiptEmailHtml(data),
      attachments: [{ filename: safeFile(data.name), content: pdfBuffer.toString('base64') }],
    },
    { critico: true, etiqueta: `recibo con PDF ($${data.amount})` },
  );
}

async function sendReceiptTelegram(pdfBuffer, { name, amount, method, txId }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const chatIds = ['7832130304', '7263847739']; // Anny + Raymond
  const caption =
    `Pago recibido - Next Flight Academy\n` +
    `Comprador: ${name || '-'}\n` +
    `Monto: $${amount} USD\n` +
    `Metodo: ${method || '-'}\n` +
    `Transaccion: ${txId || '-'}\n\n` +
    `Registrar al cliente en la academia:\n${AFFILIATE_LINK}`;
  for (const chatId of chatIds) {
    const boundary = '----NFB' + Math.random().toString(16).slice(2) + Date.now().toString(16);
    const pre = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${safeFile(name)}"\r\nContent-Type: application/pdf\r\n\r\n`,
      'utf8'
    );
    const post = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const body = Buffer.concat([pre, pdfBuffer, post]);
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });
    } catch (e) { console.error('receipt telegram', e.message); }
  }
}

// Punto de entrada: arma el PDF y lo envía a Anny (correo + Telegram). No bloqueante.
async function sendReceiptToAnny(data) {
  try {
    const pdf = await buildReceiptPDF(data);
    await Promise.allSettled([
      sendReceiptEmail(pdf, data),
      sendReceiptTelegram(pdf, data),
    ]);
  } catch (e) { console.error('sendReceiptToAnny', e.message); }
}

module.exports = { buildReceiptPDF, sendReceiptToAnny, receiptEmailHtml };

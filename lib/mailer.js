// Envio de correo con Resend, verificando de verdad que salio.
//
// EL PROBLEMA QUE RESUELVE
// `fetch` NO lanza excepcion ante un error HTTP. Si Resend responde 429
// (su limite es 10 peticiones/segundo por equipo, compartido entre TODAS
// las claves), la promesa resuelve con normalidad y un `try/catch` no se
// entera de nada. Sin mirar `res.ok`, un correo perdido es invisible:
// no llega, no se registra, y nadie lo nota — porque la ausencia de un
// correo no se ve.
//
// COMO SE USA
//   critico: true   -> reintenta ante 429/5xx y avisa por Telegram si no sale.
//                      Para lo que involucra dinero: recibos, accesos, ventas.
//   critico: false  -> un solo intento. Si la cuota esta apretada, este cede
//                      el paso. Para lo prescindible: resultado del quiz.
//
// GARANTIA: esta funcion NUNCA lanza. Un fallo al enviar un correo jamas
// puede tumbar un webhook de pago ni impedir que alguien complete una compra.

const RESEND_URL = 'https://api.resend.com/emails';
const TELEGRAM_CHAT_IDS = ['7832130304', '7263847739']; // Anny + Raymond

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Sin parse_mode a proposito: un nombre con guion bajo o asterisco romperia
// el Markdown de Telegram y perderiamos justo la alerta que importa.
async function avisarTelegram(texto) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  let alguno = false;
  for (const chatId of TELEGRAM_CHAT_IDS) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: texto }),
      });
      if (r.ok) alguno = true;
    } catch (e) {
      console.error('[mailer] telegram:', e.message);
    }
  }
  return alguno;
}

/**
 * @param {object} payload  cuerpo tal cual lo espera la API de Resend
 * @param {object} opciones { critico, etiqueta, intentos }
 * @returns {Promise<{ok:boolean, intentos:number, motivo?:string}>}
 */
async function enviarCorreo(payload, opciones = {}) {
  const critico = opciones.critico === true;
  const etiqueta = opciones.etiqueta || 'correo';
  const intentos = opciones.intentos || (critico ? 3 : 1);

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error(`[mailer] ${etiqueta}: falta RESEND_API_KEY`);
    return { ok: false, intentos: 0, motivo: 'sin_clave' };
  }

  let motivo = 'desconocido';

  for (let i = 1; i <= intentos; i++) {
    try {
      const r = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (r.ok) {
        if (i > 1) console.log(`[mailer] ${etiqueta}: enviado en el intento ${i}`);
        return { ok: true, intentos: i };
      }

      const cuerpo = await r.text().catch(() => '');
      motivo = `HTTP ${r.status} ${cuerpo.slice(0, 200)}`;

      // 4xx que no sea 429 es un error nuestro (destinatario invalido,
      // dominio no verificado...). Reintentar no lo va a arreglar.
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) {
      motivo = `red: ${e.message}`;
    }

    // 500ms, 1s, 2s — el limite por segundo de Resend se libera enseguida.
    if (i < intentos) await dormir(500 * Math.pow(2, i - 1));
  }

  console.error(`[mailer] ${etiqueta} FALLO tras ${intentos} intento(s):`, motivo);

  if (critico) {
    const destino = Array.isArray(payload.to) ? payload.to.join(', ') : String(payload.to || '?');
    await avisarTelegram(
      `⚠️ CORREO NO ENVIADO\n\n` +
        `Tipo: ${etiqueta}\n` +
        `Para: ${destino}\n` +
        `Asunto: ${payload.subject || '—'}\n` +
        `Motivo: ${motivo}\n\n` +
        `La operacion SI se completo. Falta solo el correo: escribele a mano.`,
    );
  }

  return { ok: false, intentos, motivo };
}

// Todo dato que venga del comprador y entre en una plantilla de correo pasa
// por aqui. Sin esto, un nombre con <a href="..."> sale como enlace clicable
// en un correo firmado con el SPF/DKIM de annygomez.com.
function escaparHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = { enviarCorreo, avisarTelegram, escaparHtml };

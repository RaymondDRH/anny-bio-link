// Correo de bienvenida, cuando la persona YA confirmó.
//
// ─────────────────────────────────────────────────────────────────────────
// QUÉ ES ESTO
//
// Ghost llama aquí por webhook (evento `member.added`) en el momento en que
// alguien pulsa el enlace de confirmación y pasa a ser miembro de verdad.
//
// Antes este correo lo mandaba api/subscribe.js nada más recibir la dirección
// —es decir, ANTES de que la persona confirmara— y solo si entraba por el
// bio-link. Quien se suscribía desde el blog no recibía nada.
//
// Ahora da igual por dónde entre: confirma, Ghost avisa aquí, y sale la
// bienvenida. Una sola puerta.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ NO HAY SECRETO COMPARTIDO
//
// Este endpoint es público: cualquiera puede llamarlo. Sin comprobar nada
// sería un generador de spam — bastaría con mandar POSTs con direcciones
// ajenas para que salieran correos firmados por Anny.
//
// En vez de un secreto (que habría que crear, guardar en Vercel y rotar),
// se comprueba contra la propia fuente: se pregunta a Ghost si ese miembro
// existe DE VERDAD. Un atacante puede inventarse un correo en el cuerpo de
// la petición, pero no puede inventarse un miembro que exista en Ghost.
//
// Y se exige además que se haya creado hace poco, para que un webhook
// reenviado días después no vuelva a saludar a nadie.
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { enviarCorreo } = require('../lib/mailer');

const GHOST_KEY = process.env.GHOST_ADMIN_KEY;
const GHOST_URL = 'https://blog.annygomez.com/ghost/api/admin';

// Cuánto margen se da entre que Ghost crea al miembro y llega esta llamada.
// Diez minutos sobra para cualquier reintento razonable y cierra la puerta a
// reenviar un webhook viejo.
const MINUTOS_DE_GRACIA = 10;

const WELCOME_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#FBF6F2;font-family:Georgia,serif"><div style="max-width:560px;margin:0 auto;background:#fff"><div style="background:#FBF6F2;padding:36px 40px 24px;text-align:center;border-bottom:1px solid #E8D9CD"><div style="font-family:Georgia,serif;font-size:28px;color:#2E1A10;letter-spacing:0.04em">Anny G&oacute;mez</div><div style="font-size:12px;color:#8C6A58;letter-spacing:0.12em;text-transform:uppercase;margin-top:6px">Fe &middot; H&aacute;bitos &middot; Prop&oacute;sito</div></div><div style="padding:40px 40px 32px"><p style="font-size:22px;color:#2E1A10;margin:0 0 20px">&iexcl;Bienvenida a la comunidad!</p><p style="font-size:15px;line-height:1.7;color:#4a3020;margin:0 0 16px">Qu&eacute; alegr&iacute;a tenerte aqu&iacute;. Cada viernes vas a recibir una reflexi&oacute;n sobre Fe, h&aacute;bitos y prop&oacute;sito &mdash; pensada para mujeres que quieren crecer con intenci&oacute;n.</p><p style="font-size:15px;line-height:1.7;color:#4a3020;margin:0 0 16px">No es spam. No son listas de consejos vac&iacute;os. Es lo que vivo, aprendo y practico cada semana.</p><div style="background:#FBF6F2;border-radius:8px;padding:24px 28px;margin:24px 0"><h3 style="margin:0 0 14px;font-size:14px;letter-spacing:0.1em;text-transform:uppercase;color:#8C6A58">Qu&eacute; esperar</h3><ul style="margin:0;padding:0 0 0 18px"><li style="font-size:14px;color:#4a3020;line-height:1.8;margin-bottom:4px">Una reflexi&oacute;n semanal cada viernes</li><li style="font-size:14px;color:#4a3020;line-height:1.8;margin-bottom:4px">Recursos pr&aacute;cticos de Fe y organizaci&oacute;n</li><li style="font-size:14px;color:#4a3020;line-height:1.8;margin-bottom:4px">Acceso anticipado a gu&iacute;as y retos</li></ul></div><p style="font-size:15px;line-height:1.7;color:#4a3020;margin:0 0 16px">Mientras tanto, te invito a leer el blog:</p><div style="text-align:center;margin:32px 0 24px"><a href="https://blog.annygomez.com" style="display:inline-block;background:#C4855A;color:#fff;text-decoration:none;padding:14px 32px;border-radius:4px;font-size:14px;letter-spacing:0.06em;text-transform:uppercase">Leer el blog</a></div><hr style="border:none;border-top:1px solid #E8D9CD;margin:28px 0"><p style="font-size:13px;color:#8C6A58;margin:0">Con cari&ntilde;o,<br><strong style="font-family:Georgia,serif;font-size:16px;color:#2E1A10">Anny G&oacute;mez</strong></p></div><div style="background:#FBF6F2;padding:24px 40px;text-align:center;border-top:1px solid #E8D9CD"><p style="font-size:12px;color:#8C6A58;margin:0;line-height:1.6">Recibiste este correo porque confirmaste tu suscripci&oacute;n en <a href="https://annygomez.com" style="color:#8C6A58">annygomez.com</a><br>&copy; 2026 Anny G&oacute;mez &middot; Todos los derechos reservados</p></div></div></body></html>`;

function ghostToken() {
  const [id, secret] = GHOST_KEY.split(':');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Ghost manda { member: { current: {...}, previous: {...} } }
  const miembro = req.body?.member?.current;
  const id = miembro?.id;
  const correo = (miembro?.email || '').trim().toLowerCase();

  if (!id || !correo) {
    return res.status(400).json({ error: 'Payload sin miembro' });
  }

  try {
    // ── La comprobación que hace segura esta ruta ────────────────────────
    // Se le pregunta a Ghost por ese id. Si no existe, alguien se lo inventó.
    const verificacion = await fetch(`${GHOST_URL}/members/${encodeURIComponent(id)}/`, {
      headers: { Authorization: `Ghost ${ghostToken()}` },
    });

    if (!verificacion.ok) {
      console.warn(`[member-added] id ${id} no existe en Ghost (${verificacion.status}) — se ignora`);
      return res.status(202).json({ ignorado: 'miembro no encontrado' });
    }

    const real = (await verificacion.json())?.members?.[0];

    // El correo del cuerpo tiene que coincidir con el de Ghost. Si no, alguien
    // cogió un id válido e intentó dirigir el correo a otra dirección.
    if ((real?.email || '').toLowerCase() !== correo) {
      console.warn('[member-added] el correo no coincide con el del miembro — se ignora');
      return res.status(202).json({ ignorado: 'correo no coincide' });
    }

    const creado = new Date(real.created_at).getTime();
    const minutos = (Date.now() - creado) / 60000;

    if (!Number.isFinite(minutos) || minutos > MINUTOS_DE_GRACIA) {
      console.warn(`[member-added] ${correo} se creó hace ${Math.round(minutos)} min — se ignora`);
      return res.status(202).json({ ignorado: 'fuera de plazo' });
    }

    // ── Ahora sí ─────────────────────────────────────────────────────────
    // `critico: true` reintenta ante 429/5xx y avisa por Telegram si no sale.
    // Es el primer correo de la relación: si se pierde, la persona confirmó
    // y no recibió nada.
    await enviarCorreo(
      {
        from: 'Anny Gómez <hola@annygomez.com>',
        to: [correo],
        subject: '¡Bienvenida! Tu primera reflexión llega el viernes ✦',
        html: WELCOME_HTML,
      },
      { critico: true, etiqueta: `bienvenida a la comunidad (${correo})` },
    );

    console.log(`[member-added] bienvenida enviada a ${correo}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[member-added] error:', err.message);
    // 200 a propósito: si se devuelve un error, Ghost reintenta el webhook y
    // la persona podría acabar recibiendo la bienvenida varias veces. Ya se
    // avisa por Telegram desde el mailer cuando un correo crítico no sale.
    return res.status(200).json({ error: err.message });
  }
};

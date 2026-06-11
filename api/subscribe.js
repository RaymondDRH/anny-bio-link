const crypto = require('crypto');

const GHOST_KEY = process.env.GHOST_ADMIN_KEY;
const GHOST_URL = 'https://blog.annygomez.com/ghost/api/admin';
const RESEND_KEY = process.env.RESEND_API_KEY;

const WELCOME_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#FBF6F2;font-family:Georgia,serif"><div style="max-width:560px;margin:0 auto;background:#fff"><div style="background:#FBF6F2;padding:36px 40px 24px;text-align:center;border-bottom:1px solid #E8D9CD"><div style="font-family:Georgia,serif;font-size:28px;color:#2E1A10;letter-spacing:0.04em">Anny G&oacute;mez</div><div style="font-size:12px;color:#8C6A58;letter-spacing:0.12em;text-transform:uppercase;margin-top:6px">Fe &middot; H&aacute;bitos &middot; Prop&oacute;sito</div></div><div style="padding:40px 40px 32px"><p style="font-size:22px;color:#2E1A10;margin:0 0 20px">&iexcl;Bienvenida a la comunidad!</p><p style="font-size:15px;line-height:1.7;color:#4a3020;margin:0 0 16px">Qu&eacute; alegr&iacute;a tenerte aqu&iacute;. Cada viernes vas a recibir una reflexi&oacute;n sobre Fe, h&aacute;bitos y prop&oacute;sito &mdash; pensada para mujeres que quieren crecer con intenci&oacute;n.</p><p style="font-size:15px;line-height:1.7;color:#4a3020;margin:0 0 16px">No es spam. No son listas de consejos vac&iacute;os. Es lo que vivo, aprendo y practico cada semana.</p><div style="background:#FBF6F2;border-radius:8px;padding:24px 28px;margin:24px 0"><h3 style="margin:0 0 14px;font-size:14px;letter-spacing:0.1em;text-transform:uppercase;color:#8C6A58">Qu&eacute; esperar</h3><ul style="margin:0;padding:0 0 0 18px"><li style="font-size:14px;color:#4a3020;line-height:1.8;margin-bottom:4px">Una reflexi&oacute;n semanal cada viernes</li><li style="font-size:14px;color:#4a3020;line-height:1.8;margin-bottom:4px">Recursos pr&aacute;cticos de Fe y organizaci&oacute;n</li><li style="font-size:14px;color:#4a3020;line-height:1.8;margin-bottom:4px">Acceso anticipado a gu&iacute;as y retos</li></ul></div><p style="font-size:15px;line-height:1.7;color:#4a3020;margin:0 0 16px">Mientras tanto, te invito a leer el blog:</p><div style="text-align:center;margin:32px 0 24px"><a href="https://blog.annygomez.com" style="display:inline-block;background:#C4855A;color:#fff;text-decoration:none;padding:14px 32px;border-radius:4px;font-size:14px;letter-spacing:0.06em;text-transform:uppercase">Leer el blog</a></div><hr style="border:none;border-top:1px solid #E8D9CD;margin:28px 0"><p style="font-size:13px;color:#8C6A58;margin:0">Con cari&ntilde;o,<br><strong style="font-family:Georgia,serif;font-size:16px;color:#2E1A10">Anny G&oacute;mez</strong></p></div><div style="background:#FBF6F2;padding:24px 40px;text-align:center;border-top:1px solid #E8D9CD"><p style="font-size:12px;color:#8C6A58;margin:0;line-height:1.6">Recibiste este correo porque te suscribiste en <a href="https://annygomez.com" style="color:#8C6A58">annygomez.com</a><br>&copy; 2026 Anny G&oacute;mez &middot; Todos los derechos reservados</p></div></div></body></html>`;

async function sendWelcomeEmail(email) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: 'Anny Gómez <hola@annygomez.com>',
      to: [email],
      subject: '¡Bienvenida! Tu primera reflexión llega el viernes ✦',
      html: WELCOME_HTML,
    }),
  });
}

function ghostToken() {
  const [id, secret] = GHOST_KEY.split(':');
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email?.trim()) return res.status(400).json({ error: 'El correo es requerido' });

  try {
    const response = await fetch(`${GHOST_URL}/members/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Ghost ${ghostToken()}`,
      },
      body: JSON.stringify({ members: [{ email: email.trim(), subscribed: true }] }),
    });

    const data = await response.json();

    if (!response.ok) {
      const msg = data.errors?.[0]?.message || '';
      if (msg.toLowerCase().includes('already')) {
        return res.json({ success: true, alreadyRegistered: true });
      }
      return res.status(500).json({ error: msg || 'Error al suscribirse' });
    }

    sendWelcomeEmail(email.trim()).catch(err =>
      console.error('[subscribe] Welcome email error:', err)
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

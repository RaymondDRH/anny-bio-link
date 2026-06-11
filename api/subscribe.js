const crypto = require('crypto');

const GHOST_KEY = process.env.GHOST_ADMIN_KEY;
const GHOST_URL = 'https://blog.annygomez.com/ghost/api/admin';

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

    // Miembro ya existe — igual es éxito
    if (!response.ok) {
      const msg = data.errors?.[0]?.message || '';
      if (msg.toLowerCase().includes('already')) {
        return res.json({ success: true, alreadyRegistered: true });
      }
      return res.status(500).json({ error: msg || 'Error al suscribirse' });
    }

    // Enviar correo de bienvenida via Brevo API
    const welcomeHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:0;background:#FBF6F2;font-family:Georgia,serif;color:#2E1A10}.wrap{max-width:560px;margin:0 auto;background:#fff}.header{background:#FBF6F2;padding:36px 40px 24px;text-align:center;border-bottom:1px solid #E8D9CD}.logo{font-family:Georgia,serif;font-size:28px;color:#2E1A10;letter-spacing:0.04em}.tagline{font-size:12px;color:#8C6A58;letter-spacing:0.12em;text-transform:uppercase;margin-top:6px}.body{padding:40px 40px 32px}.greeting{font-size:22px;color:#2E1A10;margin:0 0 20px}p{font-size:15px;line-height:1.7;color:#4a3020;margin:0 0 16px}.divider{border:none;border-top:1px solid #E8D9CD;margin:28px 0}.what-to-expect{background:#FBF6F2;border-radius:8px;padding:24px 28px;margin:24px 0}.what-to-expect h3{margin:0 0 14px;font-size:14px;letter-spacing:0.1em;text-transform:uppercase;color:#8C6A58}.what-to-expect ul{margin:0;padding:0 0 0 18px}.what-to-expect li{font-size:14px;color:#4a3020;line-height:1.8;margin-bottom:4px}.cta-wrap{text-align:center;margin:32px 0 24px}.cta{display:inline-block;background:#C4855A;color:#fff;text-decoration:none;padding:14px 32px;border-radius:4px;font-size:14px;letter-spacing:0.06em;text-transform:uppercase}.footer{background:#FBF6F2;padding:24px 40px;text-align:center;border-top:1px solid #E8D9CD}.footer p{font-size:12px;color:#8C6A58;margin:0;line-height:1.6}.footer a{color:#8C6A58}</style></head><body><div class="wrap"><div class="header"><div class="logo">Anny Gómez</div><div class="tagline">Fe &middot; Hábitos &middot; Propósito</div></div><div class="body"><p class="greeting">¡Bienvenida a la comunidad!</p><p>Qué alegría tenerte aquí. Cada viernes vas a recibir una reflexión sobre Fe, hábitos y propósito — pensada para mujeres que quieren crecer con intención.</p><p>No es spam. No son listas de consejos vacíos. Es lo que vivo, aprendo y practico cada semana.</p><div class="what-to-expect"><h3>Qué esperar</h3><ul><li>Una reflexión semanal cada viernes</li><li>Recursos prácticos de Fe y organización</li><li>Acceso anticipado a guías y retos</li></ul></div><p>Mientras tanto, te invito a leer el blog:</p><div class="cta-wrap"><a class="cta" href="https://blog.annygomez.com">Leer el blog</a></div><hr class="divider"><p style="font-size:13px;color:#8C6A58">Con cariño,<br><strong style="font-family:Georgia,serif;font-size:16px;color:#2E1A10">Anny Gómez</strong></p></div><div class="footer"><p>Recibiste este correo porque te suscribiste en <a href="https://blog.annygomez.com">blog.annygomez.com</a><br>&copy; 2026 Anny G&oacute;mez &middot; Todos los derechos reservados</p></div></div></body></html>';

    fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: 'Anny Gómez', email: 'hola@annygomez.com' },
        to: [{ email: email.trim() }],
        subject: '¡Bienvenida! Tu primera reflexión llega el viernes ✦',
        htmlContent: welcomeHtml,
      }),
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

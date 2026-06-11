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

    if (!response.ok) {
      const msg = data.errors?.[0]?.message || '';
      if (msg.toLowerCase().includes('already')) {
        return res.json({ success: true, alreadyRegistered: true });
      }
      return res.status(500).json({ error: msg || 'Error al suscribirse' });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

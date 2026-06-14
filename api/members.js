const crypto = require('crypto');

const GHOST_KEY = process.env.GHOST_ADMIN_KEY;
const GHOST_URL = 'https://blog.annygomez.com/ghost/api/admin';
const SECRET = process.env.MEMBERS_SECRET || 'n8n-anny-2026';

function ghostToken() {
  const [id, secret] = GHOST_KEY.split(':');
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers['x-secret'];
  if (auth !== SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const response = await fetch(`${GHOST_URL}/members/?limit=all&filter=subscribed:true`, {
      headers: { 'Authorization': `Ghost ${ghostToken()}` },
    });
    const data = await response.json();
    const members = (data.members || []).map(m => ({ email: m.email, name: m.name }));
    res.json({ members, total: members.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

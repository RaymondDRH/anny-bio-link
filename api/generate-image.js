const crypto = require('crypto');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;
const GHOST_URL = 'https://blog.annygomez.com';
const API_SECRET = process.env.IMAGE_API_SECRET || 'anny-img-2026';

function makeGhostJWT() {
  const [id, secret] = GHOST_ADMIN_KEY.split(':');
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', kid: id, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers['x-api-key'] !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const { prompt, filename } = req.body || {};
  if (!prompt || !filename) return res.status(400).json({ error: 'prompt and filename required' });

  try {
    // 1. Generate image with Gemini Imagen 4
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: '4:3' }
        })
      }
    );

    const geminiData = await geminiRes.json();
    if (!geminiData.predictions?.[0]?.bytesBase64Encoded) {
      return res.status(500).json({ error: 'Gemini failed: ' + JSON.stringify(geminiData).substring(0, 200) });
    }

    const imageBuffer = Buffer.from(geminiData.predictions[0].bytesBase64Encoded, 'base64');

    // 2. Upload to Ghost
    const jwt = makeGhostJWT();
    const form = new FormData();
    form.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }), filename);
    form.append('purpose', 'image');

    const ghostRes = await fetch(`${GHOST_URL}/ghost/api/admin/images/upload/`, {
      method: 'POST',
      headers: { 'Authorization': `Ghost ${jwt}` },
      body: form
    });

    const ghostData = await ghostRes.json();
    if (!ghostRes.ok) {
      return res.status(500).json({ error: 'Ghost upload failed: ' + JSON.stringify(ghostData).substring(0, 200) });
    }

    res.status(200).json({ url: ghostData.images[0].url });

  } catch (err) {
    console.error('[generate-image]', err.message);
    res.status(500).json({ error: err.message });
  }
};

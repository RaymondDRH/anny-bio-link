module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email } = req.body || {};
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'Nombre y correo son requeridos' });
  }

  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/waitlist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Profile': 'anny',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ name: name.trim(), email: email.trim() }),
    });

    if (!response.ok) {
      const error = await response.json();
      if (error.code === '23505') {
        return res.status(200).json({ alreadyRegistered: true });
      }
      return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

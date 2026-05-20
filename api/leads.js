module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email } = req.body || {};
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'Nombre y correo son requeridos' });
  }

  try {
    // 1. Guardar en Supabase (anny.leads)
    const supabaseRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/leads`, {
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

    // Ignorar duplicados (código 23505 = unique violation)
    if (!supabaseRes.ok) {
      const err = await supabaseRes.json();
      if (err.code !== '23505') {
        return res.status(500).json({ error: err.message });
      }
    }

    // 2. Disparar workflow n8n (envía el email con la guía)
    await fetch('https://aicrafterlab-n8n.j1omvg.easypanel.host/webhook/anny-guia-habitos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), email: email.trim() }),
    });

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

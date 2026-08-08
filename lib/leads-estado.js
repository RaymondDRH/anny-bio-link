// Cierra el ciclo del lead del checkout.
//
// El modal de pago guarda el lead con estado 'intentando' ANTES de cobrar.
// Cuando el pago se confirma, esto lo pasa a 'compro'. Sin este paso, TODOS
// los leads quedarian como 'intentando' y no habria forma de distinguir a
// quien abandono de quien compro — que es justo lo que hay que saber para
// escribirle solo a los primeros.
//
// GARANTIA: nunca lanza. Un fallo aqui no puede tumbar un webhook de pago.

async function marcarComprado(email) {
  if (!email) return { ok: false, motivo: 'sin_email' };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('[leads-estado] faltan credenciales de Supabase');
    return { ok: false, motivo: 'sin_credenciales' };
  }
  try {
    const r = await fetch(
      `${url}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&estado=eq.intentando`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Profile': 'anny',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ estado: 'compro' }),
      },
    );
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[leads-estado] HTTP', r.status, t.slice(0, 160));
      return { ok: false, motivo: `HTTP ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[leads-estado]', e.message);
    return { ok: false, motivo: e.message };
  }
}

module.exports = { marcarComprado };

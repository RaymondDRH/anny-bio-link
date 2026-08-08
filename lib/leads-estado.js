// Cierra el ciclo del lead del checkout.
//
// El modal de pago guarda el lead con estado 'intentando' ANTES de cobrar.
// Cuando el pago se confirma, esto lo pasa a 'compro'. Sin este paso TODOS
// los leads quedarian como 'intentando' y Anny terminaria escribiendole a
// compradores para preguntarles por que abandonaron.
//
// POR QUE UNA FUNCION Y NO UN PATCH DIRECTO:
// La tabla tiene RLS con una sola politica (insert_only). Para hacer un
// UPDATE, Postgres necesita LEER la fila y evaluar la condicion — y sin
// politica de SELECT ninguna fila es visible para el rol anon, asi que el
// PATCH afectaba 0 filas SIN dar error. Anadir una politica de SELECT
// habria expuesto todos los leads a cualquiera con la clave publica.
// La funcion anny.marcar_lead_comprado es SECURITY DEFINER: hace solo este
// cambio concreto, no devuelve datos y no permite leer nada.
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
    const r = await fetch(`${url}/rest/v1/rpc/marcar_lead_comprado`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Profile': 'anny',
      },
      body: JSON.stringify({ p_email: String(email).trim() }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[leads-estado] HTTP', r.status, t.slice(0, 160));
      return { ok: false, motivo: `HTTP ${r.status}` };
    }
    // La funcion devuelve cuantas filas cambio. 0 es normal: el comprador
    // pudo no haber pasado por el modal (PayPal directo, enlace de pago...).
    const filas = await r.json().catch(() => 0);
    return { ok: true, filas: Number(filas) || 0 };
  } catch (e) {
    console.error('[leads-estado]', e.message);
    return { ok: false, motivo: e.message };
  }
}

// Guarda el lead del checkout via anny.guardar_lead_checkout (SECURITY DEFINER).
//
// POR QUE UNA FUNCION Y NO UN INSERT: leads.email es UNIQUE y este lead se
// guarda ANTES de validar el formato, para no perder a quien se frustra y
// cierra el modal. Si ella corrige y reenvia, un INSERT chocaria con el UNIQUE
// y se descartaria en silencio: nos quedariamos con el telefono MALO. La
// funcion rellena huecos y solo sustituye el telefono si el nuevo mejora al
// guardado. Nunca revierte un 'compro' a 'intentando'.
//
// GARANTIA: nunca lanza. Un fallo aqui no puede tumbar un webhook de pago.
async function guardarLeadCheckout(args) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('[leads-guardar] faltan credenciales de Supabase');
    return { ok: false, error: 'sin_credenciales' };
  }
  try {
    const r = await fetch(`${url}/rest/v1/rpc/guardar_lead_checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Profile': 'anny',
      },
      body: JSON.stringify(args),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { ok: false, error: `HTTP ${r.status} ${t.slice(0, 160)}` };
    }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { marcarComprado, guardarLeadCheckout };

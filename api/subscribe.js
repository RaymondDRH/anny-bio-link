// Suscripción al blog, con confirmación por correo.
//
// ─────────────────────────────────────────────────────────────────────────
// QUÉ CAMBIÓ Y POR QUÉ (22-sep-2026)
//
// Antes esto creaba el miembro DIRECTAMENTE con la API de administración de
// Ghost (`POST /ghost/api/admin/members/` con `subscribed: true`) y le mandaba
// el correo de bienvenida al instante. Suscripción simple, sin confirmar.
//
// El formulario del blog, en cambio, sí pedía confirmación. Dos puertas a la
// misma lista comportándose distinto.
//
// Ahora las dos llaman al mismo sitio: el endpoint público de Ghost
// `/members/api/send-magic-link/`. Ghost manda el correo de confirmación —en
// español y con el cobre de la marca— y solo crea a la persona cuando pulsa.
//
// POR QUÉ CONFIRMAR, SI NO ES OBLIGATORIO:
//
// En Estados Unidos y Latinoamérica basta con que escriban su correo. Pero sin
// confirmar entran erratas, direcciones falsas y correos de terceros escritos
// por error. Todo eso rebota o se marca como spam, y esa reputación se apunta
// contra annygomez.com — el mismo dominio por el que la tienda manda las
// descargas que la gente ya pagó.
//
// El precio es real: entre un 20% y un 40% no pulsa. Se acepta a propósito
// mientras la lista es pequeña, que es cuando una reputación se construye.
//
// EL CORREO DE BIENVENIDA YA NO SE MANDA AQUÍ.
// Vive en api/member-added.js, que Ghost llama por webhook cuando la persona
// confirma de verdad. Mandarlo desde aquí sería darle la bienvenida a alguien
// que todavía no ha entrado.
// ─────────────────────────────────────────────────────────────────────────

const GHOST_MAGIC_LINK = 'https://blog.annygomez.com/members/api/send-magic-link/';

// Validación mínima. No se intenta ser exhaustivo: quien decide de verdad si
// una dirección existe es el servidor de correo, y Ghost valida otra vez.
// Esto solo evita gastar una llamada en algo que claramente no es un correo.
const PARECE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const correo = (req.body?.email || '').trim().toLowerCase();

  if (!correo) {
    return res.status(400).json({ error: 'El correo es requerido' });
  }

  if (!PARECE_CORREO.test(correo)) {
    return res.status(400).json({ error: 'Ese correo no parece válido' });
  }

  try {
    const respuesta = await fetch(GHOST_MAGIC_LINK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: correo,
        emailType: 'subscribe',
        labels: ['bio-link'],   // para saber por dónde entró
        name: '',
      }),
    });

    // Ghost devuelve 201 tanto si es alguien nuevo como si ya estaba: no
    // revela quién está en la lista, y eso está bien. En los dos casos la
    // persona recibe un correo con un enlace que funciona.
    if (respuesta.ok) {
      return res.json({ success: true, requiereConfirmacion: true });
    }

    const cuerpo = await respuesta.text();
    let mensaje = '';
    try {
      mensaje = JSON.parse(cuerpo)?.errors?.[0]?.message || '';
    } catch {
      mensaje = cuerpo.slice(0, 200);
    }

    console.error(`[subscribe] Ghost respondió ${respuesta.status}: ${mensaje}`);

    // Ghost limita los intentos para frenar el spam. Merece su propio mensaje:
    // "hubo un error" haría que la persona reintentara y lo empeorara.
    if (respuesta.status === 429) {
      return res.status(429).json({
        error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
      });
    }

    return res.status(502).json({
      error: 'No pude suscribirte ahora mismo. Inténtalo en un momento.',
    });
  } catch (err) {
    console.error('[subscribe] error de red:', err.message);
    return res.status(502).json({
      error: 'No pude suscribirte ahora mismo. Inténtalo en un momento.',
    });
  }
};

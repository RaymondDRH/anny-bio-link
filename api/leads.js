// Leads de Anny + cerebro del quiz.
// - action 'quiz_result' → genera resultado personalizado con Claude (no guarda nada)
// - source 'quiz'  → guarda lead del quiz (Supabase) + suscribe al blog
// - source 'reset' → guarda lead + envía PDF (Resend) + suscribe al blog
// - default        → guía de hábitos vía n8n
const crypto = require('crypto');
const { enviarCorreo } = require('../lib/mailer');
const RESEND_KEY = process.env.RESEND_API_KEY;
const GHOST_KEY = process.env.GHOST_ADMIN_KEY;
const GHOST_URL = 'https://blog.annygomez.com/ghost/api/admin';
const RESET_PDF_URL = 'https://annygomez.com/guias/reset-5-minutos/reset-5-minutos.pdf';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const ARQUETIPOS = {
  visionaria:  { nombre: 'La Visionaria',  superpoder: 'creatividad y visión de futuro; ves posibilidades donde otras ven muros', reto: 'tantas ideas que te dispersas; te falta un sistema simple para aterrizarlas', paso: 'elegir UNA idea y darle 30 días de foco' },
  imparable:   { nombre: 'La Imparable',   superpoder: 'disciplina y acción; cuando decides algo, lo haces', reto: 'te exiges tanto que rozas el agotamiento', paso: 'agendar el descanso como agendas el trabajo' },
  corazon:     { nombre: 'La Corazón Gigante', superpoder: 'tu entrega y amor por los demás mueven montañas', reto: 'te pones de última; das desde un vaso vacío', paso: 'una cosa al día solo para ti, sin culpa' },
  despertando: { nombre: 'La que Está Despertando', superpoder: 'consciencia y valentía; sientes que algo grande va a empezar', reto: 'el miedo al primer paso o no tener un mapa', paso: 'dar un primer paso pequeño esta semana, con un plan' },
  guerrera:    { nombre: 'La Guerrera',    superpoder: 'resiliencia y fortaleza; has atravesado tormentas y sigues de pie', reto: 'cargas heridas o culpas que ya puedes soltar; te cuesta pedir ayuda', paso: 'permitirte sanar y soltar un peso esta semana, sin culpa' },
  creadora:    { nombre: 'La Creadora',    superpoder: 'talento para crear y transformar lo ordinario en belleza; manifiestas con tus manos', reto: 'te falta tiempo, espacio o confianza para mostrar y vivir de lo que creas', paso: 'reservar un espacio fijo para crear y mostrar UNA creación esta semana' },
};

function ghostToken() {
  const [id, secret] = GHOST_KEY.split(':');
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
async function subscribeToBlog(email, name) {
  if (!GHOST_KEY) return;
  try {
    const member = { email, subscribed: true };
    if (name && name !== 'Reset' && name !== 'Quiz') member.name = name;
    await fetch(`${GHOST_URL}/members/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Ghost ${ghostToken()}` }, body: JSON.stringify({ members: [member] }) });
  } catch (e) { console.error('[leads] Ghost:', e.message); }
}

// Todo dato del cliente que entra en una plantilla de correo pasa por aqui.
// Sin esto, alguien mete <a href="..."> por el campo `name` y le sale un enlace
// clicable en un correo firmado con el SPF/DKIM de annygomez.com.
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function resetEmailHtml(name) {
  const hi = name && name !== 'Reset' ? `Hola ${escapeHtml(name)},` : 'Hola,';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#FBF6F2;font-family:Georgia,serif"><div style="max-width:560px;margin:0 auto;background:#fff"><div style="background:#FBF6F2;padding:36px 40px 24px;text-align:center;border-bottom:1px solid #E8D9CD"><div style="font-family:Georgia,serif;font-size:28px;color:#2E1A10">Anny G&oacute;mez</div><div style="font-size:12px;color:#8C6A58;letter-spacing:0.12em;text-transform:uppercase;margin-top:6px">Pausa &middot; Calma &middot; Prop&oacute;sito</div></div><div style="padding:40px 40px 32px"><p style="font-size:22px;color:#2E1A10;margin:0 0 20px">Aqu&iacute; tienes tu Reset de 5 minutos &#129293;</p><p style="font-size:15px;line-height:1.7;color:#4a3020;margin:0 0 16px">${hi} te dejo adjunto el <strong>Reset de 5 minutos para la mujer agotada</strong> en PDF, para que lo tengas siempre a mano.</p><p style="font-size:15px;line-height:1.7;color:#4a3020;margin:0 0 16px">Adem&aacute;s te sumaste a mi comunidad: cada semana te llegar&aacute; una reflexi&oacute;n para vivir con m&aacute;s calma y prop&oacute;sito. &#129293;</p><p style="font-size:13px;color:#8C6A58;margin:16px 0 0">Con cari&ntilde;o,<br><strong style="font-family:Georgia,serif;font-size:16px;color:#2E1A10">Anny G&oacute;mez</strong></p></div></div></body></html>`;
}

// El resultado del quiz viaja desde el navegador para poder enviarlo por correo.
// NO se confia en el cliente: lista blanca de etiquetas (p/strong/em/span/br),
// sin scripts, sin atributos de evento, sin enlaces y con tope de longitud.
//
// OJO: quitar <a> NO basta por si solo — los clientes de correo convierten las
// URLs en texto plano en enlaces clicables. Por eso tambien se neutralizan las
// cadenas que parecen dominio o URL.
function sanitizarResultado(html) {
  if (!html || typeof html !== 'string') return '';
  let s = html.slice(0, 4000);
  s = s.replace(/<(script|style|iframe|object|embed|link|meta)[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<\/?(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '');
  // [\s\/] y no solo \s: "<p/onerror=..." usa la barra como separador valido
  s = s.replace(/[\s/]on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/(javascript|data|vbscript)\s*:/gi, '');
  s = s.replace(/<(?!\/?(?:p|strong|em|span|br)\b)[^>]*>/gi, '');
  // Autolinkificacion: romper URLs y dominios sueltos del texto
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[enlace removido]');
  s = s.replace(/\b[\w.-]+\.(com|net|org|io|co|link|xyz|info|shop|app)\b/gi, '[enlace removido]');
  return s.trim();
}

function quizEmailHtml(name, arqKey, resultadoLimpio) {
  const a = ARQUETIPOS[arqKey];
  const titulo = a ? a.nombre : 'Tu arquetipo';
  // Medalla ligera (24-42 KB) con fondo crema igual al del correo, para que
  // se vea como si fuera transparente. Las del quiz pesan 2 MB y muchos
  // clientes de correo no las cargarian.
  const medalla = arqKey
    ? `https://annygomez.com/quiz/mujer-construccion/img/email/medalla-${arqKey}.jpg`
    : '';
  // NO se saluda aqui: el texto de Claude YA trae su propio saludo. Poner
  // "Hola [nombre]" aqui producia dos saludos seguidos. El nombre se
  // personaliza en el ASUNTO, que es donde de verdad se nota.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    .verse{font-style:italic;color:#6b4a35;border-left:2px solid #D4BEB0;padding-left:16px;margin-top:22px}
    .verse-ref{display:block;margin-top:8px;font-style:normal;font-size:13px;color:#8C6A58;letter-spacing:.02em}
  </style></head><body style="margin:0;padding:0;background:#FBF6F2;font-family:Georgia,serif"><div style="max-width:560px;margin:0 auto;background:#fff">

  <div style="background:#FBF6F2;padding:34px 40px 22px;text-align:center;border-bottom:1px solid #E8D9CD"><div style="font-family:Georgia,serif;font-size:28px;color:#2E1A10">Anny G&oacute;mez</div><div style="font-size:12px;color:#8C6A58;letter-spacing:0.12em;text-transform:uppercase;margin-top:6px">Prop&oacute;sito &middot; H&aacute;bitos &middot; Fe</div></div>

  ${medalla ? `<div style="background:#FBF6F2;text-align:center;padding:8px 0 26px"><img src="${medalla}" alt="${escapeHtml(titulo)}" width="220" style="width:220px;max-width:62%;height:auto;display:block;margin:0 auto"></div>` : ''}

  <div style="padding:34px 40px 32px"><p style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8C6A58;margin:0 0 10px;text-align:center">Tu resultado</p><p style="font-size:27px;color:#2E1A10;margin:0 0 26px;font-family:Georgia,serif;text-align:center">Eres <strong>${titulo}</strong></p><div style="font-size:15px;line-height:1.75;color:#4a3020">${resultadoLimpio}</div>

  <div style="margin:32px 0 0;padding:24px;background:#FBF6F2;border-radius:10px;text-align:center"><p style="font-size:15px;line-height:1.6;color:#2E1A10;margin:0 0 8px;font-family:Georgia,serif">&iquest;Te reconociste?</p><p style="font-size:14px;line-height:1.65;color:#4a3020;margin:0 0 18px">Comparte tu medalla en tus historias y etiqu&eacute;tame &mdash; me encanta ver a qui&eacute;n le llega esto.</p><a href="https://instagram.com/annygomezleal" style="display:inline-block;background:#C4855A;color:#fff;text-decoration:none;padding:13px 30px;border-radius:6px;font-family:Georgia,serif;font-size:14px">Etiquetarme en Instagram</a></div>

  <div style="margin:30px 0 0;padding-top:22px;border-top:1px solid #E8D9CD"><p style="font-size:14px;line-height:1.7;color:#4a3020;margin:0 0 14px">Gu&aacute;rdalo. Vas a querer releerlo el d&iacute;a que se te olvide de qu&eacute; est&aacute;s hecha.</p><p style="font-size:14px;line-height:1.7;color:#4a3020;margin:0">Desde hoy te acompa&ntilde;o cada semana con algo pr&aacute;ctico para vivir con m&aacute;s calma y prop&oacute;sito. &#129293;</p></div><p style="font-size:13px;color:#8C6A58;margin:26px 0 0">Con cari&ntilde;o,<br><strong style="font-family:Georgia,serif;font-size:16px;color:#2E1A10">Anny G&oacute;mez</strong></p></div>

  <div style="background:#FBF6F2;padding:22px 40px;text-align:center;border-top:1px solid #E8D9CD"><p style="font-size:11.5px;color:#8C6A58;margin:0;line-height:1.7">Recibiste este correo porque hiciste el test en <a href="https://annygomez.com" style="color:#8C6A58">annygomez.com</a><br><a href="mailto:hola@annygomez.com?subject=Quiero%20darme%20de%20baja" style="color:#8C6A58">Darme de baja</a> &middot; &copy; 2026 Anny G&oacute;mez</p></div>

  </div></body></html>`;
}

async function claudeQuizResult(arqKey, answers, name, secKey) {
  const a = ARQUETIPOS[arqKey];
  if (!a) throw new Error('arquetipo inválido');
  const sec = (secKey && secKey !== arqKey) ? ARQUETIPOS[secKey] : null;
  const secLine = sec
    ? `\n- Faceta secundaria (matiz, no domina): ${sec.nombre} — ${sec.superpoder}. Menciónala UNA vez con sutileza, como un matiz de su personalidad que enriquece su arquetipo principal.`
    : '';
  const prompt = `Eres Anny Gómez, creadora de contenido para mujeres: empoderamiento, crecimiento personal, hábitos, generar ingresos, y Fe (mujer cristiana). Tono cercano, cálido, empoderador, femenino, elegante, sereno pero firme, directo pero amoroso. Hablas de "tú".

IDIOMA — ESPAÑOL NEUTRO ESTRICTO: nada de regionalismos ni jerga de ningún país. PROHIBIDO usar expresiones como "te late", "chévere", "padrísimo", "ándale", "órale", "qué padre", "vos", "che", "guay", "vale", "tío/tía", "platicar", "ahorita". Usa español neutro y universal (ej: di "la idea que más te emociona / que más resuona contigo", NO "la que más te late"). Nada de clichés vacíos ni lenguaje clínico ni la palabra "terapia".

TONO — NADA DE MISTICISMO (CRÍTICO): Anny es mujer cristiana. PROHIBIDO el lenguaje tarotista, de horóscopo, astrología o "new age". NO uses: "el universo", "energía", "vibración", "lo que late en ti", "tu esencia cósmica", "el destino", "las estrellas", "tu aura", "manifestar al universo", "lo que habita en tu alma", ni hablar de fuerzas impersonales. Habla de forma ATERRIZADA, real, concreta y empoderadora — fortalezas y hábitos reales —, y cuando toques lo espiritual, anclalo SIEMPRE en Dios (Fe cristiana), nunca en misticismo.

Una mujer hizo el test "¿Qué tipo de mujer en construcción eres?".
- Arquetipo resultante: ${a.nombre}
- Su superpoder base: ${a.superpoder}
- Su reto base: ${a.reto}
- Próximo paso base: ${a.paso}${secLine}
- Sus respuestas en el test (textos que eligió): ${JSON.stringify(answers)}
- Su nombre: ${name || '(no lo dio)'}

Escribe SU resultado personalizado, BREVE y directo (cuerpo de 90-110 palabras), en HTML simple usando solo <p>, <strong>, <em> y <span>. Frases cortas, fáciles de leer en celular. Estructura EXACTA:
<p> Saludo cálido + confirma su arquetipo con orgullo, en 1-2 frases. Si dio nombre, úsalo. </p>
<p><strong>Tu superpoder:</strong> su fortaleza en 1 frase, con UN detalle concreto de sus respuestas. </p>
<p><strong>Lo que te frena:</strong> su reto en 1 frase, con cariño, como próximo nivel (no defecto). </p>
<p><strong>Tu próximo paso:</strong> UNA acción concreta y pequeña, en 1 frase. </p>
<p> Cierre con Fe (2 frases): recuérdale que su valor y propósito vienen de Dios, que Él la formó así a propósito y la sostiene en este camino. </p>
<p class="verse">"<texto exacto y CORRECTO de un versículo bíblico real, corto, elegido especialmente para SU arquetipo y SU situación — el que esta mujer necesita leer hoy>"<span class="verse-ref">— Libro Capítulo:Versículo</span></p>

Reglas del versículo: debe ser un versículo bíblico REAL y citado con exactitud (preferible versión Reina-Valera o NVI), corto, esperanzador y que conecte con su arquetipo/reto. Cítalo con su referencia correcta (libro, capítulo y versículo). No lo inventes ni alteres.

La Fe debe sentirse presente pero natural y cálida, JAMÁS predicadora ni pesada, sin alejar a quien aún no tiene una Fe fuerte. Escribe Fe con F mayúscula y sin acento.

NUNCA menciones letras de opciones (A, B, C...) ni códigos internos; refiérete a lo que ELIGIÓ con tus propias palabras. Sé concisa: nada de relleno ni frases largas. No inventes datos personales. Cálido pero no cursi. Que se sienta escrito SOLO para ella. Devuelve SOLO el HTML, sin texto extra.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'claude_failed');
  let txt = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text.trim() : '';
  txt = txt.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim(); // quitar fences de markdown
  return txt;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }

  // --- Cerebro del quiz: resultado personalizado ---
  if (body && body.action === 'quiz_result') {
    try {
      const html = await claudeQuizResult(body.archetype, body.answers || [], (body.name || '').trim(), body.secondary || null);
      return res.status(200).json({ success: true, result: html });
    } catch (err) {
      console.error('[leads] quiz_result:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  const source = (body && body.source ? String(body.source).trim().slice(0, 32) : '');
  // Topes de longitud: sin esto, un `name` de 1 MB infla el cuerpo del correo.
  const name = (body && body.name ? String(body.name).trim().slice(0, 80) : '');
  const email = (body && body.email ? String(body.email).trim().slice(0, 160) : '');
  const archetype = (body && body.archetype ? String(body.archetype).trim().slice(0, 32) : '');
  // De donde vino el lead: ?de= de la URL, o deducido (bio-link / directo).
  const origen = (body && body.origen ? String(body.origen).trim().slice(0, 60) : '');
  const telefono = (body && body.telefono ? String(body.telefono).trim().slice(0, 40) : '');
  const producto = (body && body.producto ? String(body.producto).trim().slice(0, 60) : '');

  if (source === 'reset' || source === 'quiz') {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Correo inválido' });
  } else if (!name || !email) {
    return res.status(400).json({ error: 'Nombre y correo son requeridos' });
  }

  try {
    const row = { name: name || (source === 'quiz' ? 'Quiz' : 'Reset'), email };
    if (origen) row.origen = origen;
    if (source === 'checkout') {
      // El telefono es lo mas valioso de este lead: permite escribirle por
      // WhatsApp a quien lleno el formulario de pago y no completo la compra.
      if (telefono) row.telefono = telefono;
      if (producto) row.producto = producto;
      row.estado = 'intentando';
    }
    const sb = await fetch(`${process.env.SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`, 'Content-Profile': 'anny', 'Prefer': 'return=minimal' },
      body: JSON.stringify(row),
    });
    if (!sb.ok) { const e = await sb.json().catch(()=>({})); if (e.code && e.code !== '23505') console.error('[leads] Supabase:', e); }

    if (source === 'reset') {
      // Critico: ella pidio la guia y se la prometimos. Reintenta y avisa si falla.
      const mail = await enviarCorreo(
        {
          from: 'Anny Gómez <hola@annygomez.com>',
          to: [email],
          subject: 'Tu Reset de 5 minutos 🤍',
          html: resetEmailHtml(name),
          attachments: [{ filename: 'Reset-de-5-minutos-Anny-Gomez.pdf', path: RESET_PDF_URL }],
        },
        { critico: true, etiqueta: 'guia Reset de 5 minutos' },
      );
      if (!mail.ok) return res.status(500).json({ error: 'No se pudo enviar el correo' });
      await subscribeToBlog(email, name);
    } else if (source === 'checkout') {
      // Nada mas que hacer: el lead ya quedo guardado arriba.
      // NO se envia correo ni se suscribe a la lista: todavia no es cliente
      // y no dio ese consentimiento. Solo guardamos que lo intento, para que
      // Anny pueda escribirle si abandona.
    } else if (source === 'quiz') {
      await subscribeToBlog(email, name);
      // Su resultado por correo. Fail-open: si esto falla, el lead YA quedó
      // guardado arriba y ella YA vio su resultado en pantalla. No rompe nada.
      try {
        const arq = ARQUETIPOS[archetype] ? archetype : null;
        let limpio = sanitizarResultado(body.result_html);
        // Si Claude fallo, el cliente manda el texto vacio. Armamos el cuerpo
        // con los datos del arquetipo: no la dejamos suscrita sin recibir lo
        // que le prometimos en pantalla.
        if (!limpio && arq) {
          const a = ARQUETIPOS[arq];
          limpio =
            `<p><strong>Tu superpoder:</strong> ${escapeHtml(a.superpoder)}.</p>` +
            `<p><strong>Lo que te frena:</strong> ${escapeHtml(a.reto)}.</p>` +
            `<p><strong>Tu próximo paso:</strong> ${escapeHtml(a.paso)}.</p>`;
        }
        if (limpio) {
          // critico: false a proposito. Si la cuota de Resend esta apretada,
          // el que cede es este, no el correo de alguien que pago $697.
          // El nombre va en el ASUNTO, no en el cuerpo: ahi si se nota y sube
          // la apertura. Solo el primer nombre — "Rasymond David, eres..."
          // suena a formulario; "Rasymond, eres..." suena a persona.
          const primerNombre = name && name !== 'Quiz' ? name.split(/\s+/)[0] : '';
          const asunto = arq
            ? (primerNombre
                ? `${primerNombre}, eres ${ARQUETIPOS[arq].nombre} 🤍`
                : `Eres ${ARQUETIPOS[arq].nombre} 🤍`)
            : 'Tu resultado del test 🤍';
          await enviarCorreo(
            {
              from: 'Anny Gómez <hola@annygomez.com>',
              to: [email],
              subject: asunto,
              html: quizEmailHtml(name, arq, limpio),
              // Boton nativo de "cancelar suscripcion" en Gmail y similares.
              headers: {
                'List-Unsubscribe': '<mailto:hola@annygomez.com?subject=Quiero%20darme%20de%20baja>',
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
            },
            { critico: false, etiqueta: 'resultado del quiz' },
          );
        }
      } catch (e) { console.error('[leads] quiz email:', e.message); }
    } else {
      await fetch('https://aicrafterlab-n8n.j1omvg.easypanel.host/webhook/anny-guia-habitos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email }) });
    }
    res.status(200).json({ success: true });
  } catch (err) { console.error('[leads] error:', err.message); res.status(500).json({ error: err.message }); }
};

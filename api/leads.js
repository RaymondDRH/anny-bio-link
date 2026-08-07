// Leads de Anny + cerebro del quiz.
// - action 'quiz_result' → genera resultado personalizado con Claude (no guarda nada)
// - source 'quiz'  → guarda lead del quiz (Supabase) + suscribe al blog
// - source 'reset' → guarda lead + envía PDF (Resend) + suscribe al blog
// - default        → guía de hábitos vía n8n
const crypto = require('crypto');
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

function resetEmailHtml(name) {
  const hi = name && name !== 'Reset' ? `Hola ${name},` : 'Hola,';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#FBF6F2;font-family:Georgia,serif"><div style="max-width:560px;margin:0 auto;background:#fff"><div style="background:#FBF6F2;padding:36px 40px 24px;text-align:center;border-bottom:1px solid #E8D9CD"><div style="font-family:Georgia,serif;font-size:28px;color:#2E1A10">Anny G&oacute;mez</div><div style="font-size:12px;color:#8C6A58;letter-spacing:0.12em;text-transform:uppercase;margin-top:6px">Pausa &middot; Calma &middot; Prop&oacute;sito</div></div><div style="padding:40px 40px 32px"><p style="font-size:22px;color:#2E1A10;margin:0 0 20px">Aqu&iacute; tienes tu Reset de 5 minutos &#129293;</p><p style="font-size:15px;line-height:1.7;color:#4a3020;margin:0 0 16px">${hi} te dejo adjunto el <strong>Reset de 5 minutos para la mujer agotada</strong> en PDF, para que lo tengas siempre a mano.</p><p style="font-size:15px;line-height:1.7;color:#4a3020;margin:0 0 16px">Adem&aacute;s te sumaste a mi comunidad: cada semana te llegar&aacute; una reflexi&oacute;n para vivir con m&aacute;s calma y prop&oacute;sito. &#129293;</p><p style="font-size:13px;color:#8C6A58;margin:16px 0 0">Con cari&ntilde;o,<br><strong style="font-family:Georgia,serif;font-size:16px;color:#2E1A10">Anny G&oacute;mez</strong></p></div></div></body></html>`;
}

// El resultado del quiz viaja desde el navegador para poder enviarlo por correo.
// NO se confia en el cliente: lista blanca de etiquetas (p/strong/em/span/br),
// sin <a> (sin enlaces no hay phishing util desde el dominio de Anny),
// sin scripts, sin atributos de evento y con tope de longitud.
function sanitizarResultado(html) {
  if (!html || typeof html !== 'string') return '';
  let s = html.slice(0, 4000);
  s = s.replace(/<(script|style|iframe|object|embed|link|meta)[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<\/?(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '');
  s = s.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/javascript:/gi, '');
  s = s.replace(/<(?!\/?(?:p|strong|em|span|br)\b)[^>]*>/gi, '');
  return s.trim();
}

function quizEmailHtml(name, arqKey, resultadoLimpio) {
  const a = ARQUETIPOS[arqKey];
  const titulo = a ? a.nombre : 'Tu arquetipo';
  const hi = name && name !== 'Quiz' ? `Hola ${name},` : 'Hola,';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#FBF6F2;font-family:Georgia,serif"><div style="max-width:560px;margin:0 auto;background:#fff"><div style="background:#FBF6F2;padding:36px 40px 24px;text-align:center;border-bottom:1px solid #E8D9CD"><div style="font-family:Georgia,serif;font-size:28px;color:#2E1A10">Anny G&oacute;mez</div><div style="font-size:12px;color:#8C6A58;letter-spacing:0.12em;text-transform:uppercase;margin-top:6px">Prop&oacute;sito &middot; H&aacute;bitos &middot; Fe</div></div><div style="padding:40px 40px 32px"><p style="font-size:15px;line-height:1.7;color:#4a3020;margin:0 0 8px">${hi}</p><p style="font-size:24px;color:#2E1A10;margin:0 0 22px;font-family:Georgia,serif">Eres <strong>${titulo}</strong> &#10022;</p><div style="font-size:15px;line-height:1.75;color:#4a3020">${resultadoLimpio}</div><div style="margin:30px 0 0;padding-top:22px;border-top:1px solid #E8D9CD"><p style="font-size:14px;line-height:1.7;color:#4a3020;margin:0 0 14px">Gu&aacute;rdalo. Vas a querer releerlo el d&iacute;a que se te olvide de qu&eacute; est&aacute;s hecha.</p><p style="font-size:14px;line-height:1.7;color:#4a3020;margin:0">Desde hoy te acompa&ntilde;o cada semana con algo pr&aacute;ctico para vivir con m&aacute;s calma y prop&oacute;sito. &#129293;</p></div><p style="font-size:13px;color:#8C6A58;margin:26px 0 0">Con cari&ntilde;o,<br><strong style="font-family:Georgia,serif;font-size:16px;color:#2E1A10">Anny G&oacute;mez</strong></p></div></div></body></html>`;
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

  const source = (body && body.source ? String(body.source).trim() : '');
  const name = (body && body.name ? String(body.name).trim() : '');
  const email = (body && body.email ? String(body.email).trim() : '');
  const archetype = (body && body.archetype ? String(body.archetype).trim() : '');

  if (source === 'reset' || source === 'quiz') {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Correo inválido' });
  } else if (!name || !email) {
    return res.status(400).json({ error: 'Nombre y correo son requeridos' });
  }

  try {
    const row = { name: name || (source === 'quiz' ? 'Quiz' : 'Reset'), email };
    const sb = await fetch(`${process.env.SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`, 'Content-Profile': 'anny', 'Prefer': 'return=minimal' },
      body: JSON.stringify(row),
    });
    if (!sb.ok) { const e = await sb.json().catch(()=>({})); if (e.code && e.code !== '23505') console.error('[leads] Supabase:', e); }

    if (source === 'reset') {
      const mail = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` }, body: JSON.stringify({ from: 'Anny Gómez <hola@annygomez.com>', to: [email], subject: 'Tu Reset de 5 minutos 🤍', html: resetEmailHtml(name), attachments: [{ filename: 'Reset-de-5-minutos-Anny-Gomez.pdf', path: RESET_PDF_URL }] }) });
      if (!mail.ok) { const e = await mail.json().catch(()=>({})); return res.status(500).json({ error: e.message || 'No se pudo enviar el correo' }); }
      await subscribeToBlog(email, name);
    } else if (source === 'quiz') {
      await subscribeToBlog(email, name);
      // Su resultado por correo. Fail-open: si esto falla, el lead YA quedó
      // guardado arriba y ella YA vio su resultado en pantalla. No rompe nada.
      try {
        const limpio = sanitizarResultado(body.result_html);
        const arq = ARQUETIPOS[archetype] ? archetype : null;
        if (limpio && RESEND_KEY) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
            body: JSON.stringify({
              from: 'Anny Gómez <hola@annygomez.com>',
              to: [email],
              subject: arq ? `Eres ${ARQUETIPOS[arq].nombre} 🤍 tu resultado` : 'Tu resultado del test 🤍',
              html: quizEmailHtml(name, arq, limpio),
            }),
          });
        }
      } catch (e) { console.error('[leads] quiz email:', e.message); }
    } else {
      await fetch('https://aicrafterlab-n8n.j1omvg.easypanel.host/webhook/anny-guia-habitos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email }) });
    }
    res.status(200).json({ success: true });
  } catch (err) { console.error('[leads] error:', err.message); res.status(500).json({ error: err.message }); }
};

// Normalizacion de telefonos a E.164 (+12516509950).
//
// POR QUE E.164: es el formato que necesita WhatsApp y el que evita duplicados.
// "+1 (251) 650-9950", "251-650-9950" y "12516509950" son el mismo numero, y sin
// normalizar quedarian como tres leads distintos.
//
// POR QUE libphonenumber Y NO UNA EXPRESION REGULAR: los formatos varian tanto
// por pais que cualquier regex o rechaza numeros validos o acepta basura. Es la
// biblioteca de Google, la misma que usa Android.
//
// REGLA DE ORO: esta funcion NUNCA rechaza ni lanza. Si no puede normalizar,
// devuelve el valor limpio y marca valido:false. Un telefono raro no puede
// costar una venta de $697 — eso lo decide el negocio, no el parser.
//
// El `min` de la libreria valida longitud pero no tipo de linea: es a proposito.
// Distinguir movil de fijo rechazaria numeros validos en varios paises de
// Latinoamerica, donde esa clasificacion no siempre es fiable.

const { parsePhoneNumberFromString } = require('libphonenumber-js/min');

// Paises de la audiencia: se prueban en orden cuando el numero llega sin '+'.
const PAISES = ['US', 'MX', 'CO', 'VE', 'AR', 'PE', 'CL', 'EC', 'DO', 'ES'];

function normalizarTelefono(valor, paisPreferido) {
  const crudo = String(valor == null ? '' : valor).trim();
  if (!crudo) return { e164: '', original: '', valido: false, motivo: 'vacio' };

  // Deja solo lo que puede formar parte de un telefono, conservando el '+'.
  const limpio = crudo.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  const digitos = limpio.replace(/\D/g, '');

  // E.164 admite entre 7 y 15 digitos. Fuera de ese rango no es un telefono.
  if (digitos.length < 7 || digitos.length > 15) {
    return { e164: '', original: crudo.slice(0, 40), valido: false, motivo: 'longitud' };
  }

  const candidatos = [];
  if (limpio.startsWith('+')) candidatos.push(undefined); // ya trae pais
  if (paisPreferido) candidatos.push(paisPreferido);
  for (const p of PAISES) if (p !== paisPreferido) candidatos.push(p);

  for (const pais of candidatos) {
    try {
      const t = parsePhoneNumberFromString(limpio, pais);
      if (t && t.isValid()) {
        return { e164: t.number, original: crudo.slice(0, 40), valido: true, pais: t.country || null };
      }
    } catch (e) { /* se prueba el siguiente pais */ }
  }

  // Parece un telefono por longitud pero ningun pais lo reconoce.
  // Se guarda igual: mejor un dato imperfecto que ninguno.
  return {
    e164: limpio.startsWith('+') ? limpio : '+' + digitos,
    original: crudo.slice(0, 40),
    valido: false,
    motivo: 'no_reconocido',
  };
}

module.exports = { normalizarTelefono };

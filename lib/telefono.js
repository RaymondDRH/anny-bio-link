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
// ────────────────────────────────────────────────────────────────────────────
// LA REGLA QUE MANDA AQUI: NUNCA SE ADIVINA EL PAIS.
//
// La primera version de este modulo probaba una lista de paises en orden y se
// quedaba con el primero que dijera isValid(). Parecia razonable y era un
// desastre silencioso: con los numeros de ejemplo oficiales de la propia
// libreria, 3 de cada 10 paises salian mal asignados —y marcados como validos—
//   Colombia  '321 1234567'  -> +523211234567  (Mexico)
//   Ecuador   '099 123 4567' -> +51991234567   (Peru)
//   Espana    '612 34 56 78' -> +56612345678   (Chile)
// Anny abria el lead de alguien que abandono un pago de $697, escribia por
// WhatsApp, y le llegaba a un desconocido. Nadie se enteraba nunca, porque el
// dato se veia perfecto.
//
// Un dato basura que se ve basura es un problema.
// Un dato basura que se ve bien es una trampa.
//
// Ahora el pais solo puede venir de dos sitios, los dos DECLARADOS por ella:
//   1. el '+' que escribio (trae su propio codigo de pais)
//   2. el selector de pais del formulario
// Si no hay ninguno de los dos, no se inventa: se devuelve vacio y el llamador
// guarda el texto crudo. Preferimos un hueco honesto a un numero falso.
// ────────────────────────────────────────────────────────────────────────────
//
// GARANTIA: esta funcion NUNCA lanza y NUNCA rechaza una venta. Devolver
// valido:false no bloquea nada: quien llama decide que hacer. Eso lo decide el
// negocio, no el parser.
//
// El `min` de la libreria valida longitud pero no tipo de linea: es a proposito.
// Distinguir movil de fijo rechazaria numeros validos en varios paises de
// Latinoamerica, donde esa clasificacion no siempre es fiable.

const {
  parsePhoneNumberFromString,
  getCountryCallingCode,
  isSupportedCountry,
} = require('libphonenumber-js/min');

function vacio(motivo, original) {
  return { e164: '', original: original || '', valido: false, pais: null, motivo: motivo };
}

/**
 * @param {*} valor  lo que escribio la persona. Cualquier cosa: no lanza nunca.
 * @param {*} pais   ISO-3166 alpha-2 DECLARADO ('CO', 'MX'...). Nunca deducido.
 * @returns {{e164:string, original:string, valido:boolean, pais:string|null, motivo:string}}
 *          e164   — vacio si no se pudo componer sin adivinar
 *          valido — true SOLO si libphonenumber lo verifico de verdad
 */
function normalizarTelefono(valor, pais) {
  // String(valor) puede lanzar con un Symbol o con un toString hostil.
  let crudo = '';
  try {
    crudo = String(valor == null ? '' : valor).trim();
  } catch (e) {
    return vacio('ilegible', '');
  }
  if (!crudo) return vacio('vacio', '');

  const original = crudo.slice(0, 40);

  // Deja solo lo que puede formar parte de un telefono, conservando el '+'.
  // Se limpia ANTES de anclar el '+', asi "(+57) 300..." y " +57 300..." no
  // pierden el prefijo: al quitar el parentesis y el espacio, el '+' queda
  // en la posicion 0 por si solo.
  const limpio = crudo.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  const digitos = limpio.replace(/\D/g, '');

  // E.164 admite entre 7 y 15 digitos. Fuera de ese rango no es un telefono.
  if (digitos.length < 7 || digitos.length > 15) return vacio('longitud', original);

  let iso = '';
  try {
    iso = String(pais == null ? '' : pais).trim().toUpperCase();
  } catch (e) {
    iso = '';
  }
  const paisOk = /^[A-Z]{2}$/.test(iso) && isSupportedCountry(iso);

  // Orden de prioridad. Todo lo de aqui esta DECLARADO, nada deducido.
  const intentos = [];
  // 1. El '+' manda siempre: ella escribio su codigo de pais explicitamente,
  //    aunque el selector diga otra cosa (una colombiana viviendo en Miami).
  if (limpio.startsWith('+')) intentos.push({ texto: limpio, pais: undefined });
  if (paisOk) {
    // 2. El pais del selector, interpretando el numero en formato nacional.
    intentos.push({ texto: limpio, pais: iso });
    // 3. Escribio el codigo de pais pero se comio el '+' ("573001234567").
    //    Solo se intenta si los digitos empiezan por el prefijo del pais que
    //    ELLA eligio — sigue siendo su declaracion, no una adivinanza nuestra.
    try {
      const cc = getCountryCallingCode(iso);
      if (digitos.length > cc.length + 5 && digitos.indexOf(cc) === 0) {
        intentos.push({ texto: '+' + digitos, pais: undefined });
      }
    } catch (e) { /* pais sin prefijo conocido: se ignora este intento */ }
  }

  for (const intento of intentos) {
    try {
      const t = parsePhoneNumberFromString(intento.texto, intento.pais);
      if (t && t.isValid()) {
        return { e164: t.number, original: original, valido: true, pais: t.country || null, motivo: 'ok' };
      }
    } catch (e) { /* se prueba el siguiente intento */ }
  }

  // Ningun intento valido. Dos caminos, y ninguno inventa el pais:
  if (paisOk) {
    // Ella declaro su pais: componemos con ese prefijo aunque la libreria no
    // reconozca el numero (prefijos nuevos que esta version aun no conoce).
    // Sale marcado valido:false para que se pueda distinguir de uno verificado.
    try {
      const cc = getCountryCallingCode(iso);
      const nacional = digitos.indexOf(cc) === 0 ? digitos.slice(cc.length) : digitos.replace(/^0+/, '');
      if (nacional.length >= 6 && (cc + nacional).length <= 15) {
        return { e164: '+' + cc + nacional, original: original, valido: false, pais: iso, motivo: 'no_verificado' };
      }
    } catch (e) { /* cae al retorno de abajo */ }
  }
  if (limpio.startsWith('+')) {
    // Trae '+' pero la libreria no lo reconoce. El codigo de pais es suyo,
    // no nuestro, asi que se conserva tal cual.
    return { e164: limpio, original: original, valido: false, pais: null, motivo: 'no_verificado' };
  }

  // Declaro su pais pero lo que escribio no da ni para componer un numero
  // (ceros, repeticiones). No es un fallo de pais: es que no hay telefono.
  if (paisOk) return vacio('no_es_telefono', original);

  // Sin '+' y sin pais declarado. AQUI ES DONDE ANTES SE ADIVINABA.
  // Ahora se devuelve vacio a proposito: quien llama guarda el texto crudo.
  return vacio('sin_pais', original);
}

module.exports = { normalizarTelefono };

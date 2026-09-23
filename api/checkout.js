const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { normalizarTelefono } = require('../lib/telefono');

// Catálogo de códigos secretos → precio en CENTAVOS. Sin código = precio normal.
const CODES = {};
// Código de prueba LIVE de $1: ACTIVO solo si existe la env var LIVE_TEST_CODE.
if (process.env.LIVE_TEST_CODE) CODES[String(process.env.LIVE_TEST_CODE).trim().toUpperCase()] = 100;
const BASE_AMOUNT = 69700; // $697 (precio original)

function priceFor(code) {
  if (!code) return BASE_AMOUNT;
  const k = String(code).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CODES, k) ? CODES[k] : BASE_AMOUNT;
}

// Crea/actualiza un Customer con los datos del comprador y lo adjunta al
// PaymentIntent ANTES de cobrar, para que el recibo y el panel de Stripe
// identifiquen quién pagó (nombre completo + correo + teléfono).
// NO bloqueante: si algo falla, el pago igual continúa.
async function attachCustomer({ paymentIntentId, name, email, phone }) {
  if (!paymentIntentId || !email) return { ok: false, reason: 'missing_data' };
  let customer = null;
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing && existing.data && existing.data.length) {
    customer = existing.data[0];
    await stripe.customers.update(customer.id, {
      name: name || customer.name || undefined,
      phone: phone || customer.phone || undefined,
    });
  } else {
    customer = await stripe.customers.create({
      name: name || undefined,
      email,
      phone: phone || undefined,
    });
  }
  await stripe.paymentIntents.update(paymentIntentId, {
    customer: customer.id,
    receipt_email: email,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PLAN DE PAGO EN 2 PARTES (enlace privado que Anny envia caso por caso)
//
// DONDE VIVE EL ESTADO: en Stripe, no en una base de datos nuestra.
// Para saber que pago una clienta se le pregunta a Stripe cuantos
// PaymentIntents suyos estan en 'succeeded'. Una sola fuente de verdad.
// Si el estado viviera en una tabla aparte, el dia que esa tabla y Stripe
// no coincidan tendriamos un cobro doble o una clienta bloqueada sin deber
// nada — y el que miente siempre es el registro que nadie actualiza.
//
// El "planId" es el id del Customer de Stripe. La pagina /pago-en-2-partes/ lo lleva en
// la URL (?p=cus_xxx) y tambien lo guarda el navegador de la clienta, para
// que el MISMO enlace le sirva para las dos partes.
// ---------------------------------------------------------------------------
const PLAN_ID = '2-partes';
const PLAN_PARTES = 2;
const PLAN_PARTE_AMOUNT = 34850; // $348.50 x 2 = $697 — mismo precio, sin recargo

// Monto de cada parte para ESTE plan. Un plan marcado como prueba cobra $1
// por parte: sin esto, probar el ciclo completo costaria $697 reales.
// La marca va en el Customer, no en la peticion, para que las dos partes
// cobren siempre lo mismo — no se puede empezar en prueba y terminar en real.
function montoParteDe(customer) {
  const esPrueba = customer && customer.metadata && customer.metadata.prueba === '1';
  return esPrueba ? 100 : PLAN_PARTE_AMOUNT;
}

// Limpia el correo antes de mandarlo a Stripe. Se repite aqui aunque la
// pagina ya lo haga: el servidor NUNCA confia en que el navegador limpio nada.
// Caso real: una clienta escribio "...@gmail.com." con punto final (el teclado
// del telefono lo pone solo) y Stripe rechazo el cobro diez veces seguidas.
function limpiarCorreo(v) {
  return String(v || '')
    .replace(/[​-‍﻿ ]/g, '') // invisibles al pegar desde WhatsApp
    .trim()
    .replace(/[.,;:]+$/, '')                     // puntuacion final
    .toLowerCase();
}

// Telefono en E.164 (+525551234567), que es el formato que necesita WhatsApp
// y el que evita que "+52 555 123 4567", "5551234567" y "(555) 123-4567"
// queden como tres personas distintas.
//
// El pais viene DECLARADO por ella (el selector o el '+' que escribio); si no
// alcanza para componerlo, lib/telefono.js devuelve vacio a proposito y aqui
// se guarda el texto crudo. Un hueco honesto vale mas que un numero inventado.
//
// NUNCA bloquea: el telefono es un dato de contacto, no un canal de entrega.
// Se marca si quedo verificado para que Anny sepa de cual puede fiarse.
function telefonoNormalizado(valor, pais) {
  try {
    const t = normalizarTelefono(valor, pais);
    return { valor: t.e164 || String(valor == null ? '' : valor).trim(), verificado: !!t.valido };
  } catch (e) {
    return { valor: String(valor == null ? '' : valor).trim(), verificado: false };
  }
}

// Numeros de parte ya pagados por este Customer, segun Stripe.
async function planPartesPagadas(customerId) {
  const lista = await stripe.paymentIntents.list({ customer: customerId, limit: 25 });
  const pagados = (lista.data || []).filter(
    (pi) => pi.status === 'succeeded' && pi.metadata && pi.metadata.plan === PLAN_ID,
  );
  // Set (no contador): si alguna vez existieran dos PI de la misma parte,
  // contar sumaria 2 y daria el plan por completo sin estarlo.
  return new Set(pagados.map((pi) => String(pi.metadata.parte || '')));
}

async function planEstado(customerId) {
  const customer = await stripe.customers.retrieve(customerId);
  if (!customer || customer.deleted) return { ok: false, motivo: 'no_existe' };
  const monto = montoParteDe(customer);
  const pagadas = await planPartesPagadas(customerId);
  const partes = [];
  for (let n = 1; n <= PLAN_PARTES; n++) {
    partes.push({ n, pagada: pagadas.has(String(n)), monto });
  }
  const siguiente = partes.find((p) => !p.pagada);
  return {
    ok: true,
    // Solo el primer nombre: el enlace puede reenviarse por WhatsApp y no
    // tiene por que exponer el correo ni el nombre completo de nadie.
    nombre: String(customer.name || '').trim().split(/\s+/)[0] || '',
    partes,
    siguiente: siguiente ? siguiente.n : null,
    completo: !siguiente,
    montoParte: monto,
    total: monto * PLAN_PARTES,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    // Rama: adjuntar Customer a un PaymentIntent existente (antes de cobrar).
    if (body.action === 'attach-customer') {
      try {
        const result = await attachCustomer({
          paymentIntentId: body.paymentIntentId,
          name: body.name ? String(body.name).trim() : '',
          email: body.email ? String(body.email).trim() : '',
          phone: body.phone ? String(body.phone).trim() : '',
        });
        return res.status(200).json(result);
      } catch (e) {
        console.error('attach-customer error:', e.message);
        return res.status(200).json({ ok: false, error: e.message }); // nunca bloquear el pago
      }
    }

    // Rama: estado del plan de 2 partes. La consulta la pagina /pago-en-2-partes/ al abrir,
    // para pintar que parte ya esta pagada y cual toca.
    if (body.action === 'plan-status') {
      const planId = String(body.planId || '').trim();
      if (!planId.startsWith('cus_')) return res.status(200).json({ ok: false, motivo: 'invalido' });
      try {
        return res.status(200).json(await planEstado(planId));
      } catch (e) {
        console.error('plan-status:', e.message);
        return res.status(200).json({ ok: false, motivo: 'error' });
      }
    }

    // Rama: corregir los datos de la clienta ANTES de cobrar.
    // El correo es lo mas critico de todo el plan: por ahi recibe el enlace
    // para pagar la segunda parte. Una letra mal tecleada la deja sin enlace,
    // sin recibo y sin forma de que Anny la ubique. Por eso se puede corregir
    // hasta el ultimo segundo, y el cambio viaja tambien al PaymentIntent.
    if (body.action === 'plan-datos') {
      try {
        const planId = String(body.planId || '').trim();
        if (!planId.startsWith('cus_')) return res.status(200).json({ ok: false });
        const email = limpiarCorreo(body.email);
        const tel = telefonoNormalizado(body.phone, body.pais);
        await stripe.customers.update(planId, {
          name: String(body.name || '').trim() || undefined,
          email: email || undefined,
          phone: tel.valor || undefined,
          // Stripe fusiona metadata en update: no pisa plan ni product.
          metadata: { tel_ok: tel.verificado ? 'si' : 'no' },
        });
        const piId = String(body.paymentIntentId || '').trim();
        if (piId.startsWith('pi_') && email) {
          await stripe.paymentIntents.update(piId, { receipt_email: email });
        }
        return res.status(200).json({ ok: true });
      } catch (e) {
        console.error('plan-datos:', e.message);
        return res.status(200).json({ ok: false, error: e.message }); // nunca bloquear el pago
      }
    }

    // Rama: cobrar la parte que toca. El SERVIDOR decide cual es —
    // nunca el navegador. Si el numero de parte viniera del cliente,
    // cualquiera podria pedir "parte 2" sin haber pagado la 1.
    if (body.action === 'plan-pay') {
      try {
        let planId = String(body.planId || '').trim();
        let customer;

        if (planId.startsWith('cus_')) {
          customer = await stripe.customers.retrieve(planId);
          if (!customer || customer.deleted) return res.status(400).json({ error: 'plan_no_existe' });
        } else {
          const email = limpiarCorreo(body.email);
          if (!email) return res.status(400).json({ error: 'falta_correo' });

          // Si esta clienta YA empezo su plan (pago en el celular y ahora abre
          // el enlace en otra computadora, o borro los datos del navegador),
          // se retoma el que tiene. Sin esto pagaria la primera parte DOS VECES:
          // el navegador no la reconoce, pero su correo si.
          const previos = await stripe.customers.list({ email, limit: 10 });
          const suyo = (previos.data || []).find(
            (c) => c && !c.deleted && c.metadata && c.metadata.plan === PLAN_ID,
          );

          if (suyo) {
            customer = suyo;
            planId = suyo.id;
          } else {
            // Plan de prueba ($1 por parte): solo si existe la env LIVE_TEST_CODE
            // y la piden con ese codigo. Sin la variable, ningun codigo sirve.
            const clave = process.env.LIVE_TEST_CODE;
            const esPrueba = !!clave &&
              String(body.code || '').trim().toUpperCase() === String(clave).trim().toUpperCase();

            const telNuevo = telefonoNormalizado(body.phone, body.pais);
            const meta = {
              product: 'next-fly-academy',
              plan: PLAN_ID,
              tel_ok: telNuevo.verificado ? 'si' : 'no',
            };
            if (esPrueba) meta.prueba = '1';

            customer = await stripe.customers.create({
              name: String(body.name || '').trim() || undefined,
              email,
              phone: telNuevo.valor || undefined,
              metadata: meta,
            });
            planId = customer.id;
          }
        }

        const pagadas = await planPartesPagadas(planId);
        let parte = 0;
        for (let n = 1; n <= PLAN_PARTES; n++) {
          if (!pagadas.has(String(n))) { parte = n; break; }
        }
        if (!parte) return res.status(200).json({ completo: true, planId });

        const monto = montoParteDe(customer);
        const pi = await stripe.paymentIntents.create({
          amount: monto,
          currency: 'usd',
          customer: planId,
          receipt_email: customer.email || undefined,
          automatic_payment_methods: { enabled: true },
          description: `Next Flight Academy — parte ${parte} de ${PLAN_PARTES}`,
          metadata: { product: 'next-fly-academy', plan: PLAN_ID, parte: String(parte) },
        });

        return res.status(200).json({
          clientSecret: pi.client_secret,
          planId,
          parte,
          amount: monto,
          total: monto * PLAN_PARTES,
        });
      } catch (e) {
        console.error('plan-pay:', e.message);
        // Decirle a la clienta QUE esta mal. Un "intentalo mas tarde" generico
        // la dejo reintentando diez veces con un correo que nunca iba a pasar.
        const esCorreo = /email/i.test(e.message || '');
        return res.status(esCorreo ? 400 : 500).json({
          error: esCorreo
            ? 'Revisa tu correo electrónico: no parece válido. Comprueba que no tenga un punto o un espacio de más.'
            : 'No pudimos preparar el pago. Inténtalo de nuevo en un momento.',
        });
      }
    }

    // Rama por defecto: crear el PaymentIntent.
    const code = body.code ? String(body.code).trim() : '';
    const amount = priceFor(code);

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      description: 'Next Flight Academy',
      metadata: { product: 'next-fly-academy', code: code },
    });

    res.status(200).json({ clientSecret: paymentIntent.client_secret, amount });
  } catch (error) {
    console.error('Stripe error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

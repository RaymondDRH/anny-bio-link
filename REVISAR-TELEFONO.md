# Pendiente: revisión adversarial del cambio del teléfono

> Este archivo existe para que, tras compactar, la revisión pueda ejecutarse
> sin tener que reconstruir el contexto. Borrar cuando la revisión esté hecha.

## Qué revisar

```
Repositorio: /home/raymond/Anny Gomez/anny-bio-link
Rama:        fix/validar-telefono   (NO mergeada — el preview ya está probado)
Base:        main
Diff:        git diff main...fix/validar-telefono
Commit:      7cd2f73
```

**Archivos tocados**
- `lib/telefono.js` (nuevo) — normaliza a E.164 con libphonenumber-js
- `api/leads.js` — usa la normalización antes de guardar
- `next-fly-academy/index.html` — filtro al escribir + validación al enviar
- `package.json` — dependencia nueva `libphonenumber-js@^1.13.10`

## El bug original

El campo de teléfono aceptaba texto libre. Se podía escribir `kjhkjhkjhkhkk`
y eso llegaba a Stripe y a la base de datos. Causa: `type="tel"` no valida
nada (solo cambia el teclado en móvil) y la única comprobación era que el
campo no estuviera vacío.

## Contexto de negocio que la revisión DEBE tener en cuenta

- Es la página que cobra **$697**. Cada venta perdida es real.
- La audiencia es de **mujeres hispanohablantes en EE.UU. y Latinoamérica** —
  los números de esos países son justo donde más falla la validación genérica.
- El teléfono se usa para **escribir por WhatsApp** a quien abandona el pago.
- El sitio es HTML plano servido por Vercel, sin build step en el navegador.

## Reglas que el cambio debe respetar

1. **FAIL-OPEN HACIA LA VENTA.** Ningún fallo de validación, normalización o
   guardado puede impedir que alguien complete un pago.
2. **Permisivo para rechazar, estricto para normalizar.** Rechazar un número
   válido cuesta una venta entera; guardar un formato inconsistente solo
   ensucia datos.
3. `normalizarTelefono` **nunca puede lanzar**, con ninguna entrada.
4. No se pueden crear funciones nuevas en `api/` — hay **12 y el límite del
   plan Hobby es 12**. Todo va en `api/leads.js` o en `lib/`.

## Dimensiones sugeridas para la revisión

- **Correctitud del parseo**: números válidos que se rechacen (falsos
  negativos) — es el fallo más caro. Probar formatos reales de MX, CO, VE,
  AR, PE, CL, EC, DO, ES.
- **Seguridad**: ¿se puede evadir el filtro del navegador? ¿inyectar algo por
  el campo? ¿el servidor confía en el cliente en algún punto?
- **Fail-open**: ¿hay algún camino en que un fallo del teléfono bloquee el
  pago o rompa el modal?
- **UX móvil**: el filtro manipula `value` y la posición del cursor mientras
  se escribe. ¿Se rompe con teclados predictivos, autocompletado o al pegar?
- **Regresión**: ¿sigue funcionando el resto del modal? ¿los otros consumidores
  de `api/leads.js` (quiz, reset, guía, blog) siguen igual?

## Ya verificado (no hace falta repetirlo, sí cuestionarlo)

- 14 pruebas de `normalizarTelefono` incluyendo MX, CO, VE, ES y entradas raras
- 7 pruebas de la cadena completa: filtro → validación → servidor
- Prueba real contra el endpoint del preview: `kjhkjhkjhkhkk` se bloquea,
  `+1 (251) 650-9950` → `+12516509950`, `+52 55 1234 5678` → `+525512345678`
- Sintaxis validada con `node --check`
- Sigue en 12 funciones serverless

## Estado

- [x] Implementado y probado en preview
- [ ] **Revisión adversarial** ← pendiente
- [ ] Aprobación de Raymond
- [ ] Merge a main y `vercel --prod`

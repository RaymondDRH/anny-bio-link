// Los 3 productos de la tarjeta «Tienda de recursos» del bio-link.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ UNA FUNCIÓN Y NO UN fetch DESDE LA PÁGINA (26-sep-2026)
//
// La API pública de WooCommerce (Store API) responde, pero SIN la cabecera
// `Access-Control-Allow-Origin`: el navegador no deja que annygomez.com la lea
// directamente. Aquí se pide desde el servidor, donde CORS no aplica, y se
// devuelve ya reducido a lo que la tarjeta pinta.
//
// La respuesta se guarda en la caché de Vercel una hora (y sirve la vieja
// mientras refresca), así que la tienda recibe una visita por hora, no una
// por cada persona que abre el bio-link desde Instagram.
//
// QUÉ PRODUCTOS SALEN
//
// El orden lo manda la tienda (menu_order): quien reordena el catálogo en
// WordPress reordena también esto. De ahí se toma el primero de cada
// categoría (para que no salgan tres guías gratis seguidas, que además ya
// tienen su propia tarjeta debajo) y luego se rellena en el mismo orden.
//
// Fuera: lo que no se puede conseguir hoy (Próximamente) y la academia, que
// tiene su propio banner en el bio-link. Entran: lo comprable o gratis, y los
// libros de Amazon.
// ─────────────────────────────────────────────────────────────────────────

const STORE_API = 'https://recursos.annygomez.com/wp-json/wc/store/v1/products?per_page=50&orderby=menu_order&order=asc';
const CUANTOS = 3;

const esAmazon = (url) => /(^|\.)(amazon\.[a-z.]+|amzn\.to|a\.co)$/i.test(hostDe(url));

function hostDe(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function etiquetaPrecio(p) {
  if (p.type === 'external') return esAmazon(p.add_to_cart && p.add_to_cart.url) ? 'Ver en Amazon' : '';
  const unidades = Number(p.prices.price) / Math.pow(10, p.prices.currency_minor_unit || 0);
  if (!unidades) return 'Gratis';
  const texto = Number.isInteger(unidades) ? String(unidades) : unidades.toFixed(2);
  return (p.prices.currency_prefix || '$') + texto + (p.prices.currency_suffix || '');
}

// La imagen más pequeña del srcset que siga siendo nítida en una tarjeta de
// ~150 px a doble densidad. Si no hay srcset, la original.
function imagenDe(p) {
  const img = p.images && p.images[0];
  if (!img) return '';
  const opciones = String(img.srcset || '').split(',').map((s) => {
    const [url, w] = s.trim().split(/\s+/);
    return { url, w: parseInt(w, 10) || 0 };
  }).filter((o) => o.url && o.w >= 600);
  opciones.sort((a, b) => a.w - b.w);
  return opciones.length ? opciones[0].url : img.src;
}

function elegibles(productos) {
  return productos.filter((p) => {
    if (p.type === 'external') return esAmazon(p.add_to_cart && p.add_to_cart.url);
    return p.is_purchasable;
  });
}

function elegir(productos) {
  const vistas = new Set();
  const primero = [];
  const resto = [];
  for (const p of productos) {
    const cat = (p.categories[0] && p.categories[0].slug) || '';
    if (!vistas.has(cat)) { vistas.add(cat); primero.push(p); } else { resto.push(p); }
  }
  // Lo primero de cada categoría, pero respetando el orden de la tienda.
  const orden = new Map(productos.map((p, i) => [p.id, i]));
  const elegidos = primero.slice(0, CUANTOS);
  for (const p of resto) { if (elegidos.length >= CUANTOS) break; elegidos.push(p); }
  return elegidos.sort((a, b) => orden.get(a.id) - orden.get(b.id));
}

module.exports = async (req, res) => {
  try {
    const r = await fetch(STORE_API, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('La tienda respondió ' + r.status);
    const productos = await r.json();
    const datos = elegir(elegibles(productos)).map((p) => ({
      nombre: p.name.replace(/&amp;/g, '&').replace(/&#8217;/g, '’'),
      url: p.permalink,
      imagen: imagenDe(p),
      precio: etiquetaPrecio(p),
    }));
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ productos: datos });
  } catch (e) {
    // Sin caché: si la tienda falla, que se reintente en la siguiente visita.
    // La página ya trae los productos escritos en el HTML y se queda con ellos.
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ productos: [], error: 'No se pudo leer la tienda' });
  }
};

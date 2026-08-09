-- Esquema y funciones de la tabla de leads del checkout.
--
-- Estado actual en Supabase, volcado el 9 de agosto de 2026. Esta aqui porque
-- las reglas mas delicadas del embudo NO viven en el codigo de la aplicacion:
-- viven en estas dos funciones. Sin este archivo no hay forma de auditarlas
-- leyendo el repositorio.
--
-- ┌─ POR QUE FUNCIONES Y NO INSERT/UPDATE DIRECTOS ────────────────────────┐
-- │                                                                        │
-- │ La tabla tiene RLS con UNA sola politica: insercion. Para hacer un      │
-- │ UPDATE, Postgres necesita LEER la fila y evaluar la condicion de la     │
-- │ politica. Sin politica de lectura, ninguna fila es visible para el rol  │
-- │ anonimo: el UPDATE afectaba 0 filas y devolvia 200. Fallo silencioso.   │
-- │                                                                        │
-- │ Lo facil era anadir una politica de lectura. Eso habria expuesto TODOS  │
-- │ los leads a cualquiera con la clave publica, que va en el HTML.         │
-- │                                                                        │
-- │ En su lugar, funciones SECURITY DEFINER: se ejecutan con los permisos   │
-- │ de quien las creo, no de quien las llama, hacen solo su cambio concreto │
-- │ y no devuelven ni una fila de la tabla. Se abre la puerta justa.        │
-- └────────────────────────────────────────────────────────────────────────┘

-- ── Columnas ────────────────────────────────────────────────────────────────
-- telefono       E.164 (+573001234567). NUNCA adivinado: sale del '+' que
--                escribio la persona o del pais que declaro en el formulario.
-- telefono_crudo El texto tal como llego, sin reinterpretar. Es el seguro: si
--                la normalizacion se equivoca, el dato real sigue existiendo y
--                el error es reprocesable en vez de definitivo.
-- telefono_ok    true solo si libphonenumber lo verifico. false = compuesto,
--                no verificado. Permite distinguir un dato fiable de uno que
--                solo tiene forma de telefono.
alter table anny.leads
  add column if not exists telefono_crudo text,
  add column if not exists telefono_ok    boolean;


-- ── Guardar el lead del checkout ────────────────────────────────────────────
--
-- El lead se guarda ANTES de validar el formato, para no perder a quien se
-- frustra y cierra el modal. Pero leads.email es UNIQUE: si ella corrige y
-- reenvia, un INSERT normal choca con el UNIQUE y se descarta en silencio.
-- Nos quedariamos con el telefono MALO y tirariamos el bueno.
--
-- Tres reglas, y la tercera es la que se olvida:
--   1. El telefono nuevo gana, SALVO que el nuevo no este verificado y el
--      viejo si. Asi la correccion siempre vence al intento fallido, y nunca
--      al reves.
--   2. 'compro' esta protegido y nunca revierte a 'intentando'. Revertirlo
--      haria que se le escriba preguntandole por que abandono a una clienta
--      que ya pago.
--   3. Las tres columnas del telefono se mueven JUNTAS. Actualizar el numero
--      sin actualizar su marca de verificacion produce una fila incoherente:
--      un telefono nuevo con el sello de calidad del anterior.
create or replace function anny.guardar_lead_checkout(
  p_name           text,
  p_email          text,
  p_origen         text,
  p_telefono       text,
  p_telefono_crudo text,
  p_telefono_ok    boolean,
  p_producto       text
) returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_origen text := nullif(btrim(coalesce(p_origen, '')), '');
  v_prod   text := nullif(btrim(coalesce(p_producto, '')), '');
  v_tel    text := nullif(btrim(coalesce(p_telefono, '')), '');
  v_crudo  text := nullif(btrim(coalesce(p_telefono_crudo, '')), '');
  v_ok     boolean := p_telefono_ok;
  v_tel_actual text;
  v_ok_actual  boolean;
  v_usar_nuevo boolean;
begin
  if v_email = '' then return 'sin_email'; end if;

  insert into anny.leads (name, email, origen, telefono, telefono_crudo, telefono_ok, producto, estado)
  values (coalesce(v_name, 'Checkout'), v_email, v_origen, v_tel, v_crudo, v_ok, v_prod, 'intentando')
  on conflict (email) do nothing;

  if found then return 'nuevo'; end if;

  select telefono, telefono_ok into v_tel_actual, v_ok_actual
    from anny.leads where email = v_email;

  -- Regla 1: solo un verificado sobrevive a uno sin verificar.
  v_usar_nuevo := v_tel is not null
                  and (v_tel_actual is null or v_ok is true or v_ok_actual is not true);

  update anny.leads set
    name     = coalesce(nullif(name, ''), v_name, name),
    origen   = coalesce(origen, v_origen),
    producto = coalesce(producto, v_prod),
    -- Regla 3: los tres campos del telefono, juntos o ninguno.
    telefono       = case when v_usar_nuevo then v_tel   else telefono end,
    telefono_ok    = case when v_usar_nuevo then v_ok    else telefono_ok end,
    telefono_crudo = case when v_usar_nuevo then v_crudo else coalesce(telefono_crudo, v_crudo) end,
    -- Regla 2: acaba de intentar comprar. Salvo que ya haya comprado.
    estado = case when estado = 'compro' then estado else 'intentando' end
  where email = v_email;

  return 'actualizado';
exception when others then
  -- Guardar un lead JAMAS puede tumbar la peticion del checkout.
  return 'error: ' || sqlerrm;
end;
$function$;

revoke all on function anny.guardar_lead_checkout(text, text, text, text, text, boolean, text) from public;
grant execute on function anny.guardar_lead_checkout(text, text, text, text, text, boolean, text) to anon, authenticated;


-- ── Cerrar el ciclo: 'intentando' -> 'compro' ───────────────────────────────
--
-- La llaman los dos confirmadores de pago: el webhook de Stripe y la captura
-- de PayPal. Devuelve cuantas filas cambio.
--
-- Devolver 0 es NORMAL, no un error: alguien puede pagar sin haber pasado por
-- el formulario. Ojo con esto — durante un tiempo ese 0 legitimo escondio un
-- bug real (PayPal nunca creaba el lead, asi que siempre eran 0 filas y nadie
-- se enteraba). Un contador de filas afectadas dice mas que un codigo 200,
-- pero solo si alguien lo mira.
create or replace function anny.marcar_lead_comprado(p_email text)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare n integer;
begin
  if p_email is null or btrim(p_email) = '' then return 0; end if;
  update anny.leads
     set estado = 'compro'
   where lower(email) = lower(btrim(p_email))
     and estado = 'intentando';
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function anny.marcar_lead_comprado(text) from public;
grant execute on function anny.marcar_lead_comprado(text) to anon, authenticated;

#!/usr/bin/env bash
# Publica las guías gratis en sus dos casas y comprueba que las dos tienen el MISMO archivo.
#
#   original (este repo, guias/)
#      ├──► Vercel      → bio-link y ManyChat, enlace público. Se publica con git:
#      │                  push a main (rama → vista previa → aprobación → merge).
#      └──► SiteGround  → tienda, copia PRIVADA fuera de la web (NO-PERDER Q27 del
#                         tema). Esto lo hace este script.
#
# Uso:  scripts/publicar-guias.sh            copia a la tienda y verifica
#       scripts/publicar-guias.sh --revisar  solo compara, no copia nada
#
# Por qué no es automático: haría falta guardar la llave SSH de SiteGround en
# GitHub, y esa llave abre todo el hosting. Las guías cambian poco (decisión de
# Raymond, 23-09-2026).
set -euo pipefail

cd "$(dirname "$0")/.."

SSH=siteground-anny
PRIVADA=/home/customer/www/recursos.annygomez.com/descargas-privadas/guias-gratis
BIO=https://annygomez.com

# ruta en este repo  →  nombre en la tienda
GUIAS=(
	"guias/invierte-en-ti/invierte-en-ti.pdf:invierte-en-ti.pdf"
	"guias/reset-5-minutos/reset-5-minutos.pdf:reset-5-minutos.pdf"
	"guias/guia-habitos.pdf:guia-habitos.pdf"
)

huella() { md5sum | cut -c1-12; }
fallos=0

for par in "${GUIAS[@]}"; do
	local_ruta="${par%%:*}"
	nombre="${par##*:}"

	if [ "${1:-}" != "--revisar" ]; then
		scp -q "$local_ruta" "$SSH:$PRIVADA/$nombre"
	fi

	h_local=$(huella < "$local_ruta")
	h_tienda=$(ssh -o BatchMode=yes "$SSH" "cat '$PRIVADA/$nombre'" | huella)
	h_bio=$(curl -sfL "$BIO/$local_ruta" | huella)

	estado="OK"
	[ "$h_tienda" = "$h_local" ] || { estado="TIENDA DISTINTA"; fallos=1; }
	[ "$h_bio" = "$h_local" ] || { estado="$estado · BIO-LINK DISTINTO (¿falta el merge a main?)"; fallos=1; }

	printf '%-44s local %s  tienda %s  bio-link %s  %s\n' "$local_ruta" "$h_local" "$h_tienda" "$h_bio" "$estado"
done

exit $fallos

# Ofirent-Altius

Monorepo con 3 sitios estáticos independientes para las marcas **OfiRent** (renta de oficinas equipadas/virtuales/coworking en CDMX, 6 sedes) y **Torre Altius** (edificio corporativo en Jurica, Querétaro), operadas por el mismo grupo. Un tercer sitio es una encuesta interna de reseñas para ambas marcas.

## Flujo de trabajo entre sesiones (OBLIGATORIO)

Este repo se trabaja en paralelo desde más de una sesión de Claude Code (local y en la nube) al mismo tiempo. Para que una decisión tomada en una sesión sí llegue a la otra, en vez de depender de que alguien avise a mano, la regla es:

- **Nunca hacer push directo a `main`.** Todo cambio va en una rama nueva (`claude/<algo-descriptivo>`) y se abre un Pull Request en GitHub. `main` solo avanza fusionando PRs.
- **Antes de empezar cualquier tarea**, correr `git fetch origin main` y revisar `git log HEAD..origin/main --oneline` para ver si hay commits nuevos que la otra sesión ya fusionó, antes de asumir el estado del repo.
- **Ninguna decisión de negocio/dato real** (precios, plazos de contrato, disponibilidad, textos legales, políticas comerciales, etc.) cuenta como "decidida" hasta que quede escrita en la sección "Decisiones confirmadas con el cliente" de este mismo archivo y esté fusionada a `main`. Este archivo es lo único que ambas sesiones leen automáticamente al arrancar, así que es el mecanismo real de sincronización, no un mensaje que alguien tiene que recordar reenviar.
- Si encuentras que dos fuentes (este archivo, un brief, lo que dijo el cliente en otra sesión) dicen cosas distintas sobre el mismo dato, no elijas una por tu cuenta: pregúntale al usuario y, una vez resuelto, actualiza esta sección para que no se vuelva a contradecir.

### Decisiones confirmadas con el cliente
- Membresía Oro de coworking (incluye domicilio fiscal/comercial): contrato mínimo **6 meses**, no 1 año.

## Qué hace cada sitio

- **`ofirent-cdmx-site/`** — Sitio principal de OfiRent CDMX. Home con hero, servicios (oficina virtual/equipada/coworking), las 6 ubicaciones, planes, FAQ, formulario de contacto. Más: 6 páginas de ubicación en `/ubicaciones/renta-oficinas-colonia-*/` (vía rewrites de `vercel.json`, archivos físicos siguen siendo `ubicacion-*.html`), 3 páginas de servicio dedicadas en `/servicios/`, y el blog completo migrado de WordPress (94 posts reales en `/blog/<slug>/`, generados por `blog-data/generate_blog.py` a partir de `blog-data/wp-posts-raw.json`). Las URLs ya calzan 1:1 con las del sitio real en WordPress (`ofirent.com.mx`), pensado para cuando se apunte el dominio real — ver la sección de "Contexto de negocio" más abajo antes de tocar eso.
- **`torre-altius-site/`** — Sitio de Torre Altius Querétaro (una sola página, `index.html`). Hero con foto real del edificio, oficinas disponibles, salas de juntas/capacitación, inquilinos reales (TV Azteca, Bepensa, RAC, Forvia), planes de oficina virtual, FAQ, contacto.
- **`ofirent-resenas-site/`** — Landing interna de una sola página con flujo de calificación por estrellas: 4-5★ redirige a la reseña de Google de la sucursal seleccionada, 1-3★ abre un formulario (comentario/nombre/teléfono) que se guarda en Airtable vía una función serverless. Pensado para repartirse con un flyer/QR en las oficinas, **no es parte del sitio público de marketing**.

## Stack

Los 3 son **HTML/CSS/JS puro, sin framework ni build step** (no hay `node_modules`, `package.json` ni bundler). Cada carpeta se despliega directo a Vercel tal cual está. La única excepción es `ofirent-resenas-site/api/review.js`, una función serverless de Node que Vercel detecta automáticamente por vivir en `/api`.

- Tipografías: **Big Shoulders Display** (condensada, para títulos) + **Public Sans** (cuerpo). En `ofirent-cdmx-site` y `torre-altius-site` están auto-hospedadas como `.woff2` en `/assets`; en `ofirent-resenas-site` se cargan desde Google Fonts CDN.
- **Nunca usar fuente monoespaciada** (`--mono`) en ningún sitio — regla de marca explícita del cliente. Ya se quitó de `ofirent-cdmx-site`; si aparece en `torre-altius-site` no tocar a menos que se pida.
- **Nunca usar guion largo (—/em dash)** en ningún texto de ningún sitio — usar coma, punto o `·`. Antes de dar por cerrado cualquier cambio de copy, correr `grep -c "—" archivo.html` y debe dar 0.

## Diseño / paleta por sitio

**OfiRent** (`ofirent-cdmx-site`, verde institucional):
```
--ink:#13201a  --green:#1c8449  --green-deep:#0e5c33  --green-light:#5cc082
--gold:#e9a63b --paper:#f5f6f4  --paper-raised:#ffffff --line:#dbe0da --steel:#5f6b62
```
Modo oscuro del sistema **desactivado a propósito** (el sitio se ve igual sin importar el tema del visitante).

**Torre Altius** (`torre-altius-site`, azul/navy técnico):
```
--ink:#0c161f  --navy:#0e2233  --navy-deep:#081420  --blue:#0071ae  --blue-light:#3fa9e0
--paper:#f4f6f7 --paper-raised:#ffffff --line:#d7dfe3 --steel:#5b6770
```
Este sitio sí respeta `prefers-color-scheme` (tiene modo oscuro real).

**Encuestas** (`ofirent-resenas-site`, verde más suave, cards redondeadas):
```
--green:#1f5d40 --green-dark:#153e2b --paper:#f7f8f5 --gold:#f2a93b (color de las estrellas)
--radius:22px --radius-sm:14px
```

Ambos sitios principales usan bordes muy redondeados (16-22px en tarjetas/paneles, 10px en botones) — evitar esquinas cuadradas de 3-4px, se sintió "genérico/IA" en feedback real del cliente.

## Archivos clave

- `ofirent-cdmx-site/assets/site.css` — CSS compartido por `index.html` y las 6 páginas de ubicación. **Si se edita el CSS en un editor externo antes de copiarlo aquí, hay que sincronizar manualmente** — no hay build step que lo haga solo.
- `torre-altius-site/index.html` — todo el CSS vive inline en `<style>` dentro del mismo archivo (no está separado como en OfiRent).
- `ofirent-resenas-site/index.html` — tiene un bloque `CONFIG` claramente marcado ("ZONA EDITABLE") al inicio del `<script>` con todos los textos, el umbral de estrellas, y los 6 links de reseña de Google por ubicación (`positiveLinks`). Editar solo ahí para cambios de copy/links.
- `ofirent-resenas-site/api/review.js` — función serverless que escribe en Airtable. El token vive en variables de entorno de Vercel, nunca en el código.
- **Elementos del 20 aniversario, todos TEMPORALES, quitar en 2027** (instrucción explícita del cliente, 2026-08-17): logo `assets/logo-20-anos.png` (referenciado en las 110 páginas + `generate_blog.py`, revertir a `logo.png` original que sigue intacto), banner superior `.anniversary-banner` en `index.html`, y el video de intro a pantalla completa `.anniv-intro` (`aniversario-20-anos-desktop.mp4` / `-mobile.mp4`) también en `index.html`. El sistema de cookies/GA4 NO es parte de esto, es permanente.
- `ofirent-cdmx-site/assets/cookie-consent.js` y `torre-altius-site/assets/cookie-consent.js` — banner de consentimiento de cookies (Aceptar/Rechazar) que carga GA4 solo si el visitante acepta. Referenciado con `<script src="/assets/cookie-consent.js" defer></script>` antes de cerrar `</body>` en las 110 páginas de OfiRent (incluido el template `FOOTER` de `generate_blog.py`, para que sobreviva regeneraciones del blog) y en el único `index.html` de Altius. **`GA_MEASUREMENT_ID` está en `'G-PENDIENTE'` en ambos archivos** — reemplazar por el ID real (`G-XXXXXXXXXX`) cuando se tenga; mientras tanto el banner funciona pero no manda datos a ningún lado.

**Nota:** los scripts generadores originales (`build_locations.js` para las 6 páginas de ubicación de OfiRent, `build_prod.js` para Altius) vivían en un scratchpad de sesión y no se incluyeron en este repo — el HTML aquí es el resultado ya compilado. Para futuras ediciones, editar el HTML/CSS directamente en su archivo final; no existe un paso de "rebuild" automático.

## Cómo hacer deploy

**Los 3 proyectos ya están conectados a GitHub en Vercel** (confirmado 2026-08-20 revisando `vercel api /v9/projects/<nombre>` de cada uno — los tres tienen `link.type: "github"` apuntando a este repo). Fusionar un PR a `main` dispara un deploy automático a producción para el sitio correspondiente. **Ya no uses `npx vercel deploy --prod` manualmente** para desplegar cambios normales — con git conectado, ese comando puede generar una build rota (ver incidente abajo). Deja que el merge a `main` dispare el deploy solo, y verifica con `curl` contra el dominio real después de fusionar.

Team de Vercel: **`fully-promoted-qro`**. Nombres de proyecto (pueden no calzar 1:1 con el nombre de la carpeta):
- `ofirent-cdmx-site` (carpeta `ofirent-cdmx-site/`) → https://ofirent-cdmx-site.vercel.app / https://www.ofirent.com.mx
- `torre-altius-site` (carpeta `torre-altius-site/`) → https://torre-altius-site.vercel.app / https://torrealtius.com
- `ofirent-resenas` (carpeta `ofirent-resenas-site/`, ojo que el nombre del proyecto en Vercel NO lleva "-site") → https://ofirent-resenas.vercel.app

**`ofirent.com.mx` ya está apuntado y en vivo** (confirmado por el cliente, 2026-08-20) — el DNS quedó apuntando a Vercel, con redirect 308 de `ofirent.com.mx` → `www.ofirent.com.mx`. `torrealtius.com` también está apuntado y en vivo (verificado 2026-08-20).
- `torre-altius-site/vercel.json` ya tiene los 301 redirects de las 5 URLs viejas indexadas del WordPress real (`/buscas-la-mejor-oficina-para-tu-empresa/`, `/oficinas-en-queretaro-renta/`, `/desde-346m2/`, `/desde-23m2/`, `/renta-de-oficinas-en-queretaro/`) hacia `/`, ya que son variantes casi duplicadas con contenido de 2019-2020 desactualizado (pisos que ya no se rentan) — no vale la pena reconstruirlas, mejor consolidar el link equity en el home nuevo.
- En ambos dominios: **no tocar nameservers ni registros MX/correo existentes**.

### Incidente 2026-08-20: build rota en producción por `rootDirectory` sin configurar

Al conectar `ofirent-cdmx-site` a GitHub en Vercel, el proyecto quedó con `rootDirectory: null` a nivel de Project Settings. Un `npx vercel deploy --prod` corrido manualmente desde dentro de `ofirent-cdmx-site/` disparó una build **basada en git** (clonó el repo completo, no subió los archivos locales) que, al no tener `rootDirectory` configurado, construyó desde la raíz del monorepo en vez de desde `ofirent-cdmx-site/` — la build terminó en ~300ms sin generar ningún archivo, y `www.ofirent.com.mx` quedó devolviendo 404 en producción durante varios minutos.

Se corrigió seteando `rootDirectory: "ofirent-cdmx-site"` en el proyecto vía API (`vercel api -X PATCH /v9/projects/<id> -F rootDirectory=ofirent-cdmx-site`) y forzando un rebuild con `vercel redeploy <deployment-url> --scope fully-promoted-qro`.

**Actualización, misma tarde:** `torre-altius-site` y `ofirent-resenas` tenían el mismo problema (`rootDirectory: null`), no solo `ofirent-cdmx-site` como se pensó al inicio. Los tres quedaron conectados a GitHub el mismo día y los tres se cayeron (404) apenas se disparó el primer build vía git de cada uno, cada vez que se fusionó un PR a `main`. **Los tres ya están corregidos** (`rootDirectory` seteado a su carpeta correspondiente) y verificados en vivo:
- `ofirent-cdmx-site` → `rootDirectory: "ofirent-cdmx-site"`
- `torre-altius-site` → `rootDirectory: "torre-altius-site"`
- `ofirent-resenas` → `rootDirectory: "ofirent-resenas-site"`

Este es un ajuste de configuración de Vercel (no vive en el código de este repo), así que no hay forma de que un futuro PR lo revierta por accidente — pero si alguna vez alguien reconecta o recrea uno de estos proyectos en Vercel desde cero, hay que volver a setear su `rootDirectory` de inmediato, antes de que llegue el primer push a `main`.

**Si un manual deploy es realmente necesario** (algo salió mal y no querés esperar a un push), usa `vercel redeploy <url-o-id-del-último-deployment> --scope fully-promoted-qro` en vez de `vercel deploy` — reconstruye desde el commit ya vinculado respetando el `rootDirectory` del proyecto. Nota para PowerShell/Git Bash en Windows: los comandos `vercel api /v9/...` necesitan `MSYS_NO_PATHCONV=1` antes del comando en Git Bash, porque MSYS convierte el path que empieza con `/` a una ruta de Windows y el CLI lo rechaza.

## Variables de entorno

Solo `ofirent-resenas-site` las necesita, ya configuradas directamente en el dashboard de Vercel (target: Production, tipo "Sensitive" — no se pueden volver a leer desde la CLI):

| Variable | Uso |
|---|---|
| `AIRTABLE_TOKEN` | Personal Access Token de Airtable, scope `data.records:write` limitado a una sola base |
| `AIRTABLE_BASE_ID` | ID de la base de Airtable (`app...`) |
| `AIRTABLE_TABLE_NAME` | ID o nombre de la tabla destino |

Los otros dos sitios no requieren variables de entorno (son 100% estáticos, sin backend propio).

## Contexto de negocio relevante para no meter la pata

- **Nunca inventar reseñas, precios, disponibilidad ni datos de contacto.** Todo dato mostrado en el sitio debe venir de información real confirmada por el cliente. Si falta un dato, usar un placeholder claro o preguntar, no rellenar con algo plausible.
- **Nunca prometer disponibilidad en vivo** — es una decisión explícita de los dueños del negocio.
- `ofirent-resenas-site` implementa un patrón de "review gating" (filtra reseñas negativas antes de que lleguen a Google) — el cliente ya fue advertido de que esto contraviene las políticas de reseñas de Google y decidió proceder de todas formas. No es un bug, es intencional.
- Las 6 ubicaciones de OfiRent CDMX son sedes reales con direcciones, teléfonos y fichas de Google Business independientes entre sí — nunca tratar como una sola entidad genérica.

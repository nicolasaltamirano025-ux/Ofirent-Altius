# Ofirent-Altius

Monorepo con 3 sitios estáticos independientes para las marcas **OfiRent** (renta de oficinas equipadas/virtuales/coworking en CDMX, 6 sedes) y **Torre Altius** (edificio corporativo en Jurica, Querétaro), operadas por el mismo grupo. Un tercer sitio es una encuesta interna de reseñas para ambas marcas.

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
- `ofirent-cdmx-site/assets/cookie-consent.js` y `torre-altius-site/assets/cookie-consent.js` — banner de consentimiento de cookies (Aceptar/Rechazar) que carga GA4 solo si el visitante acepta. Referenciado con `<script src="/assets/cookie-consent.js" defer></script>` antes de cerrar `</body>` en las 110 páginas de OfiRent (incluido el template `FOOTER` de `generate_blog.py`, para que sobreviva regeneraciones del blog) y en el único `index.html` de Altius. **`GA_MEASUREMENT_ID` está en `'G-PENDIENTE'` en ambos archivos** — reemplazar por el ID real (`G-XXXXXXXXXX`) cuando se tenga; mientras tanto el banner funciona pero no manda datos a ningún lado.

**Nota:** los scripts generadores originales (`build_locations.js` para las 6 páginas de ubicación de OfiRent, `build_prod.js` para Altius) vivían en un scratchpad de sesión y no se incluyeron en este repo — el HTML aquí es el resultado ya compilado. Para futuras ediciones, editar el HTML/CSS directamente en su archivo final; no existe un paso de "rebuild" automático.

## Cómo hacer deploy

Cada carpeta es su propio proyecto de Vercel bajo el team **`fully-promoted-qro`** (ya autenticado vía `npx vercel` en esta máquina). Para desplegar cambios de cualquiera de los 3:

```bash
cd ofirent-cdmx-site   # o torre-altius-site / ofirent-resenas-site
npx vercel deploy --prod --yes --scope fully-promoted-qro
```

El `--scope` es necesario explícitamente (sin él, la CLI puede intentar resolver el team equivocado y falla con "Not authorized" aunque `.vercel/project.json` ya tenga el `orgId` correcto).

URLs de producción:
- OfiRent CDMX: https://ofirent-cdmx-site.vercel.app
- Torre Altius: https://torre-altius-site.vercel.app
- Encuestas: https://ofirent-resenas.vercel.app

Ninguno de los 3 apunta todavía a su dominio real (`ofirent.com.mx` / `torrealtius.com`) — ese cambio está pendiente de coordinarse con la agencia SEO del cliente para no perder posicionamiento (redirects 301, mismas URLs).

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

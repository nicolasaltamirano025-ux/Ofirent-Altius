#!/usr/bin/env python3
"""
Convierte el enlace "Ubicaciones" del menu superior (div.navlinks) de todas las paginas HTML de
ofirent-cdmx-site en un menu desplegable con las 6 sedes (solo CSS: se abre con el mouse o con el
teclado, ver "NAV-UBICACIONES" en assets/site.css). En movil no cambia nada: ahi se usa el menu
hamburguesa (#mobile-menu).

El enlace "Ubicaciones" conserva su href original (/#ubicaciones, #ubicaciones o /ubicaciones/),
asi que un clic sigue llevando a la seccion. El desplegable usa <span> (no <div>) para no romper
tools/add-referidos-nav.py, que busca el primer </div> de div.navlinks.

Es idempotente: correrlo dos veces no duplica nada. Conserva UTF-8 y los saltos de linea de cada
archivo. Toda pagina nueva del sitio debe llevarlo.

Uso:
  python tools/add-ubicaciones-menu.py --site ofirent-cdmx-site [--dry-run]
"""
import argparse
import re
import sys
from pathlib import Path

SEDES = [
    ("Nápoles", "renta-oficinas-colonia-napoles"),
    ("Del Valle", "renta-oficinas-colonia-del-valle"),
    ("Condesa", "renta-oficinas-colonia-condesa"),
    ("Roma", "renta-oficinas-colonia-roma"),
    ("Narvarte", "renta-oficinas-colonia-narvarte"),
    ("Cuauhtémoc", "renta-oficinas-colonia-cuauhtemoc"),
]
ITEMS = "".join(f'<a href="/ubicaciones/{slug}/">{name}</a>' for name, slug in SEDES)
NAVLINKS_RE = re.compile(r'(<div class="navlinks">)(.*?)(</div>)', re.S)
LINK_RE = re.compile(r'<a href="([^"]*)">Ubicaciones</a>')


def dropdown(href):
    return (
        '<span class="nav-dd">'
        f'<a href="{href}" class="nav-dd-trigger" aria-haspopup="true">Ubicaciones</a>'
        f'<span class="nav-dd-menu"><span class="nav-dd-menu-in">{ITEMS}</span></span>'
        '</span>'
    )


def convert(text):
    """Devuelve (texto_nuevo, estado) con estado en {'cambiado', 'ya_tenia', 'sin_enlace'}."""
    m = NAVLINKS_RE.search(text)
    if not m:
        return text, "sin_enlace"
    inner = m.group(2)
    if "nav-dd" in inner:
        return text, "ya_tenia"
    link = LINK_RE.search(inner)
    if not link:
        return text, "sin_enlace"
    new_inner = inner[: link.start()] + dropdown(link.group(1)) + inner[link.end():]
    return text[: m.start(2)] + new_inner + text[m.end(2):], "cambiado"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    root = Path(args.site)
    if not root.is_dir():
        sys.exit(f"No existe la carpeta {root}")
    counts = {"cambiado": 0, "ya_tenia": 0, "sin_enlace": 0}
    for path in sorted(root.rglob("*.html")):
        raw = path.read_bytes().decode("utf-8")
        new, status = convert(raw)
        counts[status] += 1
        if status == "sin_enlace":
            print(f"  sin menu con Ubicaciones: {path}")
        if status == "cambiado" and not args.dry_run:
            path.write_bytes(new.encode("utf-8"))
    print(counts)


if __name__ == "__main__":
    main()

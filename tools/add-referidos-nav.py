#!/usr/bin/env python3
"""
Agrega el enlace "Programa de referidos" a todas las paginas HTML de ofirent-cdmx-site:

  1. Menu superior (div.navlinks): <a class="nav-ref"> justo antes de "Acceso a clientes"
     (o antes del boton "Contacto" si la pagina no tiene ese enlace).
  2. Menu movil (#mobile-menu, solo donde existe): mismo enlace, sin clase.
  3. Pie (div.footer-bottom): entre "Blog" y "Aviso de privacidad".

Es idempotente: correrlo dos veces no duplica nada. Conserva UTF-8 y los saltos de
linea de cada archivo. Antes de escribir copia cada archivo modificado a --backup.

Uso:
  python tools/add-referidos-nav.py --site ofirent-cdmx-site --backup RUTA_RESPALDO [--dry-run]
"""
import argparse
import re
import shutil
import sys
from pathlib import Path

HREF = "/programa-de-referidos/"
LABEL = "Programa de referidos"
NAV_LINK = (
    f'<a href="{HREF}" class="nav-ref" aria-label="{LABEL}">'
    f'<span class="nav-ref-full">{LABEL}</span><span class="nav-ref-short">Referidos</span></a>'
)
MOBILE_LINK = f'<a href="{HREF}">{LABEL}</a>'
CLIENTS_RE = re.compile(r'<a href="https://sistema\.ofirent\.com\.mx/"')
NAVLINKS_RE = re.compile(r'(<div class="navlinks">)(.*?)(</div>)', re.S)
MOBILE_RE = re.compile(r'(<div class="wrap mobile-menu-inner">)(.*?)(</div>)', re.S)
CTA_RE = re.compile(r'<a href="[^"]*" class="nav-cta">')
FOOTER_OLD = '<a href="/blog/" style="color:inherit;">Blog</a> · <a href="/aviso-de-privacidad/"'
FOOTER_NEW = (
    '<a href="/blog/" style="color:inherit;">Blog</a> · '
    f'<a href="{HREF}" style="color:inherit;">{LABEL}</a> · '
    '<a href="/aviso-de-privacidad/"'
)


def insert_before_clients_or_cta(block: str, link: str, allow_cta: bool) -> str:
    m = CLIENTS_RE.search(block)
    if m:
        return block[: m.start()] + link + block[m.start():]
    if allow_cta:
        m = CTA_RE.search(block)
        if m:
            return block[: m.start()] + link + block[m.start():]
    raise ValueError("no hay punto de insercion")


def transform(text: str):
    changes = []

    def nav_sub(m):
        inner = m.group(2)
        if 'class="nav-ref"' in inner:
            return m.group(0)
        changes.append("nav")
        return m.group(1) + insert_before_clients_or_cta(inner, NAV_LINK, True) + m.group(3)

    text, n = NAVLINKS_RE.subn(nav_sub, text, count=1)
    if n != 1:
        raise ValueError("no se encontro div.navlinks")

    if 'id="mobile-menu"' in text:
        def mob_sub(m):
            inner = m.group(2)
            if HREF in inner:
                return m.group(0)
            changes.append("mobile")
            if CLIENTS_RE.search(inner):
                inner = insert_before_clients_or_cta(inner, MOBILE_LINK, False)
            else:
                # Menu movil corto (p. ej. aviso de privacidad): se agrega al final.
                stripped = inner.rstrip()
                inner = stripped + MOBILE_LINK + inner[len(stripped):]
            return m.group(1) + inner + m.group(3)

        text, n = MOBILE_RE.subn(mob_sub, text, count=1)
        if n != 1:
            raise ValueError("mobile-menu sin mobile-menu-inner")

    if FOOTER_NEW not in text:
        if text.count(FOOTER_OLD) != 1:
            raise ValueError("pie con formato inesperado")
        text = text.replace(FOOTER_OLD, FOOTER_NEW)
        changes.append("footer")

    return text, changes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", required=True)
    ap.add_argument("--backup", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    site = Path(args.site).resolve()
    backup = Path(args.backup).resolve()
    files = sorted(p for p in site.rglob("*.html"))
    changed = 0
    problems = []

    for path in files:
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        try:
            new_text, changes = transform(text)
        except ValueError as exc:
            problems.append(f"{path.relative_to(site)}: {exc}")
            continue
        if not changes:
            continue
        changed += 1
        if args.dry_run:
            continue
        dest = backup / path.relative_to(site)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            shutil.copy2(path, dest)
        path.write_bytes(new_text.encode("utf-8"))

    # Verificacion
    bad = []
    for path in files:
        text = path.read_text(encoding="utf-8")
        if text.count('class="nav-ref"') != 1:
            bad.append(f"{path.relative_to(site)}: nav-ref x{text.count('class=\"nav-ref\"')}")
        if text.count(f'<a href="{HREF}" style="color:inherit;">') != 1:
            bad.append(f"{path.relative_to(site)}: pie")
        if chr(0x2014) in text:
            bad.append(f"{path.relative_to(site)}: guion largo")
    print(f"archivos HTML: {len(files)} | modificados: {changed} | problemas: {len(problems)}")
    for p in problems + ([] if args.dry_run else bad):
        print("  !", p)
    return 1 if problems or (bad and not args.dry_run) else 0


if __name__ == "__main__":
    sys.exit(main())

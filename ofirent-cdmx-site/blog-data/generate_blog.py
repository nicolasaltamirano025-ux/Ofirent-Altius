# -*- coding: utf-8 -*-
"""
Generates all OfiRent blog pages from the raw WordPress REST API export
(wp-posts-raw.json) into blog/<slug>/index.html, matching the real site's
URL structure. Also generates /blog/index.html as a listing page.
"""
import json, os, re, html
from bs4 import BeautifulSoup

with open(os.path.join(os.path.dirname(__file__), "image-url-map.json"), encoding="utf-8") as _f:
    IMAGE_MAP = json.load(_f)

SITE_ROOT = r"C:/Users/Nicolas/Desktop/Ofirent-Altius/ofirent-cdmx-site"
DATA_FILE = os.path.join(SITE_ROOT, "blog-data", "wp-posts-raw.json")
SITE_URL = "https://ofirent-cdmx-site.vercel.app"

NAV = '''<nav class="topnav">
  <div class="wrap topnav-inner">
    <div class="logo-mark"><a href="/"><img src="/assets/logo.png" alt="OfiRent"></a></div>
    <div class="navlinks">
      <a href="/#ubicaciones">Ubicaciones</a><a href="/#servicios">Servicios</a><a href="/servicios/renta-oficinas-virtuales-cdmx/">Oficina Virtual</a><a href="/servicios/renta-oficinas-equipadas-cdmx/">Oficina Física</a><a href="/blog/">Blog</a><a href="https://ofirent.conectika.tech/web/login" target="_blank" rel="noopener">Acceso a clientes</a><a href="/#contacto" class="nav-cta">Contacto</a>
    </div>
  </div>
</nav>'''

FOOTER = '''<footer id="contacto">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-addr"><b>OfiRent</b>6 ubicaciones en Ciudad de México:<br>Nápoles · Del Valle · Condesa · Roma · Narvarte · Cuauhtémoc</div>
      <div class="footer-contact">55 3200 9907<br>55 1253 4900<br>800 282 6778 (sin costo)<br>contacto@ofirent.com.mx</div>
    </div>
    <div class="footer-bottom">OFIRENT · CONCEPTO DE REDISEÑO, NO ES EL SITIO FINAL</div>
  </div>
</footer>

<a class="wa-float" href="https://wa.me/525532009907?text=Hola%2C%20tengo%20una%20pregunta%20sobre%20OfiRent." target="_blank" rel="noopener" aria-label="Escríbenos por WhatsApp">
  <svg width="30" height="30" viewBox="0 0 24 24" fill="#fff"><path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4a7.94 7.94 0 0 0-6.9 11.9L4 20l4.2-1.1a7.93 7.93 0 0 0 3.85 1h.01a7.94 7.94 0 0 0 5.54-13.58zm-5.55 12.2a6.6 6.6 0 0 1-3.36-.92l-.24-.14-2.5.65.67-2.44-.16-.25a6.6 6.6 0 1 1 12.24-3.5 6.61 6.61 0 0 1-6.65 6.6zm3.62-4.94c-.2-.1-1.17-.58-1.35-.64s-.32-.1-.45.1-.5.63-.62.77-.23.15-.43.05a5.4 5.4 0 0 1-1.6-.99 6 6 0 0 1-1.1-1.37c-.12-.2 0-.3.09-.4s.2-.23.3-.35a1.36 1.36 0 0 0 .2-.34.37.37 0 0 0 0-.35c-.05-.1-.45-1.1-.62-1.5s-.33-.35-.45-.35h-.4a.75.75 0 0 0-.55.26 2.3 2.3 0 0 0-.72 1.7 4 4 0 0 0 .85 2.12 9.2 9.2 0 0 0 3.54 3.13c.5.21.88.34 1.18.44a2.85 2.85 0 0 0 1.3.08 2.13 2.13 0 0 0 1.4-.98 1.73 1.73 0 0 0 .12-.98c-.05-.09-.18-.14-.38-.24z"/></svg>
</a>

<script>
  var navEl = document.querySelector('nav.topnav');
  var lastY = window.scrollY;
  window.addEventListener('scroll', function(){
    var y = window.scrollY;
    if(y > lastY && y > navEl.offsetHeight){ navEl.classList.add('nav-hidden'); }
    else if(y < lastY){ navEl.classList.remove('nav-hidden'); }
    lastY = y;
  }, {passive:true});
</script>
</body>
</html>
'''

def clean_excerpt(excerpt_html):
    text = BeautifulSoup(excerpt_html, "lxml").get_text(" ", strip=True)
    text = text.replace("[&hellip;]", "").replace("…", "").strip()
    text = re.sub(r'\s+', ' ', text)
    if len(text) > 160:
        text = text[:157].rsplit(" ", 1)[0] + "..."
    return html.escape(text)

def extract_faq(soup):
    faqs = []
    for d in soup.select("details.elementor-accordion-item"):
        summary = d.find("summary")
        body = d.select_one(".elementor-accordion-content")
        if summary and body:
            q = summary.get_text(" ", strip=True)
            a = body.get_text(" ", strip=True)
            if q and a:
                faqs.append((q, a))
    return faqs

def build_page(post):
    slug = post["slug"]
    title = html.unescape(post["title"]["rendered"]).strip()
    date = post["date"][:10]
    modified = post["modified"][:10]
    excerpt = clean_excerpt(post["excerpt"]["rendered"])

    img_url = None
    embedded = post.get("_embedded", {})
    media = embedded.get("wp:featuredmedia")
    if media and isinstance(media, list) and media[0].get("source_url"):
        img_url = media[0]["source_url"]
        img_url = IMAGE_MAP.get(img_url, img_url)

    soup = BeautifulSoup(post["content"]["rendered"], "lxml")
    auto_post = soup.select_one("div.auto-post")
    body_html = str(auto_post) if auto_post else ""
    faqs = extract_faq(soup)

    interlink = soup.select_one("section.interlink")
    interlink_html = str(interlink) if interlink else ""

    url = f"{SITE_URL}/blog/{slug}/"

    ld = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": title,
        "description": excerpt,
        "datePublished": post["date"],
        "dateModified": post["modified"],
        "url": url,
        "author": {"@type": "Organization", "name": "OfiRent"},
        "publisher": {"@type": "Organization", "name": "OfiRent"},
    }
    if img_url:
        ld["image"] = img_url

    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Inicio", "item": SITE_URL + "/"},
            {"@type": "ListItem", "position": 2, "name": "Blog", "item": SITE_URL + "/blog/"},
            {"@type": "ListItem", "position": 3, "name": title},
        ],
    }

    ld_blocks = [json.dumps(ld, ensure_ascii=False), json.dumps(breadcrumb, ensure_ascii=False)]
    if faqs:
        faq_ld = {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
                for q, a in faqs
            ],
        }
        ld_blocks.append(json.dumps(faq_ld, ensure_ascii=False))

    img_tag = f'<img class="blog-hero-img" src="{img_url}" alt="{html.escape(title)}">' if img_url else ""

    page = f'''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} | Blog OfiRent</title>
<meta name="description" content="{excerpt}">
''' + "\n".join(f'<script type="application/ld+json">\n{b}\n</script>' for b in ld_blocks) + f'''
<link rel="stylesheet" href="/assets/site.css">
<style>
  .locpage-hero{{position:relative;overflow:hidden;padding:124px 0 40px;background:var(--paper);}}
  .back-link{{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:12px;color:var(--steel);text-decoration:none;margin-bottom:24px;}}
  .back-link:hover{{color:var(--green);}}
  .blog-hero-img{{width:100%;max-height:420px;object-fit:cover;border-radius:16px;border:1px solid var(--line);margin:24px 0 8px;}}
  .blog-meta{{font-family:var(--mono);font-size:12px;color:var(--steel);margin-bottom:8px;}}
</style>
</head>
<body>

{NAV}

<section class="locpage-hero">
  <div class="wrap" style="max-width:820px;">
    <a class="back-link" href="/blog/">← Ver todo el blog</a>
    <div class="blog-meta">Publicado el {date}{" · Actualizado el " + modified if modified != date else ""}</div>
    <h1 class="hero-title" style="font-size:clamp(28px,4vw,40px);">{html.escape(title)}</h1>
    {img_tag}
  </div>
</section>

<section>
  <div class="wrap" style="max-width:820px;">
    <div class="blog-body">
{body_html}
    </div>
    {interlink_html}
  </div>
</section>

{FOOTER}'''
    return page

def main():
    with open(DATA_FILE, encoding="utf-8") as f:
        posts = json.load(f)

    print(f"Loaded {len(posts)} posts")
    listing_items = []
    for post in posts:
        slug = post["slug"]
        out_dir = os.path.join(SITE_ROOT, "blog", slug)
        os.makedirs(out_dir, exist_ok=True)
        page_html = build_page(post)
        with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as f:
            f.write(page_html)

        title = html.unescape(post["title"]["rendered"]).strip()
        excerpt = clean_excerpt(post["excerpt"]["rendered"])
        img_url = None
        media = post.get("_embedded", {}).get("wp:featuredmedia")
        if media and isinstance(media, list) and media[0].get("source_url"):
            img_url = IMAGE_MAP.get(media[0]["source_url"], media[0]["source_url"])
        listing_items.append({
            "slug": slug, "title": title, "excerpt": excerpt,
            "date": post["date"][:10], "img": img_url,
        })

    listing_items.sort(key=lambda x: x["date"], reverse=True)

    cards = []
    for it in listing_items:
        img_html = f'<img src="{it["img"]}" alt="{html.escape(it["title"])}" loading="lazy">' if it["img"] else ""
        cards.append(f'''      <a class="blog-card reveal" href="/blog/{it['slug']}/">
        {img_html}
        <div class="blog-card-body">
          <div class="blog-card-date">{it['date']}</div>
          <h3 class="blog-card-title">{html.escape(it['title'])}</h3>
          <p class="blog-card-excerpt">{it['excerpt']}</p>
        </div>
      </a>''')

    listing_page = f'''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blog OfiRent · Oficinas, domicilio fiscal y coworking en CDMX</title>
<meta name="description" content="Guías y artículos sobre oficinas equipadas, oficinas virtuales, domicilio fiscal y coworking en las 6 ubicaciones de OfiRent en Ciudad de México.">
<link rel="stylesheet" href="/assets/site.css">
<style>
  .locpage-hero{{position:relative;overflow:hidden;padding:124px 0 40px;background:var(--paper);}}
  .blog-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;}}
  @media (max-width:900px){{ .blog-grid{{grid-template-columns:repeat(2,1fr);}} }}
  @media (max-width:600px){{ .blog-grid{{grid-template-columns:1fr;}} }}
  .blog-card{{display:block;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--paper-raised);text-decoration:none;color:inherit;}}
  .blog-card img{{width:100%;height:170px;object-fit:cover;display:block;}}
  .blog-card-body{{padding:16px;}}
  .blog-card-date{{font-family:var(--mono);font-size:11px;color:var(--steel);margin-bottom:6px;}}
  .blog-card-title{{font-family:var(--display);font-size:17px;font-weight:800;margin-bottom:8px;line-height:1.25;}}
  .blog-card-excerpt{{font-size:13.5px;color:var(--steel);line-height:1.5;}}
</style>
</head>
<body>

{NAV}

<section class="locpage-hero">
  <div class="wrap">
    <div class="eyebrow">Blog</div>
    <h1 class="hero-title">Oficinas, domicilio fiscal y coworking en CDMX</h1>
    <p class="hero-lede" style="max-width:60ch;">Guías prácticas sobre nuestras 6 ubicaciones, oficinas virtuales y equipadas.</p>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="blog-grid reveal-group">
{chr(10).join(cards)}
    </div>
  </div>
</section>

{FOOTER}'''
    with open(os.path.join(SITE_ROOT, "blog", "index.html"), "w", encoding="utf-8") as f:
        f.write(listing_page)

    print(f"Generated {len(listing_items)} blog post pages + /blog/index.html")

if __name__ == "__main__":
    main()

/**
 * Static blog generator for Web Development Sheffield.
 *
 * Fetches posts from the (public) Sanity dataset and prerenders:
 *   - blog/<slug>/index.html   (one static page per post)
 *   - blog/index.html          (the blog list page)
 *   - the homepage blog cards   (injected between the markers in index.html)
 *   - sitemap.xml               (homepage + /blog/ + every post)
 *
 * Output is deterministic so the GitHub Action only commits when content
 * actually changes. No Open Graph / social tags are emitted (out of scope).
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toHTML } from '@portabletext/to-html';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PROJECT_ID = 'r47syv2h';
const DATASET = 'production';
const SITE_URL = 'https://webdevelopmentsheffield.co.uk';
const HOMEPAGE_CARD_COUNT = 3;

const GROQ = `*[_type == "post"] | order(publishedAt desc){
  title,
  "slug": slug.current,
  publishedAt,
  _updatedAt,
  body,
  "imageUrl": mainImage.asset->url
}`;

/* ── helpers ─────────────────────────────────────────────── */

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

// JSON-LD: stringify then neutralise any "</script>" sequences.
const jsonLd = (obj) =>
  JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

const isoDay = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

function firstParagraph(body) {
  const block = (body || []).find(
    (b) =>
      b._type === 'block' &&
      (b.style === 'normal' || !b.style) &&
      (b.children || []).some((c) => (c.text || '').trim()),
  );
  if (!block) return '';
  return (block.children || []).map((c) => c.text || '').join('').trim();
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

const portableTextComponents = {
  marks: {
    link: ({ children, value }) => {
      const href = value?.href || '#';
      const external = /^https?:\/\//i.test(href);
      const extra = external ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${escapeAttr(href)}"${extra}>${children}</a>`;
    },
  },
};

const renderBody = (body) =>
  body && body.length
    ? toHTML(body, { components: portableTextComponents })
    : '<p>This article has no content yet.</p>';

/* ── shared chrome ───────────────────────────────────────── */

const HEAD_COMMON = `    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/png" href="/assets/favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/css/style.css">`;

const NAV = `<nav>
    <a class="nav-logo" href="/">WD<span>.</span>SHEFFIELD</a>
    <ul class="nav-links">
        <li><a href="/#services">Services</a></li>
        <li><a href="/#process">Process</a></li>
        <li><a href="/#pricing">Pricing</a></li>
        <li><a href="/#faq">FAQ</a></li>
        <li><a href="/#testimonials">Reviews</a></li>
        <li><a href="/#blog">Blog</a></li>
        <li><a href="/#contact" class="nav-cta">Get a Quote</a></li>
    </ul>
</nav>`;

const FOOTER = `<footer>
    <a class="footer-logo" href="/">WD<span>.</span>SHEFFIELD</a>
    <p>© 2026 Web Development Sheffield. All rights reserved.</p>
    <ul class="footer-links">
        <li><a href="/#services">Services</a></li>
        <li><a href="/#pricing">Pricing</a></li>
        <li><a href="/#faq">FAQ</a></li>
        <li><a href="/#contact">Contact</a></li>
    </ul>
</footer>`;

const NO_IMAGE_SVG = `<div class="blog-card-image blog-card-no-image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg></div>`;

function card(post) {
  const date = fmtDate(post.publishedAt);
  const summary = truncate(firstParagraph(post.body), 150) || 'Click to read the full article…';
  const image = post.imageUrl
    ? `<div class="blog-card-image"><img src="${escapeAttr(post.imageUrl)}?w=300&h=220&fit=crop" alt="${escapeAttr(post.title)}"></div>`
    : NO_IMAGE_SVG;
  return `<article class="blog-card">
    ${image}
    <div class="blog-card-content">
        ${date ? `<p class="blog-card-date">${escapeHtml(date)}</p>` : ''}
        <h2>${escapeHtml(post.title)}</h2>
        <p>${escapeHtml(summary)}</p>
        <a href="/blog/${encodeURIComponent(post.slug)}/">Read More →</a>
    </div>
</article>`;
}

/* ── page templates ──────────────────────────────────────── */

function postPage(post) {
  const url = `${SITE_URL}/blog/${post.slug}/`;
  const description = truncate(firstParagraph(post.body), 155);
  const date = fmtDate(post.publishedAt);
  const hero = post.imageUrl
    ? `<div class="post-hero-image"><img src="${escapeAttr(post.imageUrl)}?w=1200&h=500&fit=crop" alt="${escapeAttr(post.title)}"></div>`
    : '';

  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description,
    datePublished: post.publishedAt,
    dateModified: post._updatedAt || post.publishedAt,
    ...(post.imageUrl ? { image: [post.imageUrl] } : {}),
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: { '@type': 'Organization', name: 'Web Development Sheffield', url: `${SITE_URL}/` },
    publisher: {
      '@type': 'Organization',
      name: 'Web Development Sheffield',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/assets/favicon.png` },
    },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <title>${escapeHtml(post.title)} | Web Development Sheffield</title>
    <meta name="description" content="${escapeAttr(description)}">
    <link rel="canonical" href="${url}">
${HEAD_COMMON}
    <script type="application/ld+json">
${ld}
    </script>
</head>
<body>

${NAV}

<div class="article-header">
    <div class="article-header-grid"></div>
    <div style="position:relative; max-width:860px;">
        <a class="back-link" href="/#blog">Back</a>
        <p class="article-label">Web Development Sheffield — Blog</p>
        <h1 id="post-title">${escapeHtml(post.title)}</h1>
        <div class="article-meta">${date ? `<span>Published ${escapeHtml(date)}</span>` : ''}</div>
    </div>
</div>

${hero}

<div class="article-body" id="post-body">
${renderBody(post.body)}
</div>

${FOOTER}

</body>
</html>
`;
}

function blogIndexPage(posts) {
  const url = `${SITE_URL}/blog/`;
  const cards = posts.map(card).join('\n');
  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Blog | Web Development Sheffield',
    url,
    description:
      'Practical articles on web design, web development, SEO and website performance for Sheffield businesses.',
    hasPart: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      url: `${SITE_URL}/blog/${p.slug}/`,
      datePublished: p.publishedAt,
    })),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <title>Blog | Web Development Sheffield</title>
    <meta name="description" content="Practical articles on web design, web development, SEO and website performance for Sheffield businesses.">
    <link rel="canonical" href="${url}">
${HEAD_COMMON}
    <script type="application/ld+json">
${ld}
    </script>
</head>
<body>

${NAV}

<div class="article-header">
    <div class="article-header-grid"></div>
    <div style="position:relative; max-width:860px;">
        <a class="back-link" href="/#blog">Back</a>
        <p class="article-label">Web Development Sheffield — Blog</p>
        <h1 id="post-title">FROM THE BLOG</h1>
        <div class="article-meta"><span>Tips, insights and advice for businesses looking to grow online.</span></div>
    </div>
</div>

<section style="max-width:860px; margin:0 auto; padding:4rem 4rem 6rem;">
${cards || '<p style="color:var(--muted)">No articles published yet. Check back soon!</p>'}
</section>

${FOOTER}

</body>
</html>
`;
}

function sitemap(posts) {
  const latest = posts
    .map((p) => p._updatedAt || p.publishedAt)
    .filter(Boolean)
    .sort()
    .pop();
  const urls = [
    `  <url>\n    <loc>${SITE_URL}/</loc>\n  </url>`,
    `  <url>\n    <loc>${SITE_URL}/blog/</loc>${latest ? `\n    <lastmod>${isoDay(latest)}</lastmod>` : ''}\n  </url>`,
    ...posts.map((p) => {
      const lm = p._updatedAt || p.publishedAt;
      return `  <url>\n    <loc>${SITE_URL}/blog/${p.slug}/</loc>${lm ? `\n    <lastmod>${isoDay(lm)}</lastmod>` : ''}\n  </url>`;
    }),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

async function injectHomepage(posts) {
  const indexPath = join(ROOT, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  const markers = /<!-- blog:start -->[\s\S]*?<!-- blog:end -->/;
  if (!markers.test(html)) {
    throw new Error('Could not find <!-- blog:start --> / <!-- blog:end --> markers in index.html');
  }
  const cards = posts.slice(0, HOMEPAGE_CARD_COUNT).map(card).join('\n');
  const viewAll =
    '<div style="text-align:center; margin-top:1rem;"><a class="btn-ghost" href="/blog/">View all articles →</a></div>';
  const region = `<!-- blog:start -->\n${cards}\n${viewAll}\n<!-- blog:end -->`;
  const next = html.replace(markers, () => region);
  if (next !== html) {
    await writeFile(indexPath, next);
    console.log('• Updated homepage blog cards');
  } else {
    console.log('• Homepage blog cards unchanged');
  }
}

/* ── main ────────────────────────────────────────────────── */

async function main() {
  const apiUrl = `https://${PROJECT_ID}.api.sanity.io/v2021-10-21/data/query/${DATASET}?query=${encodeURIComponent(GROQ)}`;
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`Sanity API responded ${res.status} ${res.statusText}`);
  const { result } = await res.json();
  const posts = (result || []).filter((p) => p && p.slug);
  console.log(`Fetched ${posts.length} post(s) from Sanity.`);

  const blogDir = join(ROOT, 'blog');
  await rm(blogDir, { recursive: true, force: true });
  await mkdir(blogDir, { recursive: true });

  for (const post of posts) {
    const dir = join(blogDir, post.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), postPage(post));
    console.log(`• Wrote blog/${post.slug}/index.html`);
  }

  await writeFile(join(blogDir, 'index.html'), blogIndexPage(posts));
  console.log('• Wrote blog/index.html');

  await writeFile(join(ROOT, 'sitemap.xml'), sitemap(posts));
  console.log('• Wrote sitemap.xml');

  await injectHomepage(posts);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

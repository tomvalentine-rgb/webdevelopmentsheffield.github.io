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
 * actually changes.
 *
 * Key features:
 *   - Table of contents auto-generated from h2/h3 headings in the post body
 *   - Heading IDs added so TOC anchor links work
 *   - Hyperlinks in Sanity portable text rendered as <a> tags
 *   - Related articles pulled from the 3 most recent other posts (with image)
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

/**
 * Convert a heading string to a URL-friendly id.
 * Mirrors the logic used by most markdown renderers.
 */
function slugifyHeading(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // strip punctuation
    .trim()
    .replace(/[\s_]+/g, '-')    // spaces → hyphens
    .replace(/-+/g, '-');       // collapse repeated hyphens
}

/**
 * Extract all h2 and h3 headings from Sanity portable-text body blocks.
 * Returns an array of { level, text, id } objects in document order.
 */
function extractHeadings(body) {
  const headings = [];
  const seenIds = {};

  for (const block of body || []) {
    if (block._type !== 'block') continue;
    if (!['h2', 'h3'].includes(block.style)) continue;

    const text = (block.children || []).map((c) => c.text || '').join('').trim();
    if (!text) continue;

    let id = slugifyHeading(text);

    // deduplicate ids (e.g. two headings with the same text)
    if (seenIds[id]) {
      seenIds[id] += 1;
      id = `${id}-${seenIds[id]}`;
    } else {
      seenIds[id] = 1;
    }

    headings.push({ level: block.style, text, id });
  }

  return headings;
}

/* ── portable text rendering ─────────────────────────────── */

/**
 * Build a custom @portabletext/to-html serialiser that:
 *  - adds slug-based id attributes to h2/h3 elements
 *  - renders hyperlinks correctly
 *  - keeps all other default behaviour
 */
function makeComponents(headings) {
  // Build a lookup: text → id so we can find the id for each heading
  // (same dedup logic as extractHeadings)
  const seenIds = {};
  const headingIdMap = new Map();

  for (const block of headings) {
    let id = slugifyHeading(block.text);
    if (seenIds[id]) {
      seenIds[id] += 1;
      id = `${id}-${seenIds[id]}`;
    } else {
      seenIds[id] = 1;
    }
    headingIdMap.set(block.text, id);
  }

  return {
    block: {
      h2: ({ children, value }) => {
        const text = (value.children || []).map((c) => c.text || '').join('').trim();
        const id = headingIdMap.get(text) || slugifyHeading(text);
        return `<h2 id="${escapeAttr(id)}">${children}</h2>`;
      },
      h3: ({ children, value }) => {
        const text = (value.children || []).map((c) => c.text || '').join('').trim();
        const id = headingIdMap.get(text) || slugifyHeading(text);
        return `<h3 id="${escapeAttr(id)}">${children}</h3>`;
      },
    },
    marks: {
      link: ({ children, value }) => {
        const href = value?.href || '#';
        const external = /^https?:\/\//i.test(href);
        const extra = external ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${escapeAttr(href)}"${extra}>${children}</a>`;
      },
    },
  };
}

function renderBody(body) {
  if (!body || !body.length) {
    return '<p>This article has no content yet.</p>';
  }

  const headings = extractHeadings(body);
  const components = makeComponents(headings);

  return toHTML(body, { components });
}

/* ── table of contents ───────────────────────────────────── */

function renderToc(headings) {
  if (!headings.length) return '';

  const items = headings
    .map(({ text, id }) => `        <li>\n            <a href="#${escapeAttr(id)}">\n                ${escapeHtml(text)}\n            </a>\n        </li>`)
    .join('\n');

  return `  <aside class="article-toc">
      <h3>Contents</h3>
      <ul id="toc-list">
${items}
      </ul>
  </aside>`;
}

/* ── shared chrome ───────────────────────────────────────── */

const HEAD_COMMON = `    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/png" href="/assets/favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/css/variables.css">
    <link rel="stylesheet" href="/css/layout.css">
    <link rel="stylesheet" href="/css/header.css">
    <link rel="stylesheet" href="/css/footer.css">
    <link rel="stylesheet" href="/css/article.css">`;


const HEADER = `<header class="site-header">

    <div class="top-bar">
        <div class="top-bar-content">
            <a href="tel:+447864981381" class="top-bar-link">07864981381</a>
            <span class="top-bar-divider">|</span>
            <a href="mailto:info@webdevelopmentsheffield.co.uk" class="top-bar-link">
                info@webdevelopmentsheffield.co.uk
            </a>
        </div>
    </div>

    <nav class="main-nav">

        <a class="nav-logo" href="/">
            <img src="/assets/logo.png"
                 alt="Web Development Sheffield Logo"
                 class="logo-img">
            <span class="logo-text">
                Web Development Sheffield
            </span>
        </a>

        <ul class="nav-links">
            <li><a href="/index.html#services">Services</a></li>
            <li><a href="/index.html#process">Process</a></li>
            <li><a href="/index.html#pricing">Pricing</a></li>
            <li><a href="/index.html#faq">FAQs</a></li>
            <li><a href="/index.html#blog">Blog</a></li>
            <li><a href="/index.html#contact" class="nav-cta">Get a Quote</a></li>
        </ul>

        <button class="hamburger" id="hamburger" aria-label="Menu">
            <span></span>
            <span></span>
            <span></span>
        </button>

        <div class="mobile-menu" id="mobile-menu">
            <a href="/index.html#services" onclick="closeMenu()">Services</a>
            <a href="/index.html#process" onclick="closeMenu()">Process</a>
            <a href="/index.html#pricing" onclick="closeMenu()">Pricing</a>
            <a href="/index.html#faq" onclick="closeMenu()">FAQs</a>
            <a href="/index.html#blog" onclick="closeMenu()">Blog</a>
            <a href="/index.html#contact" onclick="closeMenu()">Get a Quote</a>
        </div>

    </nav>

</header>`;

const FOOTER = `<footer>
    <div class="footer-container">

        <div class="footer-brand">
            <a class="nav-logo" href="/">
                <img src="/assets/logo.png" alt="Web Development Sheffield Logo" class="logo-img">
                <span class="logo-text">Web Development Sheffield</span>
            </a>
            <p>
                Professional web design and web development services for
                businesses in Sheffield and across the globe.
            </p>
            <div class="social-links">
                <a href="https://www.linkedin.com/company/webdevelopmentsheffield/">LinkedIn</a>
                <a href="https://www.facebook.com/profile.php?id=61591130790464">Facebook</a>
                <a href="https://maps.app.goo.gl/odgEvB52S14oxhgo6">Google</a>
            </div>
        </div>

        <div class="footer-column">
            <h3>Contact</h3>
            <p><strong>Web Development Sheffield</strong></p>
            <address>
                Millhouses<br>
                Sheffield<br>
                United Kingdom
            </address>
            <p><a href="tel:07864981381">07864981381</a></p>
            <p>
                <a href="mailto:info@webdevelopmentsheffield.co.uk">
                    info@webdevelopmentsheffield.co.uk
                </a>
            </p>
        </div>

        <div class="footer-column">
            <h3>Services</h3>
            <ul>
                <li><a href="/index.html#services">Web Design</a></li>
                <li><a href="/index.html#services">Web Development</a></li>
                <li><a href="/index.html#services">SEO</a></li>
                <li><a href="/index.html#services">Website Maintenance</a></li>
                <li><a href="/index.html#services">E-Commerce</a></li>
            </ul>
        </div>

        <div class="footer-column">
            <h3>Quick Links</h3>
            <ul>
                <li><a href="/index.html#pricing">Pricing</a></li>
                <li><a href="/index.html#faq">FAQs</a></li>
                <li><a href="/index.html#blog">Blog</a></li>
                <li><a href="/index.html#contact">Contact</a></li>
                <li><a href="/privacy-policy.html">Privacy Policy</a></li>
            </ul>
        </div>
    </div>

    <div class="footer-bottom">
        <p>© 2026 Web Development Sheffield. All rights reserved.</p>

        <p>
            Listed in
            <a href="https://www.sheffield-business.co.uk">
                Sheffield Business Directory
            </a>
        </p>
    </div>
</footer>`;

/* ── blog card (used on homepage + blog index) ───────────── */

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

/* ── related posts section ───────────────────────────────── */

/**
 * Build the "Related Articles" section from the 3 most recent posts
 * that are not the current post.
 */
function relatedPostsSection(currentSlug, allPosts) {
  const related = allPosts
    .filter((p) => p.slug !== currentSlug)
    .slice(0, 3);

  if (!related.length) return '';

  const cards = related.map((post) => {
    const date = fmtDate(post.publishedAt);
    const summary = truncate(firstParagraph(post.body), 120) || 'Click to read the full article…';
    const image = post.imageUrl
      ? `<div class="related-post-image">\n                <img\n                    src="${escapeAttr(post.imageUrl)}?w=400&h=220&fit=crop"\n                    alt="${escapeAttr(post.title)}">\n            </div>`
      : `<div class="related-post-image related-post-no-image"></div>`;

    return `    <article class="related-post-card">
        <a href="/blog/${encodeURIComponent(post.slug)}/">

            ${image}

            <div class="related-post-content">
                ${date ? `<span class="related-post-date">\n                    ${escapeHtml(date)}\n                </span>` : ''}

                <h3>
                    ${escapeHtml(post.title)}
                </h3>

                <p>
                    ${escapeHtml(summary)}
                </p>
            </div>

        </a>
    </article>`;
  }).join('\n\n');

  return `\n<section class="related-posts">\n\n<div class="related-posts-header">\n    <p class="section-label">Continue Reading</p>\n    <h2>Related Articles</h2>\n    <p>\n        Explore more insights, tips and guides from\n        Web Development Sheffield.\n    </p>\n</div>\n\n<div class="related-posts-grid">\n\n${cards}\n\n</div>\n\n\n</section>\n`;
}

/* ── page templates ──────────────────────────────────────── */

function postPage(post, allPosts) {
  const url = `${SITE_URL}/blog/${post.slug}/`;
  const description = truncate(firstParagraph(post.body), 155);
  const date = fmtDate(post.publishedAt);

  const hero = post.imageUrl
    ? `<div class="post-hero-image"><img src="${escapeAttr(post.imageUrl)}?w=1200&h=500&fit=crop" alt="${escapeAttr(post.title)}"></div>`
    : '';

  const headings = extractHeadings(post.body);
  const toc = renderToc(headings);
  const body = renderBody(post.body);
  const related = relatedPostsSection(post.slug, allPosts);

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
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-1JNH702LBD"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-1JNH702LBD'); 
    </script>
    <title>${escapeHtml(post.title)} | Web Development Sheffield</title>
    <meta name="description" content="${escapeAttr(description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${escapeAttr(post.title)}">
    <meta property="og:description" content="${escapeAttr(description)}">
${HEAD_COMMON}
    <script type="application/ld+json">
${ld}
    </script>
</head>
<body>

${HEADER}

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

<div class="article-layout">

${toc}

  <div class="article-body" id="post-body">
${body}
  </div>

</div>


<section class="article-cta-wrapper">
  <section class="article-cta">
      <h2>Need a Website for Your Business?</h2>
      <p> We partner with businesses at every stage of growth to deliver custom websites that drive real results. </p>
      <a href="/index.html#contact" class="btn-primary">
          Get a Quote
      </a>

  </section>
</section>

${related}

${FOOTER}

<script src="/js/main.js"></script>


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
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-1JNH702LBD"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-1JNH702LBD');
    </script>
    <title>Blog | Web Development Sheffield</title>
    <meta name="description" content="Practical articles on web design, web development, SEO and website performance for Sheffield businesses.">
    <link rel="canonical" href="${url}">
${HEAD_COMMON}
    <script type="application/ld+json">
${ld}
    </script>
</head>
<body>

${HEADER}

<div class="article-header">
    <div class="article-header-grid"></div>
    <div style="position:relative; max-width:860px;">
        <a class="back-link" href="/#blog">Back</a>
        <p class="article-label">Web Development Sheffield — Blog</p>
        <h1 id="post-title">From The Blog</h1>
        <div class="article-meta"><span>Tips, insights and advice for businesses looking to grow online.</span></div>
    </div>
</div>

<section style="max-width:860px; margin:0 auto; padding:4rem 4rem 6rem;">
${cards || '<p style="color:var(--muted)">No articles published yet. Check back soon!</p>'}
</section>

${FOOTER}

<script src="/js/main.js"></script>


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
    await writeFile(join(dir, 'index.html'), postPage(post, posts));
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

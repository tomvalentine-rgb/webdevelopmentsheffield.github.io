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
  category,
  "imageUrl": mainImage.asset->url
}`;

const CATEGORIES = {
  'web-development': 'Web Development',
  'web-design': 'Web Design',
  seo: 'SEO',
};

const CATEGORY_BY_SLUG = {
  'do-you-actually-need-a-blog-on-your-website': 'web-development',
  'how-ai-search-is-changing-the-way-people-find-local-businesses': 'seo',
  'how-to-get-your-business-to-show-up-on-google-maps': 'seo',
  'why-local-businesses-are-losing-customers-to-competitors-online': 'web-design',
  'what-makes-a-good-business-website': 'web-design',
  'what-is-local-seo-and-why-does-it-matter': 'seo',
  '5-signs-your-business-website-needs-updating': 'web-design',
  'why-isnt-my-business-showing-up-on-google': 'seo',
  'can-social-media-replace-a-website': 'web-development',
  'why-your-website-isnt-converting-and-how-to-fix-it': 'web-design',
};

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

function categorySlug(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (CATEGORIES[raw]) return raw;
  if (raw.includes('seo')) return 'seo';
  if (raw.includes('design')) return 'web-design';
  if (raw.includes('development') || raw.includes('dev')) return 'web-development';
  return '';
}

function inferCategory(post) {
  const haystack = `${post.title || ''} ${firstParagraph(post.body)}`.toLowerCase();
  if (/\bseo\b|google maps|google|search/.test(haystack)) return 'seo';
  if (/\bdesign\b|converting|update/.test(haystack)) return 'web-design';
  return 'web-development';
}

function postCategory(post) {
  return (
    categorySlug(post.category) ||
    CATEGORY_BY_SLUG[post.slug] ||
    inferCategory(post)
  );
}

function categoryLabel(slug) {
  return CATEGORIES[slug] || CATEGORIES['web-development'];
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
            <li><a href="/services">Services</a></li>
            <li><a href="/index.html#process">Process</a></li>
            <li><a href="/index.html#pricing">Pricing</a></li>
            <li><a href="/index.html#faq">FAQs</a></li>
            <li><a href="/blog">Blog</a></li>
            <li><a href="/index.html#contact" class="nav-cta">Get a Quote</a></li>
        </ul>

        <button class="hamburger" id="hamburger" aria-label="Menu">
            <span></span>
            <span></span>
            <span></span>
        </button>

        <div class="mobile-menu" id="mobile-menu">
            <a href="/services" onclick="closeMenu()">Services</a>
            <a href="/index.html#process" onclick="closeMenu()">Process</a>
            <a href="/index.html#pricing" onclick="closeMenu()">Pricing</a>
            <a href="/index.html#faq" onclick="closeMenu()">FAQs</a>
            <a href="/blog" onclick="closeMenu()">Blog</a>
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
                businesses in Sheffield and across the world.
            </p>
            <div class="social-links">
                <a href="https://www.linkedin.com/company/webdevelopmentsheffield/">LinkedIn</a>
                <a href="https://www.facebook.com/profile.php?id=61591130790464">Facebook</a>
                <a href="https://maps.app.goo.gl/FXx9kFdjksv7dSPq9">Google</a>
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
            <h3><a href="/services">Services</a></h3>
            <ul>
                <li><a href="/services/web-design-sheffield.html" title="Web Design Sheffield">Web Design</a></li>
                <li><a href="/services/software-development-sheffield.html" title="Software Development Sheffield">Software Development</a></li>
                <li><a href="/services" title="Search Engine Optimization Sheffield">SEO</a></li>
                <li><a href="/services/website-maintenance-sheffield.html" title="Website Maintenance Sheffield">Website Maintenance</a></li>
                <li><a href="/services/website-support-sheffield.html" title="Website Support Sheffield">Website Support</a></li>
            </ul>
        </div>

        <div class="footer-column">
            <h3>Quick Links</h3>
            <ul>
                <li><a href="/index.html#pricing">Pricing</a></li>
                <li><a href="/index.html#faq">FAQs</a></li>
                <li><a href="/blog">Blog</a></li>
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

function indexCard(post) {
  const date = fmtDate(post.publishedAt);
  const summary = truncate(firstParagraph(post.body), 150) || 'Click to read the full article…';
  const href = `/blog/${encodeURIComponent(post.slug)}/`;
  const category = postCategory(post);
  const label = categoryLabel(category);
  const image = post.imageUrl
    ? `<div class="blog-card-image"><img src="${escapeAttr(post.imageUrl)}?w=300&h=220&fit=crop" alt="${escapeAttr(post.title)}"></div>`
    : NO_IMAGE_SVG;

  return `<article class="blog-card is-visible" data-category="${escapeAttr(category)}">
    <a href="${href}">
        ${image}
    </a>
    <div class="blog-card-content">
        <span class="card-tag">${escapeHtml(label)}</span>
        ${date ? `<p class="card-date">${escapeHtml(date)}</p>` : ''}
        <h2><a href="${href}">${escapeHtml(post.title)}</a></h2>
        <p>${escapeHtml(summary)}</p>
        <a class="read-more" href="${href}">Read More →</a>
    </div>
</article>`;
}

function latestSection(posts) {
  const [primary, ...rest] = posts;
  if (!primary) return '';

  const secondary = rest.slice(0, 2);
  const primaryHref = `/blog/${encodeURIComponent(primary.slug)}/`;
  const primaryLabel = categoryLabel(postCategory(primary));
  const primaryImage = primary.imageUrl
    ? `<img src="${escapeAttr(primary.imageUrl)}?w=800&h=600&fit=crop" alt="${escapeAttr(primary.title)}">`
    : '';

  const secondaryItems = secondary.map((post) => {
    const href = `/blog/${encodeURIComponent(post.slug)}/`;
    const label = categoryLabel(postCategory(post));
    const image = post.imageUrl
      ? `<img src="${escapeAttr(post.imageUrl)}?w=220&h=176&fit=crop" alt="${escapeAttr(post.title)}">`
      : '';
    return `            <a class="latest-secondary-item" href="${href}">
                ${image}
                <div>
                    <span class="card-tag">${escapeHtml(label)}</span>
                    <h3>${escapeHtml(post.title)}</h3>
                </div>
            </a>`;
  }).join('\n');

  return `<section class="latest-section">
    <p class="latest-heading">Latest Articles</p>
    <div class="latest-grid">
        <a class="latest-primary" href="${primaryHref}">
            ${primaryImage}
            <div class="latest-primary-content">
                <span class="card-tag">${escapeHtml(primaryLabel)}</span>
                <h2>${escapeHtml(primary.title)}</h2>
                ${primary.publishedAt ? `<span class="card-date">${escapeHtml(fmtDate(primary.publishedAt))}</span>` : ''}
            </div>
        </a>
        <div class="latest-secondary">
${secondaryItems}
        </div>
    </div>
</section>`;
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
        <a class="back-link" href="/blog">Back</a>
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
      <h2>Need a website for your business?</h2>
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
  const description = 'Practical articles on web design, web development, SEO and website performance for Sheffield businesses.';
  const cards = posts.map(indexCard).join('\n\n');
  const latest = latestSection(posts);
  const breadcrumbLd = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: url },
    ],
  });
  const orgLd = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'Web Development Sheffield',
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/assets/logo.png`,
  });
  const blogLd = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': `${url}#blog`,
    name: 'Web Development Sheffield Blog',
    url,
    description,
    publisher: { '@id': `${SITE_URL}/#organization` },
    blogPost: posts.map((p) => {
      const category = postCategory(p);
      return {
        '@type': 'BlogPosting',
        headline: p.title,
        url: `${SITE_URL}/blog/${p.slug}/`,
        datePublished: p.publishedAt,
        dateModified: p._updatedAt || p.publishedAt,
        ...(p.imageUrl ? { image: `${p.imageUrl}?w=1200&h=630&fit=crop` } : {}),
        description: truncate(firstParagraph(p.body), 155),
        articleSection: categoryLabel(category),
        author: { '@id': `${SITE_URL}/#organization` },
        publisher: { '@id': `${SITE_URL}/#organization` },
      };
    }),
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
    <title>Web Design Articles &amp; Guides | Web Development Sheffield</title>
    <meta name="description" content="${escapeAttr(description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="Web Design Articles &amp; Guides | Web Development Sheffield">
    <meta property="og:description" content="${escapeAttr(description)}">
    <meta property="og:url" content="${url}">
    <meta name="twitter:card" content="summary_large_image">
${HEAD_COMMON}
    <link rel="stylesheet" href="/css/blog-index.css">
    <script type="application/ld+json">
${breadcrumbLd}
    </script>
    <script type="application/ld+json">
${orgLd}
    </script>
    <script type="application/ld+json">
${blogLd}
    </script>
</head>
<body>

${HEADER}

<div class="article-header">
    <div class="article-header-grid"></div>
    <div style="position:relative; max-width:860px;">
        <a class="back-link" href="/">Back</a>
        <p class="article-label">Web Development Sheffield — Blog</p>
        <h1 id="post-title">Web Design Articles</h1>
        <div class="article-meta"><span>Tips, insights and advice for businesses looking to grow online.</span></div>
    </div>
</div>

${latest}

<div class="blog-filters">
    <button class="blog-filter" data-filter="all" aria-pressed="true">All</button>
    <button class="blog-filter" data-filter="web-development" aria-pressed="false">Web Development</button>
    <button class="blog-filter" data-filter="web-design" aria-pressed="false">Web Design</button>
    <button class="blog-filter" data-filter="seo" aria-pressed="false">SEO</button>
</div>

<section class="blog-grid" id="blog-grid">

${cards}

<p class="blog-empty" id="blog-empty">No articles in this category yet — check back soon.</p>

</section>

${FOOTER}

<script src="/js/main.js"></script>


</body>
</html>
`;
}

function sitemap(posts) {
  // Define all static, non-changing URLs here
  const staticRoutes = [
    { url: '/', lastmod: null },
    { url: '/privacy-policy/', lastmod: '2026-08-17' },
    { url: '/services/', lastmod: '2026-08-17' },
    { url: '/services/web-design-sheffield.html', lastmod: '2026-08-17' },
    { url: '/services/website-development-sheffield.html', lastmod: '2026-08-17' },
    { url: '/services/website-support-sheffield.html', lastmod: '2026-08-17' },
    { url: '/services/software-development-sheffield.html', lastmod: '2026-08-17' },
  ];

  // 2. Find the latest update date across all blog posts
  const latest = posts
    .map((p) => p._updatedAt || p.publishedAt)
    .filter(Boolean)
    .sort()
    .pop();

  // 3. Map static routes to XML <url> strings
  const staticUrls = staticRoutes.map(
    (page) =>
      `  <url>\n    <loc>${SITE_URL}${page.url}</loc>${
        page.lastmod ? `\n    <lastmod>${isoDay(page.lastmod)}</lastmod>` : ''
      }\n  </url>`
  );

  // 4. Map the blog index page using the latest post's date
  const blogIndexUrl = `  <url>\n    <loc>${SITE_URL}/blog/</loc>${
    latest ? `\n    <lastmod>${isoDay(latest)}</lastmod>` : ''
  }\n  </url>`;

  // 5. Map individual blog posts
  const postUrls = posts.map((p) => {
    const lm = p._updatedAt || p.publishedAt;
    return `  <url>\n    <loc>${SITE_URL}/blog/${p.slug}/</loc>${
      lm ? `\n    <lastmod>${isoDay(lm)}</lastmod>` : ''
    }\n  </url>`;
  });

  // Combine static pages, blog index, and all dynamic post URLs
  const urls = [...staticUrls, blogIndexUrl, ...postUrls];

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

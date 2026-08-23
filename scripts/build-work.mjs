/**
 * Static "Our Work" case study generator for Web Development Sheffield.
 *
 * Fetches "ourwork" documents from the (public) Sanity dataset and prerenders:
 *   - work/<slug>/index.html   (one full case study per project)
 *   - work/index.html          (the Our Work landing page)
 *   - the homepage "Our Work" cards   (injected between markers in index.html)
 *   - a <!-- work:start / work:end --> block merged into sitemap.xml
 *
 * This is deliberately structured the same way as build-blog.mjs so the two
 * scripts are easy to maintain side by side: same portable-text rendering,
 * same HEADER/FOOTER chrome, same deterministic-output philosophy (the
 * GitHub Action only commits when content actually changes).
 *
 * Run both scripts in the same workflow step, e.g.:
 *   node scripts/build-blog.mjs && node scripts/build-work.mjs
 *
 * Key features:
 *   - Landing page with filterable service/category tags (same pattern as
 *     the blog index)
 *   - Full case study page: hero gallery, brief/background panel,
 *     testimonial, portable-text body with auto section dividers from H2s,
 *     performance stats, related projects
 *   - Sitemap merge via markers so this script never clobbers the blog's
 *     sitemap entries (and vice versa)
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

const GROQ = `*[_type == "ourwork"] | order(featured desc, completedAt desc){
  name,
  business,
  "slug": slug.current,
  tag,
  projectTitle,
  summary,
  featured,
  "mainImageUrl": mainImage.asset->url,
  "mainImageAlt": mainImage.alt,
  services,
  caseStudyType,
  "gallery": gallery[]{ "url": asset->url, alt },
  "clientLogoUrl": clientLogo.asset->url,
  projectUrl,
  brief,
  background,
  quote,
  rating,
  clientSince,
  body,
  performanceStats,
  completedAt,
  _updatedAt
}`;

/* ── helpers (kept in step with build-blog.mjs) ─────────── */

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

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function slugifyTag(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Convert a heading string to a URL-friendly id (matches build-blog.mjs).
 */
function slugifyHeading(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Extract h2 headings from the portable-text body — each one becomes a
 * section divider on the case study page (Research / Branding / Web design
 * / Development / SEO / Performance, or whatever the editor uses).
 */
function extractSectionHeadings(body) {
  const headings = [];
  const seenIds = {};

  for (const block of body || []) {
    if (block._type !== 'block' || block.style !== 'h2') continue;
    const text = (block.children || []).map((c) => c.text || '').join('').trim();
    if (!text) continue;

    let id = slugifyHeading(text);
    if (seenIds[id]) {
      seenIds[id] += 1;
      id = `${id}-${seenIds[id]}`;
    } else {
      seenIds[id] = 1;
    }
    headings.push({ text, id });
  }

  return headings;
}

/* ── portable text rendering ─────────────────────────────── */

function makeComponents(headings) {
  const seenIds = {};
  const headingIdMap = new Map();

  for (const h of headings) {
    let id = slugifyHeading(h.text);
    if (seenIds[id]) {
      seenIds[id] += 1;
      id = `${id}-${seenIds[id]}`;
    } else {
      seenIds[id] = 1;
    }
    headingIdMap.set(h.text, id);
  }

  return {
    block: {
      // H2s become section dividers, matching edge.studio's "Research /
      // Branding / Web design / Development / SEO / Performance" pattern
      h2: ({ children, value }) => {
        const text = (value.children || []).map((c) => c.text || '').join('').trim();
        const id = headingIdMap.get(text) || slugifyHeading(text);
        return `</div><section class="case-section" id="${escapeAttr(id)}"><h2>${children}</h2><div class="case-section-body">`;
      },
      h3: ({ children }) => `<h3>${children}</h3>`,
    },
    marks: {
      link: ({ children, value }) => {
        const href = value?.href || '#';
        const external = /^https?:\/\//i.test(href);
        const extra = external ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${escapeAttr(href)}"${extra}>${children}</a>`;
      },
    },
    types: {
      image: ({ value }) => {
        if (!value?.asset?.url && !value?.url) return '';
        const url = value.url || value.asset.url;
        const alt = escapeAttr(value.alt || '');
        const caption = value.caption
          ? `<figcaption>${escapeHtml(value.caption)}</figcaption>`
          : '';
        return `<figure class="case-figure"><img src="${escapeAttr(url)}?w=1000" alt="${alt}">${caption}</figure>`;
      },
    },
  };
}

/**
 * Renders the body as a sequence of <section class="case-section"> blocks,
 * one per H2. Content before the first H2 (if any) is wrapped in an
 * "Overview" section so it never gets orphaned outside a <section>.
 */
function renderBody(body) {
  if (!body || !body.length) return '';

  const headings = extractSectionHeadings(body);
  const components = makeComponents(headings);
  const rawHtml = toHTML(body, { components });

  const hasLeadingContent = body[0]?.style !== 'h2';
  const opening = hasLeadingContent
    ? '<section class="case-section" id="overview"><div class="case-section-body">'
    : '';
  // makeComponents' h2 serializer already opens/closes the wrapping divs and
  // sections for every H2 it hits, so we only need to open the very first
  // one and close the very last one here.
  return `${opening}${rawHtml}</div></section>`;
}

/* ── shared chrome (identical to build-blog.mjs) ─────────── */

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
    <link rel="stylesheet" href="/css/article.css">
    <link rel="stylesheet" href="/css/work.css">`;

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
            <li><a href="/">Home</a></li>
            <li><a href="/services">Services</a></li>
            <li><a href="/index.html#process">Process</a></li>
            <li><a href="/index.html#pricing">Pricing</a></li>
            <li><a href="/work">Work</a></li>
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
            <a href="/work" onclick="closeMenu()">Work</a>
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
            <p><a href="/"><strong>Web Development Sheffield</strong></a></p>
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
                <li><a href="/work">Work</a></li>
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

/* ── landing-page card ────────────────────────────────────── */

const NO_IMAGE_SVG = `<div class="work-card-image work-card-no-image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg></div>`;

function servicesTags(project) {
  return (project.services || [])
    .map((s) => `<span class="card-tag">${escapeHtml(s)}</span>`)
    .join('');
}

function workIndexCard(project) {
  const href = `/work/${encodeURIComponent(project.slug)}/`;
  const summary = truncate(project.summary || '', 150) || 'Click to view the full case study…';
  const image = project.mainImageUrl
    ? `<div class="work-card-image"><img src="${escapeAttr(project.mainImageUrl)}?w=500&h=360&fit=crop" alt="${escapeAttr(project.mainImageAlt || project.business)}"></div>`
    : NO_IMAGE_SVG;
  const tagSlug = slugifyTag(project.tag || (project.services || [])[0] || '');

  return `<article class="work-card is-visible"${tagSlug ? ` data-category="${escapeAttr(tagSlug)}"` : ''}>
    <a href="${href}">
        ${image}
    </a>
    <div class="work-card-content">
        ${project.tag ? `<p class="work-card-eyebrow">${escapeHtml(project.tag)}</p>` : ''}
        <h2><a href="${href}">${escapeHtml(project.business)}</a></h2>
        <p>${escapeHtml(summary)}</p>
        <div class="work-card-tags">${servicesTags(project)}</div>
        <a class="read-more" href="${href}">Full project →</a>
    </div>
</article>`;
}

function homepageCard(project) {
  const href = `/work/${encodeURIComponent(project.slug)}/`;
  const summary = truncate(project.summary || '', 130) || 'Click to view the full case study…';
  const image = project.mainImageUrl
    ? `<div class="work-card-image"><img src="${escapeAttr(project.mainImageUrl)}?w=400&h=300&fit=crop" alt="${escapeAttr(project.mainImageAlt || project.business)}"></div>`
    : NO_IMAGE_SVG;

  return `<article class="work-card">
    ${image}
    <div class="work-card-content">
        ${project.tag ? `<p class="work-card-eyebrow">${escapeHtml(project.tag)}</p>` : ''}
        <h3>${escapeHtml(project.business)}</h3>
        <p>${escapeHtml(summary)}</p>
        <a href="${href}">Full project →</a>
    </div>
</article>`;
}

function categoryFilters(projects) {
  const seen = new Map();
  for (const project of projects) {
    const label = project.tag || (project.services || [])[0];
    if (!label) continue;
    const slug = slugifyTag(label);
    if (slug && !seen.has(slug)) seen.set(slug, label);
  }

  const buttons = [
    '    <button class="work-filter" data-filter="all" aria-pressed="true">All</button>',
    ...[...seen.entries()].map(
      ([slug, label]) =>
        `    <button class="work-filter" data-filter="${escapeAttr(slug)}" aria-pressed="false">${escapeHtml(label)}</button>`,
    ),
  ];

  return `<div class="work-filters">\n${buttons.join('\n')}\n</div>`;
}

/* ── related projects (case study footer) ────────────────── */

function relatedProjectsSection(currentSlug, allProjects) {
  const related = allProjects.filter((p) => p.slug !== currentSlug).slice(0, 3);
  if (!related.length) return '';

  const cards = related.map(workIndexCard).join('\n\n');

  return `\n<section class="related-work">\n\n<div class="related-work-header">\n    <p class="article-label">More Projects</p>\n    <h2>Related Work</h2>\n    <p>\n        See more examples of how we've helped businesses like yours.\n    </p>\n</div>\n\n<div class="related-work-grid">\n\n${cards}\n\n</div>\n\n\n</section>\n`;
}

/* ── testimonial + intro panel ────────────────────────────── */

function ratingStars(rating) {
  if (!rating) return '';
  const full = Math.round(rating);
  return `<span class="case-rating" aria-label="${full} out of 5 stars">${'★'.repeat(full)}${'☆'.repeat(Math.max(0, 5 - full))}</span>`;
}

function testimonialBlock(project) {
  if (!project.quote) return '';
  return `<div class="case-testimonial">
    ${ratingStars(project.rating)}
    <blockquote>&ldquo;${escapeHtml(project.quote)}&rdquo;</blockquote>
    <p class="case-testimonial-author">${escapeHtml(project.name)}${project.clientSince ? ` <span>· Client since ${escapeHtml(project.clientSince)}</span>` : ''}</p>
</div>`;
}

function introPanel(project) {
  const rows = [];
  if (project.brief) {
    rows.push(`<div class="case-intro-block"><h3>Brief</h3><p>${escapeHtml(project.brief)}</p></div>`);
  }
  if (project.background) {
    rows.push(`<div class="case-intro-block"><h3>Background</h3><p>${escapeHtml(project.background)}</p></div>`);
  }
  if (!rows.length) return '';
  return `<div class="case-intro-panel">${rows.join('\n')}</div>`;
}

function clientPanel(project) {
  if (!project.clientLogoUrl && !project.projectUrl) return '';
  const logo = project.clientLogoUrl
    ? `<img class="case-client-logo" src="${escapeAttr(project.clientLogoUrl)}?w=200" alt="${escapeAttr(project.business)} logo">`
    : '';
  const link = project.projectUrl
    ? `<a href="${escapeAttr(project.projectUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(project.projectUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`
    : '';
  return `<div class="case-client-panel">${logo}${link}</div>`;
}

function heroGallery(project) {
  const images = project.gallery && project.gallery.length ? project.gallery : (
    project.mainImageUrl ? [{ url: project.mainImageUrl, alt: project.mainImageAlt || project.business }] : []
  );
  if (!images.length) return '';

  const items = images
    .map(
      (img) =>
        `        <div class="case-gallery-item"><img src="${escapeAttr(img.url)}?w=900" alt="${escapeAttr(img.alt || project.business)}"></div>`,
    )
    .join('\n');

  return `<div class="case-hero-gallery case-hero-gallery-${Math.min(images.length, 4)}">\n${items}\n    </div>`;
}

function performanceStatsBlock(project) {
  const stats = project.performanceStats || [];
  if (!stats.length) return '';
  const items = stats
    .map(
      (s) =>
        `        <div class="case-stat"><span class="case-stat-value">${escapeHtml(s.value || '')}</span><span class="case-stat-label">${escapeHtml(s.label || '')}</span></div>`,
    )
    .join('\n');
  return `<section class="case-section" id="performance-stats">
    <h2>The Numbers</h2>
    <div class="case-stats-grid">
${items}
    </div>
</section>`;
}

/* ── page templates ──────────────────────────────────────── */

function workPage(project, allProjects) {
  const url = `${SITE_URL}/work/${project.slug}/`;
  const description = truncate(project.summary || project.projectTitle || '', 155);

  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: project.projectTitle || project.business,
    about: project.business,
    description,
    ...(project.mainImageUrl ? { image: [project.mainImageUrl] } : {}),
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: { '@type': 'Organization', name: 'Web Development Sheffield', url: `${SITE_URL}/` },
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
    <title>${escapeHtml(project.business)} Case Study | Web Development Sheffield</title>
    <meta name="description" content="${escapeAttr(description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${escapeAttr(project.business)} Case Study">
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
        <p class="article-label">Our Work</p>
        <h1 id="post-title">${escapeHtml(project.business)}</h1>
        <div class="article-meta">
            ${project.tag ? `<span class="case-tag">${escapeHtml(project.tag)}</span>` : ''}
            ${project.tag && project.services && project.services.length ? '<span class="case-header-divider">•</span>' : ''}
            ${project.services && project.services.length ? `<span class="case-services">${servicesTags(project)}</span>` : ''}
        </div>
    </div>
</div>

${heroGallery(project)}

<div class="case-layout">

    <div class="case-main">

        ${project.caseStudyType ? `<p class="case-eyebrow">Case study: ${escapeHtml(project.caseStudyType)}</p>` : ''}
        ${project.projectTitle ? `<h2 class="case-project-title">${escapeHtml(project.projectTitle)}</h2>` : ''}

        ${clientPanel(project)}

        ${introPanel(project)}

        ${testimonialBlock(project)}

        ${renderBody(project.body)}

        ${performanceStatsBlock(project)}

    </div>

</div>

<section class="article-cta-wrapper">
  <section class="article-cta">
      <h2>Want results like this for your business?</h2>
      <p>We design, build, and maintain custom websites for all kinds of businesses, from sole traders to large enterprises.</p>
      <a href="/index.html#contact" class="btn-primary">Get a Quote</a>
  </section>
</section>

${relatedProjectsSection(project.slug, allProjects)}

${FOOTER}

<script src="/js/main.js"></script>

</body>
</html>
`;
}

function workIndexPage(projects) {
  const url = `${SITE_URL}/work/`;
  const description = 'Case studies of websites we\u2019ve designed and built for businesses in Sheffield and beyond.';
  const featured = projects.filter((p) => p.featured);
  const rest = projects.filter((p) => !p.featured);
  const cards = projects.map(workIndexCard).join('\n\n');

  const breadcrumbLd = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Work', item: url },
    ],
  });

  const collectionLd = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${url}#work`,
    name: 'Our Work',
    url,
    description,
    hasPart: projects.map((p) => ({
      '@type': 'CreativeWork',
      name: p.projectTitle || p.business,
      url: `${SITE_URL}/work/${p.slug}/`,
      ...(p.mainImageUrl ? { image: `${p.mainImageUrl}?w=1200&h=630&fit=crop` } : {}),
      description: truncate(p.summary || '', 155),
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
    <title>Our Work | Web Development Sheffield</title>
    <meta name="description" content="${escapeAttr(description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="Our Work | Web Development Sheffield">
    <meta property="og:description" content="${escapeAttr(description)}">
    <meta property="og:url" content="${url}">
    <meta name="twitter:card" content="summary_large_image">
${HEAD_COMMON}
    <script type="application/ld+json">
${breadcrumbLd}
    </script>
    <script type="application/ld+json">
${collectionLd}
    </script>
</head>
<body>

${HEADER}

<div class="article-header">
    <div class="article-header-grid"></div>
    <div style="position:relative; max-width:860px;">
        <p class="article-label">Our Work</p>
        <h1 id="work-title">Case Studies</h1>
        <div class="article-meta"><span>Real websites we've designed and built, and the results they've delivered for our clients.</span></div>
    </div>
</div>

<section class="articles-section-header">
    <p class="latest-heading">${featured.length ? 'All Projects' : 'Projects'}</p>
    <p class="articles-intro">
        Browse case studies from businesses across Sheffield and beyond —
        from brochure sites to bespoke booking systems.
    </p>
</section>

${categoryFilters(projects)}

<section class="work-grid" id="work-grid">

${cards}

<p class="work-empty" id="work-empty">No projects in this category yet — check back soon.</p>

</section>

${FOOTER}

<script src="/js/main.js"></script>
<script src="/js/work-filters.js"></script>

</body>
</html>
`;
}

/* ── sitemap merge (marker-based, never clobbers build-blog.mjs's entries) ── */

function workSitemapBlock(projects) {
  const latest = projects
    .map((p) => p._updatedAt || p.completedAt)
    .filter(Boolean)
    .sort()
    .pop();

  const indexUrl = `  <url>\n    <loc>${SITE_URL}/work/</loc>${
    latest ? `\n    <lastmod>${isoDay(latest)}</lastmod>` : ''
  }\n  </url>`;

  const projectUrls = projects.map((p) => {
    const lm = p._updatedAt || p.completedAt;
    return `  <url>\n    <loc>${SITE_URL}/work/${p.slug}/</loc>${
      lm ? `\n    <lastmod>${isoDay(lm)}</lastmod>` : ''
    }\n  </url>`;
  });

  return [indexUrl, ...projectUrls].join('\n');
}

async function mergeSitemap(projects) {
  const sitemapPath = join(ROOT, 'sitemap.xml');
  let xml;
  try {
    xml = await readFile(sitemapPath, 'utf8');
  } catch {
    // No sitemap yet (e.g. this script ran before build-blog.mjs the very
    // first time) — start a minimal one.
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n';
  }

  const block = `<!-- work:start -->\n${workSitemapBlock(projects)}\n<!-- work:end -->`;
  const markerRe = /<!-- work:start -->[\s\S]*?<!-- work:end -->/;

  let next;
  if (markerRe.test(xml)) {
    next = xml.replace(markerRe, block);
  } else {
    // First run: insert the block just before </urlset>.
    next = xml.replace('</urlset>', `${block}\n</urlset>`);
  }

  if (next !== xml) {
    await writeFile(sitemapPath, next);
    console.log('• Merged Work entries into sitemap.xml');
  } else {
    console.log('• sitemap.xml Work entries unchanged');
  }
}

/* ── homepage "Our Work" section ─────────────────────────── */

async function injectHomepage(projects) {
  const indexPath = join(ROOT, 'index.html');
  let html;
  try {
    html = await readFile(indexPath, 'utf8');
  } catch {
    console.log('• index.html not found, skipping homepage Work cards');
    return;
  }

  const markers = /<!-- work:start -->[\s\S]*?<!-- work:end -->/;
  if (!markers.test(html)) {
    console.log(
      '• Skipped homepage Work cards — add <!-- work:start --> / <!-- work:end --> markers to index.html to enable this',
    );
    return;
  }

  const featured = projects.filter((p) => p.featured);
  const picks = (featured.length ? featured : projects).slice(0, HOMEPAGE_CARD_COUNT);
  const cards = picks.map(homepageCard).join('\n');
  const viewAll =
    '<div style="text-align:center; margin-top:1rem;"><a class="btn-ghost" href="/work/">View all projects →</a></div>';
  const region = `<!-- work:start -->\n${cards}\n${viewAll}\n<!-- work:end -->`;
  const next = html.replace(markers, () => region);

  if (next !== html) {
    await writeFile(indexPath, next);
    console.log('• Updated homepage Work cards');
  } else {
    console.log('• Homepage Work cards unchanged');
  }
}

/* ── main ────────────────────────────────────────────────── */

async function main() {
  const apiUrl = `https://${PROJECT_ID}.api.sanity.io/v2021-10-21/data/query/${DATASET}?query=${encodeURIComponent(GROQ)}`;
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`Sanity API responded ${res.status} ${res.statusText}`);
  const { result } = await res.json();
  const projects = (result || []).filter((p) => p && p.slug);
  console.log(`Fetched ${projects.length} project(s) from Sanity.`);

  const workDir = join(ROOT, 'work');
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  for (const project of projects) {
    const dir = join(workDir, project.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), workPage(project, projects));
    console.log(`• Wrote work/${project.slug}/index.html`);
  }

  await writeFile(join(workDir, 'index.html'), workIndexPage(projects));
  console.log('• Wrote work/index.html');

  await mergeSitemap(projects);
  await injectHomepage(projects);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

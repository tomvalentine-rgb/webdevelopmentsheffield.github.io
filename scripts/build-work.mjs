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

function extractHeadings(body) {
  const headings = [];
  const seenIds = {};

  for (const block of body || []) {
    if (block._type !== 'block') continue;
    if (!['h2', 'h3'].includes(block.style)) continue;

    const text = (block.children || []).map((c) => c.text || '').join('').trim();
    if (!text) continue;

    let id = slugifyHeading(text);
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

function makeComponents(headings) {
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
    types: {
      image: ({ value }) => {
        if (!value?.asset?.url && !value?.url) return '';
        const url = value.url || value.asset.url;
        const alt = escapeAttr(value.alt || '');
        const caption = value.caption
          ? `<figcaption>${escapeHtml(value.caption)}</figcaption>`
          : '';
        return `<figure><img src="${escapeAttr(url)}?w=1200" alt="${alt}">${caption}</figure>`;
      },
    },
  };
}

function renderBody(body) {
  if (!body || !body.length) return '';
  return toHTML(body, { components: makeComponents(extractHeadings(body)) });
}

function renderToc(headings) {
  if (!headings.length) return '  <aside class="article-toc"></aside>';

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
            <li><a href="/index.html#faq">FAQs</a></li>
            <li><a href="/work">Our Work</a></li>
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
            <a href="/work" onclick="closeMenu()">Our Work</a>
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
            </ul>
        </div>

        <div class="footer-column">
            <h3>Quick Links</h3>
            <ul>
                <li><a href="/index.html#pricing">Pricing</a></li>
                <li><a href="/index.html#faq">FAQs</a></li>
                <li><a href="/work">Our Work</a></li>
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

function projectCategory(project) {
  const label = String(project.tag || (project.services || [])[0] || '').trim();
  if (!label) return null;
  const slug = slugifyTag(label);
  if (!slug) return null;
  return { slug, label };
}

function projectTag(project) {
  const category = projectCategory(project);
  return category ? `<span class="card-tag">${escapeHtml(category.label)}</span>` : '';
}

const LISTING_NO_IMAGE = `<div class="blog-card-image work-card-no-image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg></div>`;

function workListingCard(project) {
  const href = `/work/${encodeURIComponent(project.slug)}/`;
  const summary = truncate(project.summary || '', 150) || 'Click to view the full case study…';
  const category = projectCategory(project);
  const date = fmtDate(project.completedAt);
  const image = project.mainImageUrl
    ? `<div class="blog-card-image"><img src="${escapeAttr(project.mainImageUrl)}?w=300&h=220&fit=crop" alt="${escapeAttr(project.mainImageAlt || project.business)}"></div>`
    : LISTING_NO_IMAGE;

  return `<article class="blog-card is-visible"${category ? ` data-category="${escapeAttr(category.slug)}"` : ''}>
    <a href="${href}">
        ${image}
    </a>
    <div class="blog-card-content">
        ${projectTag(project)}
        ${date ? `<p class="card-date">${escapeHtml(date)}</p>` : ''}
        <h2><a href="${href}">${escapeHtml(project.business)}</a></h2>
        <p>${escapeHtml(summary)}</p>
        <a class="read-more" href="${href}">Read More →</a>
    </div>
</article>`;
}

function latestWorkSection(projects) {
  const [primary, ...rest] = projects;
  if (!primary) return '';

  const secondary = rest.slice(0, 2);
  const primaryHref = `/work/${encodeURIComponent(primary.slug)}/`;
  const primaryImage = primary.mainImageUrl
    ? `<img src="${escapeAttr(primary.mainImageUrl)}?w=800&h=600&fit=crop" alt="${escapeAttr(primary.mainImageAlt || primary.business)}">`
    : '';
  const primarySummary = truncate(primary.summary || '', 140) || 'View the full case study to learn more.';

  const secondaryItems = secondary.map((project) => {
    const href = `/work/${encodeURIComponent(project.slug)}/`;
    const image = project.mainImageUrl
      ? `<img src="${escapeAttr(project.mainImageUrl)}?w=220&h=176&fit=crop" alt="${escapeAttr(project.mainImageAlt || project.business)}">`
      : '';
    const summary = truncate(project.summary || '', 90) || 'View the full case study to learn more.';

    return `            <a class="latest-secondary-item" href="${href}">
                ${image}
                <div>
                    ${projectTag(project)}
                    <h3>${escapeHtml(project.business)}</h3>
                    <p class="latest-excerpt">
                        ${escapeHtml(summary)}
                    </p>
                    <span class="latest-read-more">
                        View project →
                    </span>
                </div>
            </a>`;
  }).join('\n');

  return `<section class="latest-section">
    <p class="latest-heading">Latest Projects</p>

    <div class="latest-grid">

        <a class="latest-primary" href="${primaryHref}">
            ${primaryImage}

            <div class="latest-primary-content">
                ${projectTag(primary)}

                <h2>${escapeHtml(primary.business)}</h2>

                <p class="latest-primary-excerpt">
                    ${escapeHtml(primarySummary)}
                </p>

                <span class="latest-read-more">
                    View project →
                </span>
            </div>
        </a>

        <div class="latest-secondary">
${secondaryItems}
        </div>

    </div>
</section>`;
}

function categoryFilters(projects) {
  const seen = new Map();
  for (const project of projects) {
    const category = projectCategory(project);
    if (category && !seen.has(category.slug)) seen.set(category.slug, category.label);
  }

  const buttons = [
    '    <button class="blog-filter" data-filter="all" aria-pressed="true">All</button>',
    ...[...seen.entries()].map(
      ([slug, label]) =>
        `    <button class="blog-filter" data-filter="${escapeAttr(slug)}" aria-pressed="false">${escapeHtml(label)}</button>`,
    ),
  ];

  return `<div class="blog-filters">\n${buttons.join('\n')}\n</div>`;
}

/* ── related projects (case study footer) ────────────────── */

function relatedProjectsSection(currentSlug, allProjects) {
  const related = allProjects.filter((p) => p.slug !== currentSlug).slice(0, 3);
  if (!related.length) return '';

  const cards = related.map(workListingCard).join('\n\n');

  return `\n<section class="related-posts">\n\n<div class="related-posts-header">\n    <p class="article-label">Continue Reading</p>\n    <h2>Related Work</h2>\n    <p>\n        See more examples of how we've helped businesses like yours.\n    </p>\n</div>\n\n<div class="related-posts-grid">\n\n${cards}\n\n</div>\n\n\n</section>\n`;
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

function postHero(project) {
  const image = project.mainImageUrl
    ? { url: project.mainImageUrl, alt: project.mainImageAlt || project.business }
    : (project.gallery || []).find((img) => img?.url);
  if (!image?.url) return '';

  return `<div class="post-hero-image"><img src="${escapeAttr(image.url)}?w=1200&h=500&fit=crop" alt="${escapeAttr(image.alt || project.business)}"></div>`;
}

function galleryFigures(project) {
  const heroUrl = project.mainImageUrl || (project.gallery || []).find((img) => img?.url)?.url;
  return (project.gallery || [])
    .filter((img) => img?.url && img.url !== heroUrl)
    .map((img) => `<figure><img src="${escapeAttr(img.url)}?w=1200" alt="${escapeAttr(img.alt || project.business)}"></figure>`)
    .join('');
}

function articleBody(project) {
  const title = String(project.business || '').trim();
  const projectTitle = String(project.projectTitle || '').trim();
  const summary = String(project.summary || '').trim();
  const parts = [];
  const headings = [];

  if (projectTitle && projectTitle !== title) parts.push(`<p>${escapeHtml(projectTitle)}</p>`);
  if (summary && summary !== projectTitle) parts.push(`<p>${escapeHtml(summary)}</p>`);

  if (project.projectUrl) {
    const label = project.projectUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    parts.push(`<p><a href="${escapeAttr(project.projectUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></p>`);
  }

  if (project.brief) {
    headings.push({ text: 'Brief', id: 'brief' });
    parts.push(`<h2 id="brief">Brief</h2><p>${escapeHtml(project.brief)}</p>`);
  }
  if (project.background) {
    headings.push({ text: 'Background', id: 'background' });
    parts.push(`<h2 id="background">Background</h2><p>${escapeHtml(project.background)}</p>`);
  }
  if (project.quote) {
    const author = String(project.name || title).trim();
    parts.push(`<blockquote>&ldquo;${escapeHtml(project.quote)}&rdquo;</blockquote>`);
    if (author) {
      parts.push(`<p>${escapeHtml(author)}${project.clientSince ? ` · Client since ${escapeHtml(project.clientSince)}` : ''}</p>`);
    }
  }

  headings.push(...extractHeadings(project.body));
  parts.push(renderBody(project.body));

  const stats = project.performanceStats || [];
  if (stats.length) {
    headings.push({ text: 'The Numbers', id: 'the-numbers' });
    const items = stats
      .map((stat) => `<li><strong>${escapeHtml(stat.value || '')}</strong> ${escapeHtml(stat.label || '')}</li>`)
      .join('');
    parts.push(`<h2 id="the-numbers">The Numbers</h2><ul>${items}</ul>`);
  }

  parts.push(galleryFigures(project));

  return {
    html: parts.filter(Boolean).join('') || '<p>This case study has no content yet.</p>',
    headings,
  };
}

/* ── page templates ──────────────────────────────────────── */

function workPage(project, allProjects) {
  const url = `${SITE_URL}/work/${project.slug}/`;
  const title = String(project.business || '').trim();
  const description = truncate(project.summary || project.projectTitle || '', 155);
  const date = fmtDate(project.completedAt);
  const category = projectTag(project);
  const { html: body, headings } = articleBody(project);

  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: project.projectTitle || title,
    about: title,
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
    <title>${escapeHtml(title)} | Web Development Sheffield</title>
    <meta name="description" content="${escapeAttr(description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${escapeAttr(title)}">
    <meta property="og:description" content="${escapeAttr(description)}">
${HEAD_COMMON}
    <link rel="stylesheet" href="/css/blog-index.css">
    <script type="application/ld+json">
${ld}
    </script>
</head>
<body class="work-article">

${HEADER}

<div class="article-header">
    <div class="article-header-grid"></div>
    <div style="position:relative; max-width:860px;">
        <p class="article-label">Our Work</p>
        <h1 id="post-title">${escapeHtml(title)}</h1>
        <span class="blog-category-tag">${category}</span>${category && date ? ' • ' : ''}${date ? `<span class="article-meta"><span>Published ${escapeHtml(date)}</span></span>` : ''}
    </div>
</div>

${postHero(project)}

<div class="article-layout">

${renderToc(headings)}

  <div class="article-body" id="post-body">
${body}
  </div>

</div>


<section class="article-cta-wrapper">
  <section class="article-cta">
      <h2>Need a website for your business?</h2>
      <p> We design, build, and maintain custom websites for all kinds of businesses, from sole traders to large enterprises. </p>
      <a href="/index.html#contact" class="btn-primary">
          Get a Quote
      </a>

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
  const cards = projects.map(workListingCard).join('\n\n');
  const latest = latestWorkSection(projects);

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
    <title>Web Design Project Examples | Web Development Sheffield</title>
    <meta name="description" content="${escapeAttr(description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="Web Design Project Examples | Web Development Sheffield">
    <meta property="og:description" content="${escapeAttr(description)}">
    <meta property="og:url" content="${url}">
    <meta name="twitter:card" content="summary_large_image">
${HEAD_COMMON}
    <link rel="stylesheet" href="/css/blog-index.css">
    <script type="application/ld+json">
${breadcrumbLd}
    </script>
    <script type="application/ld+json">
${collectionLd}
    </script>
</head>
<body class="work-index">

${HEADER}

<div class="article-header">
    <div class="article-header-grid"></div>
    <div style="position:relative; max-width:860px;">
        <p class="article-label">Our Work</p>
        <h1 id="post-title">Case Studies</h1>
        <div class="article-meta"><span>Real websites we've designed and built, and the results they've delivered for our clients.</span></div>
    </div>
</div>

${latest}

<section class="articles-section-header">
    <p class="latest-heading">All Projects</p>
    <p class="articles-intro">
        Case studies of our past web development and web design projects.
        Our case studies show you how we work and the services we offer.
    </p>
</section>

${categoryFilters(projects)}

<section class="blog-grid" id="blog-grid">

${cards}

<p class="blog-empty" id="blog-empty">No projects in this category yet — check back soon.</p>

</section>

${FOOTER}

<script src="/js/main.js"></script>

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

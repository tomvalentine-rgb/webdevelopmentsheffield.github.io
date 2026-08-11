/**
 * Static "Our Work" generator for Web Development Sheffield.
 *
 * Generates:
 *   - web-design-projects/index.html
 *   - web-design-projects/<slug>/index.html
 *
 * Expected Sanity document type: "project"
 *
 * Expected fields (rename in GROQ if your schema differs):
 *   title             string
 *   slug              slug
 *   clientName        string (optional)
 *   excerpt           text/string (optional)
 *   body              portable text (optional)
 *   mainImage         image (optional)
 *   services          array of strings (optional)
 *   projectUrl        url (optional)
 *   publishedAt       datetime (optional)
 *   featured          boolean (optional)
 *
 * Requires:
 *   npm install @portabletext/to-html
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
const WORK_PATH = 'web-design-projects';

const GROQ = `*[_type == "document"] | order(coalesce(_updatedAt, _createdAt) desc){
  name,
  business,
  slug,
  quote,
  rating,

  featured,
  projectTitle,
  summary,
  mainImage,
  alt,
  services,
  body,
  projectUrl

  "slug": slug.current,
  "imageUrl": mainImage.asset->url,
  "imageAlt": mainImage.alt,

  _createdAt,
  _updatedAt
}`;

/* ── helpers ─────────────────────────────────────────────── */

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

const jsonLd = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

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

function projectDescription(project) {
  return (
    (project.excerpt || '').trim() ||
    firstParagraph(project.body) ||
    `A web design and development project by Web Development Sheffield${
      project.clientName ? ` for ${project.clientName}` : ''
    }.`
  );
}

function slugifyHeading(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

function renderBody(body) {
  if (!body?.length) return '';

  return toHTML(body, {
    components: {
      block: {
        h2: ({ children, value }) => {
          const text = (value.children || []).map((c) => c.text || '').join('').trim();
          return `<h2 id="${escapeAttr(slugifyHeading(text))}">${children}</h2>`;
        },
        h3: ({ children, value }) => {
          const text = (value.children || []).map((c) => c.text || '').join('').trim();
          return `<h3 id="${escapeAttr(slugifyHeading(text))}">${children}</h3>`;
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
    },
  });
}

/* ── shared site chrome ─────────────────────────────────── */

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
    <link rel="stylesheet" href="/css/work.css">`;

const HEADER = `<header class="site-header">
    <div class="top-bar">
        <div class="top-bar-content">
            <a href="tel:+447864981381" class="top-bar-link">07864981381</a>
            <span class="top-bar-divider">|</span>
            <a href="mailto:info@webdevelopmentsheffield.co.uk" class="top-bar-link">info@webdevelopmentsheffield.co.uk</a>
        </div>
    </div>

    <nav class="main-nav">
        <a class="nav-logo" href="/">
            <img src="/assets/logo.png" alt="Web Development Sheffield Logo" class="logo-img">
            <span class="logo-text">Web Development Sheffield</span>
        </a>

        <ul class="nav-links">
            <li><a href="/services">Services</a></li>
            <li><a href="/web-design-projects/">Our Work</a></li>
            <li><a href="/index.html#process">Process</a></li>
            <li><a href="/index.html#pricing">Pricing</a></li>
            <li><a href="/index.html#faq">FAQs</a></li>
            <li><a href="/blog">Blog</a></li>
            <li><a href="/index.html#contact" class="nav-cta">Get a Quote</a></li>
        </ul>

        <button class="hamburger" id="hamburger" aria-label="Menu">
            <span></span><span></span><span></span>
        </button>

        <div class="mobile-menu" id="mobile-menu">
            <a href="/services" onclick="closeMenu()">Services</a>
            <a href="/web-design-projects/" onclick="closeMenu()">Our Work</a>
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
            <p>Professional web design and web development services for businesses in Sheffield and across the globe.</p>
            <div class="social-links">
                <a href="https://www.linkedin.com/company/webdevelopmentsheffield/">LinkedIn</a>
                <a href="https://www.facebook.com/profile.php?id=61591130790464">Facebook</a>
                <a href="https://maps.app.goo.gl/odgEvB52S14oxhgo6">Google</a>
            </div>
        </div>

        <div class="footer-column">
            <h3>Contact</h3>
            <p><strong>Web Development Sheffield</strong></p>
            <address>Millhouses<br>Sheffield<br>United Kingdom</address>
            <p><a href="tel:07864981381">07864981381</a></p>
            <p><a href="mailto:info@webdevelopmentsheffield.co.uk">info@webdevelopmentsheffield.co.uk</a></p>
        </div>

        <div class="footer-column">
            <h3>Services</h3>
            <ul>
                <li><a href="/services">Web Design</a></li>
                <li><a href="/services">Web Development</a></li>
                <li><a href="/services">SEO</a></li>
                <li><a href="/services">Website Maintenance</a></li>
                <li><a href="/services">E-Commerce</a></li>
            </ul>
        </div>

        <div class="footer-column">
            <h3>Quick Links</h3>
            <ul>
                <li><a href="/web-design-projects/">Our Work</a></li>
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
        <p>Listed in <a href="https://www.sheffield-business.co.uk">Sheffield Business Directory</a></p>
    </div>
</footer>`;

/* ── cards ──────────────────────────────────────────────── */

function projectCard(project) {
  const description = truncate(projectDescription(project), 150);
  const services = Array.isArray(project.services) ? project.services.slice(0, 3) : [];
  const image = project.imageUrl
    ? `<div class="work-card-image"><img src="${escapeAttr(project.imageUrl)}?w=900&h=620&fit=crop&auto=format" alt="${escapeAttr(project.imageAlt || project.title)}" loading="lazy"></div>`
    : `<div class="work-card-image work-card-no-image" aria-hidden="true"></div>`;

  return `<article class="work-card">
    <a href="/${WORK_PATH}/${encodeURIComponent(project.slug)}/" class="work-card-link">
        ${image}
        <div class="work-card-content">
            ${project.clientName ? `<p class="work-card-client">${escapeHtml(project.clientName)}</p>` : ''}
            <h2>${escapeHtml(project.title)}</h2>
            <p>${escapeHtml(description)}</p>
            ${services.length ? `<div class="work-card-tags">${services.map((s) => `<span>${escapeHtml(s)}</span>`).join('')}</div>` : ''}
            <span class="work-card-cta">View Project →</span>
        </div>
    </a>
</article>`;
}

/* ── project detail page ───────────────────────────────── */

function projectPage(project, allProjects) {
  const url = `${SITE_URL}/${WORK_PATH}/${project.slug}/`;
  const description = truncate(projectDescription(project), 155);
  const body = renderBody(project.body);
  const services = Array.isArray(project.services) ? project.services : [];

  const otherProjects = allProjects
    .filter((p) => p.slug !== project.slug)
    .slice(0, 3)
    .map(projectCard)
    .join('\n');

  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: project.title,
    description,
    url,
    ...(project.imageUrl ? { primaryImageOfPage: project.imageUrl } : {}),
    isPartOf: {
      '@type': 'CollectionPage',
      name: 'Our Work | Web Development Sheffield',
      url: `${SITE_URL}/${WORK_PATH}/`,
    },
    about: {
      '@type': 'CreativeWork',
      name: project.title,
      ...(project.clientName ? { forClient: { '@type': 'Organization', name: project.clientName } } : {}),
    },
    publisher: {
      '@type': 'Organization',
      name: 'Web Development Sheffield',
      url: `${SITE_URL}/`,
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

    <title>${escapeHtml(project.title)} | Our Work | Web Development Sheffield</title>
    <meta name="description" content="${escapeAttr(description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${escapeAttr(project.title)} | Web Development Sheffield">
    <meta property="og:description" content="${escapeAttr(description)}">
    ${project.imageUrl ? `<meta property="og:image" content="${escapeAttr(project.imageUrl)}">` : ''}
${HEAD_COMMON}
    <script type="application/ld+json">
${ld}
    </script>
</head>
<body>

${HEADER}

<main>
    <section class="work-project-hero">
        <div class="work-project-hero-inner">
            <a class="back-link" href="/${WORK_PATH}/">← Our Work</a>
            <p class="section-label">Web Development Sheffield — Our Work</p>
            <h1>${escapeHtml(project.title)}</h1>
            <p class="work-project-intro">${escapeHtml(projectDescription(project))}</p>

            ${(project.clientName || services.length) ? `<div class="work-project-meta">
                ${project.clientName ? `<div><span>Client</span><strong>${escapeHtml(project.clientName)}</strong></div>` : ''}
                ${services.length ? `<div><span>Services</span><strong>${services.map(escapeHtml).join(' · ')}</strong></div>` : ''}
            </div>` : ''}
        </div>
    </section>

    ${project.imageUrl ? `<div class="work-project-main-image">
        <img src="${escapeAttr(project.imageUrl)}?w=1600&fit=max&auto=format" alt="${escapeAttr(project.imageAlt || project.title)}">
    </div>` : ''}

    <section class="work-project-body">
        ${body || `<p>${escapeHtml(projectDescription(project))}</p>`}

        ${project.projectUrl ? `<p class="work-project-live-link">
            <a href="${escapeAttr(project.projectUrl)}" target="_blank" rel="noopener noreferrer" class="btn-primary">Visit Website →</a>
        </p>` : ''}
    </section>

    <section class="work-project-cta">
        <p class="section-label">Have a project in mind?</p>
        <h2>Let’s build something that works for your business.</h2>
        <p>Tell us what you need and we’ll put together a tailored proposal and quote.</p>
        <a href="/index.html#contact" class="btn-primary">Get a Quote</a>
    </section>

    ${otherProjects ? `<section class="more-work">
        <div class="more-work-heading">
            <p class="section-label">More Projects</p>
            <h2>Explore Our Work</h2>
        </div>
        <div class="work-grid">
${otherProjects}
        </div>
    </section>` : ''}
</main>

${FOOTER}

<script src="/js/main.js"></script>
</body>
</html>`;
}

/* ── landing page ───────────────────────────────────────── */

function workIndexPage(projects) {
  const url = `${SITE_URL}/${WORK_PATH}/`;
  const cards = projects.map(projectCard).join('\n');

  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Our Work | Web Development Sheffield',
    url,
    description:
      'Explore websites designed and developed by Web Development Sheffield for businesses in Sheffield and beyond.',
    hasPart: projects.map((p) => ({
      '@type': 'WebPage',
      name: p.title,
      url: `${SITE_URL}/${WORK_PATH}/${p.slug}/`,
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

    <title>Our Work | Web Design Projects | Web Development Sheffield</title>
    <meta name="description" content="Explore websites designed and developed by Web Development Sheffield for businesses in Sheffield and beyond.">
    <link rel="canonical" href="${url}">
${HEAD_COMMON}
    <script type="application/ld+json">
${ld}
    </script>
</head>
<body>

${HEADER}

<main>
    <section class="work-index-hero">
        <div class="work-index-hero-inner">
            <p class="section-label">Our Work</p>
            <h1>Web Design Projects Built Around Real Businesses</h1>
            <p>
                Every business is different. Explore a selection of websites we’ve designed and developed around each client’s goals, customers and requirements.
            </p>
        </div>
    </section>

    <section class="work-index-section">
        <div class="work-grid">
            ${cards || '<p>No projects published yet.</p>'}
        </div>
    </section>

    <section class="work-project-cta">
        <p class="section-label">Your Project</p>
        <h2>Need a website built around your business?</h2>
        <p>Start with a free consultation and we’ll turn your requirements into a tailored proposal and quote.</p>
        <a href="/index.html#contact" class="btn-primary">Get a Quote</a>
    </section>
</main>

${FOOTER}

<script src="/js/main.js"></script>
</body>
</html>`;
}

/* ── main ───────────────────────────────────────────────── */

async function main() {
  const apiUrl = `https://${PROJECT_ID}.api.sanity.io/v2021-10-21/data/query/${DATASET}?query=${encodeURIComponent(GROQ)}`;
  const res = await fetch(apiUrl);

  if (!res.ok) {
    throw new Error(`Sanity API responded ${res.status} ${res.statusText}`);
  }

  const { result } = await res.json();
  const projects = (result || []).filter((project) => project?.slug && project?.title);

  console.log(`Fetched ${projects.length} project(s) from Sanity.`);

  const workDir = join(ROOT, WORK_PATH);

  // This directory should contain generated pages only.
  // CSS remains safely outside it in ROOT/css/.
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  for (const project of projects) {
    const dir = join(workDir, project.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), projectPage(project, projects));
    console.log(`• Wrote ${WORK_PATH}/${project.slug}/index.html`);
  }

  await writeFile(join(workDir, 'index.html'), workIndexPage(projects));
  console.log(`• Wrote ${WORK_PATH}/index.html`);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

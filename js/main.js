/* ─── FADE-UP ON SCROLL ───────────────────────── */
const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.12 });
document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));

/* ─── MOBILE MENU ─────────────────────────────── */
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');

hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    mobileMenu.classList.toggle('open');
});

function closeMenu() {
    hamburger.classList.remove('open');
    mobileMenu.classList.remove('open');
}

/* ─── EMAILJS CONTACT FORM ────────────────────── */
emailjs.init('FzhcE3c4OivFCtrVc');

function handleSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('.form-submit');
    btn.textContent = 'Sending...';
    btn.disabled = true;

    const templateParams = {
        first_name:    document.getElementById('fname').value,
        last_name:     document.getElementById('lname').value,
        email:         document.getElementById('email').value,
        phone:         document.getElementById('phone').value,
        business_name: document.getElementById('business').value,
        message:       document.getElementById('message').value,
    };

    emailjs.send('service_5b5ryig', 'template_zomlfd5', templateParams)
        .then(() => {
            document.getElementById('form-success').style.display = 'block';
            e.target.querySelectorAll('input, textarea, select, button').forEach(el => el.disabled = true);
        })
        .catch((err) => {
            console.error(err);
            btn.textContent = 'Send Enquiry →';
            btn.disabled = false;
            alert('Something went wrong — please email us directly at info@webdevelopmentsheffield.co.uk');
        });
}

/* ─── SANITY BLOG POSTS ───────────────────────── */
const PROJECT_ID  = 'r47syv2h';
const DATASET     = 'production';
const POSTS_PER_PAGE = 4; // Change this number to show more or fewer posts per page
let   currentPage = 1;
let   allPosts    = [];

const QUERY   = encodeURIComponent('*[_type == "post"] | order(publishedAt desc){title, "slug": slug.current, excerpt, "imageUrl": mainImage.asset->url, publishedAt}');
const API_URL = `https://${PROJECT_ID}.api.sanity.io/v2021-10-21/data/query/${DATASET}?query=${QUERY}`;

function renderPosts() {
    const container = document.getElementById('blog-container');
    const start     = (currentPage - 1) * POSTS_PER_PAGE;
    const pagePosts = allPosts.slice(start, start + POSTS_PER_PAGE);

    // Clear existing cards (not the pagination)
    container.querySelectorAll('.blog-card').forEach(el => el.remove());

    pagePosts.forEach(post => {
        const date = post.publishedAt
            ? new Date(post.publishedAt).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })
            : '';

        const article = document.createElement('article');
        article.className = 'blog-card';
        article.innerHTML = `
            ${ post.imageUrl
                ? `<div class="blog-card-image">
                     <img src="${post.imageUrl}?w=300&h=220&fit=crop" alt="${post.title}">
                   </div>`
                : `<div class="blog-card-image blog-card-no-image">
                     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                   </div>`
            }
            <div class="blog-card-content">
                ${ date ? `<p class="blog-card-date">${date}</p>` : '' }
                <h2>${post.title}</h2>
                <p>${post.excerpt || 'Click to read the full article...'}</p>
                <a href="blog-post.html?slug=${encodeURIComponent(post.slug)}">Read More →</a>
            </div>
        `;
        container.insertBefore(article, document.getElementById('blog-pagination'));
    });

    renderPagination();
}

function renderPagination() {
    const totalPages = Math.ceil(allPosts.length / POSTS_PER_PAGE);
    const pagination = document.getElementById('blog-pagination');
    pagination.innerHTML = '';

    if (totalPages <= 1) return;

    // Previous button
    if (currentPage > 1) {
        const prev = document.createElement('button');
        prev.className = 'blog-page-btn';
        prev.textContent = '← Prev';
        prev.onclick = () => { currentPage--; renderPosts(); window.scrollTo({top: document.getElementById('blog').offsetTop - 80, behavior:'smooth'}); };
        pagination.appendChild(prev);
    }

    // Page number buttons
    for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement('button');
        btn.className = 'blog-page-btn' + (i === currentPage ? ' active' : '');
        btn.textContent = i;
        btn.onclick = () => { currentPage = i; renderPosts(); window.scrollTo({top: document.getElementById('blog').offsetTop - 80, behavior:'smooth'}); };
        pagination.appendChild(btn);
    }

    // Next button
    if (currentPage < totalPages) {
        const next = document.createElement('button');
        next.className = 'blog-page-btn';
        next.textContent = 'Next →';
        next.onclick = () => { currentPage++; renderPosts(); window.scrollTo({top: document.getElementById('blog').offsetTop - 80, behavior:'smooth'}); };
        pagination.appendChild(next);
    }
}

async function fetchBlogPosts() {
    try {
        const response = await fetch(API_URL);
        const data     = await response.json();
        allPosts       = data.result || [];
        const container = document.getElementById('blog-container');

        if (allPosts.length === 0) {
            container.innerHTML = '<p style="color:var(--muted)">No articles published yet. Check back soon!</p>';
            return;
        }

        // Add pagination div inside container if not already there
        if (!document.getElementById('blog-pagination')) {
            const pag = document.createElement('div');
            pag.id = 'blog-pagination';
            pag.className = 'blog-pagination';
            container.appendChild(pag);
        }

        renderPosts();
    } catch (error) {
        console.error('Error fetching from Sanity:', error);
        document.getElementById('blog-container').innerHTML = '<p style="color:var(--muted)">Unable to load articles at this time.</p>';
    }
}

document.addEventListener('DOMContentLoaded', fetchBlogPosts);

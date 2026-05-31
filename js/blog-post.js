/* ─── FADE-UP ON SCROLL ───────────────────────── */
const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1 });
document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));

/* ─── SANITY BLOG POST LOADER ─────────────────── */
const PROJECT_ID = 'r47syv2h';
const DATASET    = 'production';

const urlParams = new URLSearchParams(window.location.search);
const slug      = urlParams.get('slug');

function showError(title, message) {
    document.getElementById('state-loading').style.display = 'none';
    const body = document.getElementById('post-body');
    body.style.display = 'block';
    body.innerHTML = `
        <div class="state-error">
            <h2>${title}</h2>
            <p>${message}</p>
            <a href="/ourwebsite/webdevelopmentsheffield.html#blog"
               style="display:inline-block;margin-top:2rem;color:var(--electric);
                      text-decoration:none;border-bottom:1px solid rgba(0,229,255,0.3);">
               ← Back to Blog
            </a>
        </div>`;
}

function renderBlock(block, container) {
    if (block._type !== 'block' || !block.children) return;

    const tagMap = { h1:'h2', h2:'h2', h3:'h3', h4:'h3', normal:'p', blockquote:'blockquote' };
    const tag = tagMap[block.style] || 'p';
    const el  = document.createElement(tag);
    el.style.marginBottom = '1.75rem';

    block.children.forEach(child => {
        const marks = child.marks || [];
        let node;
        if (marks.includes('strong')) {
            node = document.createElement('strong');
            node.textContent = child.text;
        } else if (marks.includes('em')) {
            node = document.createElement('em');
            node.textContent = child.text;
        } else {
            node = document.createTextNode(child.text);
        }
        el.appendChild(node);
    });

    container.appendChild(el);
}

async function loadFullPost() {
    if (!slug) { showError('Post Not Found', 'No article slug was provided in the URL.'); return; }

    const QUERY   = encodeURIComponent(`*[_type == "post" && slug.current == "${slug}"][0]{title, publishedAt, body, "imageUrl": mainImage.asset->url}`);
    const API_URL = `https://${PROJECT_ID}.api.sanity.io/v2021-10-21/data/query/${DATASET}?query=${QUERY}`;

    try {
        const response = await fetch(API_URL);
        const data     = await response.json();
        const post     = data.result;

        if (!post) { showError('Article Missing', "We couldn't find that specific article in our system."); return; }

        document.title = `${post.title} | Web Development Sheffield`;
        document.getElementById('post-title').innerText = post.title;

        if (post.publishedAt) {
            const date = new Date(post.publishedAt).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
            document.getElementById('post-meta').innerHTML = `<span>Published ${date}</span>`;
        }

        // Show hero image if available
        if (post.imageUrl) {
            const imgWrap = document.getElementById('post-hero-image');
            imgWrap.innerHTML = `<img src="${post.imageUrl}?w=1200&h=500&fit=crop" alt="${post.title}">`;
            imgWrap.style.display = 'block';
        }

        document.getElementById('article-header').style.display = 'block';
        document.getElementById('state-loading').style.display  = 'none';

        const bodyContainer = document.getElementById('post-body');
        bodyContainer.style.display = 'block';
        bodyContainer.innerHTML = '';

        if (post.body && post.body.length > 0) {
            post.body.forEach(block => renderBlock(block, bodyContainer));
        } else {
            bodyContainer.innerHTML = '<p style="color:var(--muted)">This article has no content yet.</p>';
        }

    } catch (err) {
        console.error(err);
        showError('Connection Error', 'There was a problem loading this article. Please try again.');
    }
}

document.addEventListener('DOMContentLoaded', loadFullPost);
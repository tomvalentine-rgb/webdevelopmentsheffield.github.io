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
const PROJECT_ID = 'r47syv2h';
const DATASET    = 'production';
const QUERY = encodeURIComponent('*[_type == "post"] | order(publishedAt desc){title, "slug": slug.current, excerpt, "imageUrl": mainImage.asset->url}');
const API_URL    = `https://${PROJECT_ID}.api.sanity.io/v2021-10-21/data/query/${DATASET}?query=${QUERY}`;

async function fetchBlogPosts() {
    try {
        const response = await fetch(API_URL);
        const data     = await response.json();
        const posts    = data.result;
        const container = document.getElementById('blog-container');
        container.innerHTML = '';

        if (!posts || posts.length === 0) {
            container.innerHTML = '<p style="color:var(--muted)">No articles published yet. Check back soon!</p>';
            return;
        }

        posts.forEach(post => {
            const article = document.createElement('article');
            article.className = 'blog-card';
            article.innerHTML = `
                ${ post.imageUrl ? `<img src="${post.imageUrl}?w=800&h=400&fit=crop" alt="${post.title}" style="width:100%; height:200px; object-fit:cover; border-radius:4px; margin-bottom:1.25rem;">` : '' }
                <h2>${post.title}</h2>
                <p>${post.excerpt || 'Click below to read the full article...'}</p>
                <a href="/ourwebsite/blog-post.html?slug=${post.slug}">Read More →</a>
            `;
            container.appendChild(article);
        });
    } catch (error) {
        console.error('Error fetching from Sanity:', error);
        document.getElementById('blog-container').innerHTML = '<p style="color:var(--muted)">Unable to load articles at this time.</p>';
    }
}

document.addEventListener('DOMContentLoaded', fetchBlogPosts);
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

/* ─── FAQ / PRICE ACCORDION ───────────────────── */
function setupAccordion(selector) {
    const items = document.querySelectorAll(selector);

    items.forEach(item => {
        item.addEventListener('toggle', () => {
            if (!item.open) return;

            items.forEach(otherItem => {
                if (otherItem !== item) otherItem.open = false;
            });
        });
    });
}

setupAccordion('.faq-item');
setupAccordion('.price-toggle');

/* ─── EMAILJS CONTACT FORM ────────────────────── */
if (typeof emailjs !== 'undefined') {
    emailjs.init('FzhcE3c4OivFCtrVc');
}

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

const imageLightbox = document.getElementById('image-lightbox');
const imageLightboxImg = imageLightbox?.querySelector('img');
const galleryButtons = document.querySelectorAll('.case-split-gallery .case-gallery-item');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const zoomEase = 'cubic-bezier(0.22, 1, 0.36, 1)';
const zoomDuration = 480;

let originRect = null;
let zooming = false;

function containedRect() {
    const padX = 32;
    const padY = 56;
    const maxWidth = window.innerWidth - padX * 2;
    const maxHeight = window.innerHeight - padY * 2;
    const ratio = (imageLightboxImg.naturalWidth / imageLightboxImg.naturalHeight) || (16 / 9);
    let width = maxWidth;
    let height = width / ratio;

    if (height > maxHeight) {
        height = maxHeight;
        width = height * ratio;
    }

    return {
        left: (window.innerWidth - width) / 2,
        top: (window.innerHeight - height) / 2,
        width,
        height,
        radius: 10,
    };
}

function placeImage(rect) {
    imageLightboxImg.style.left = `${rect.left}px`;
    imageLightboxImg.style.top = `${rect.top}px`;
    imageLightboxImg.style.width = `${rect.width}px`;
    imageLightboxImg.style.height = `${rect.height}px`;
    imageLightboxImg.style.borderRadius = `${rect.radius ?? 14}px`;
}

function animateImage(from, to) {
    if (reduceMotion) {
        placeImage(to);
        return Promise.resolve();
    }

    placeImage(from);
    const animation = imageLightboxImg.animate(
        [
            {
                left: `${from.left}px`,
                top: `${from.top}px`,
                width: `${from.width}px`,
                height: `${from.height}px`,
                borderRadius: `${from.radius ?? 14}px`,
            },
            {
                left: `${to.left}px`,
                top: `${to.top}px`,
                width: `${to.width}px`,
                height: `${to.height}px`,
                borderRadius: `${to.radius ?? 10}px`,
            },
        ],
        { duration: zoomDuration, easing: zoomEase, fill: 'both' },
    );

    return animation.finished.then(() => {
        animation.commitStyles();
        animation.cancel();
        placeImage(to);
    }).catch(() => {});
}

function openLightbox(button) {
    if (zooming) return;
    const thumb = button.querySelector('img');
    const rect = (thumb || button).getBoundingClientRect();
    originRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        radius: 14,
    };

    imageLightboxImg.src = thumb?.src || button.dataset.fullSrc || '';
    imageLightboxImg.alt = thumb?.alt || '';
    imageLightbox.showModal();
    placeImage(originRect);

    requestAnimationFrame(() => {
        imageLightbox.classList.add('is-open');
        zooming = true;
        animateImage(originRect, containedRect()).finally(() => {
            const fullSrc = button.dataset.fullSrc;
            if (fullSrc && imageLightboxImg.src !== fullSrc) {
                imageLightboxImg.addEventListener('load', () => {
                    if (imageLightbox.open) placeImage(containedRect());
                }, { once: true });
                imageLightboxImg.src = fullSrc;
            }
            zooming = false;
        });
    });
}

function closeLightbox() {
    if (!imageLightbox.open || zooming) return;

    imageLightbox.classList.remove('is-open');
    const current = imageLightboxImg.getBoundingClientRect();
    const from = {
        left: current.left,
        top: current.top,
        width: current.width,
        height: current.height,
        radius: 10,
    };

    zooming = true;
    const finish = () => {
        imageLightbox.close();
        zooming = false;
    };

    if (!originRect) {
        finish();
        return;
    }

    animateImage(from, originRect).finally(finish);
}

if (imageLightbox && imageLightboxImg && galleryButtons.length) {
    galleryButtons.forEach((button) => {
        button.addEventListener('click', () => openLightbox(button));
    });

    imageLightbox.addEventListener('click', (event) => {
        if (event.target === imageLightbox) closeLightbox();
    });

    imageLightbox.querySelector('.image-lightbox-close')?.addEventListener('click', () => {
        closeLightbox();
    });

    imageLightbox.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeLightbox();
    });

    imageLightbox.addEventListener('close', () => {
        imageLightbox.classList.remove('is-open');
        imageLightboxImg.removeAttribute('src');
        originRect = null;
    });
}

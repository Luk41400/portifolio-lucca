document.documentElement.classList.add('js');

const menuButton = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('.mobile-menu');
const siteHeader = document.querySelector('.site-header');

function updateHeaderSize() {
  siteHeader.classList.toggle('is-scrolled', window.scrollY > 80);
}

window.addEventListener('scroll', updateHeaderSize, { passive: true });
updateHeaderSize();

function closeMenu() {
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Abrir menu');
  mobileMenu.hidden = true;
}

menuButton.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  menuButton.setAttribute('aria-label', isOpen ? 'Abrir menu' : 'Fechar menu');
  mobileMenu.hidden = isOpen;
});

mobileMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
document.addEventListener('click', event => {
  if (!event.target.closest('.site-header')) closeMenu();
});

const revealItems = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.07, rootMargin: '0px 0px 70px 0px' });
  revealItems.forEach(item => revealObserver.observe(item));
} else {
  revealItems.forEach(item => item.classList.add('is-visible'));
}

const sections = document.querySelectorAll('main section[id]');
const navLinks = document.querySelectorAll('.desktop-nav a');
if ('IntersectionObserver' in window) {
  const navObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navLinks.forEach(link => link.classList.toggle('active', link.hash === `#${entry.target.id}`));
      }
    });
  }, { rootMargin: '-35% 0px -55% 0px' });
  sections.forEach(section => navObserver.observe(section));
}

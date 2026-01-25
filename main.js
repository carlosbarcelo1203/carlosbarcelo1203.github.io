const revealItems = document.querySelectorAll("[data-reveal]");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const externalLinks = document.querySelectorAll('a[href^="http"]');
externalLinks.forEach((link) => {
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer");
});

const trackEvent = (name, data = {}) => {
  if (window.umami && typeof window.umami.track === "function") {
    window.umami.track(name, data);
  }
};

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) {
    return;
  }

  const href = link.getAttribute("href") || "";
  if (href.startsWith("#")) {
    return;
  }

  const linkText = (link.textContent || "").trim().slice(0, 80);
  const hrefLower = href.toLowerCase();
  trackEvent("link_click", { href, text: linkText });

  if (hrefLower.endsWith(".pdf") && /resume/i.test(`${href} ${linkText}`)) {
    trackEvent("resume_open", { href });
  }
});

const scrollMilestones = [25, 50, 75, 100];
const reachedMilestones = new Set();
let scrollTicking = false;

const reportScrollDepth = () => {
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight - window.innerHeight;
  const progress = scrollable > 0 ? (doc.scrollTop / scrollable) * 100 : 100;

  scrollMilestones.forEach((milestone) => {
    if (progress >= milestone && !reachedMilestones.has(milestone)) {
      reachedMilestones.add(milestone);
      trackEvent("scroll_depth", { percent: milestone });
    }
  });
};

window.addEventListener("scroll", () => {
  if (scrollTicking) {
    return;
  }
  scrollTicking = true;
  window.requestAnimationFrame(() => {
    reportScrollDepth();
    scrollTicking = false;
  });
});

window.addEventListener("load", reportScrollDepth);

if (prefersReducedMotion) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }
        const delay = Number(entry.target.dataset.delay || 0);
        if (delay) {
          entry.target.style.transitionDelay = `${delay * 120}ms`;
        }
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.15 }
  );

  revealItems.forEach((item) => observer.observe(item));
}

const filterButtons = document.querySelectorAll(".filter-button");
const cardGrid = document.querySelector(".card-grid");

if (filterButtons.length && cardGrid) {
  const cards = Array.from(cardGrid.querySelectorAll(".card"));
  const defaultOrder = cards.slice();

  const getTags = (card) =>
    (card.dataset.tags || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

  const applyFilter = (tag) => {
    cards.forEach((card) => card.classList.remove("card--match"));
    if (!tag || tag === "all") {
      defaultOrder.forEach((card) => cardGrid.appendChild(card));
      return;
    }

    const matches = [];
    const rest = [];
    cards.forEach((card) => {
      const tags = getTags(card);
      if (tags.includes(tag)) {
        matches.push(card);
        card.classList.add("card--match");
      } else {
        rest.push(card);
      }
    });

    [...matches, ...rest].forEach((card) => cardGrid.appendChild(card));
  };

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      filterButtons.forEach((btn) => btn.classList.remove("is-active"));
      button.classList.add("is-active");
      applyFilter(button.dataset.tagFilter);
    });
  });
}

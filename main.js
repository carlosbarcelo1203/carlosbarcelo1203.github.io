const revealItems = document.querySelectorAll("[data-reveal]");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const externalLinks = document.querySelectorAll('a[href^="http"]');
externalLinks.forEach((link) => {
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer");
});

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

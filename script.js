(function () {
  const menuBtn = document.getElementById("menuBtn");
  const header = document.querySelector(".site-header");
  const year = document.getElementById("year");
  const form = document.getElementById("contactForm");
  const note = document.getElementById("formNote");

  if (year) year.textContent = String(new Date().getFullYear());

  if (menuBtn && header) {
    menuBtn.addEventListener("click", () => {
      const open = header.classList.toggle("nav-open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    header.querySelectorAll(".nav a").forEach((link) => {
      link.addEventListener("click", () => {
        header.classList.remove("nav-open");
        menuBtn.setAttribute("aria-expanded", "false");
      });
    });
  }

  if (form && note) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      note.hidden = false;
      form.reset();
    });
  }
})();

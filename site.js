(() => {
  function tx(key, fallback) {
    return typeof window.t === "function" ? window.t(key) : fallback || key;
  }

  const instituteName = tx(
    "brand.institute",
    "Tuproqshunoslik va agrokimyoviy tadqiqotlar instituti"
  );

  document.querySelectorAll("[data-institute]").forEach((el) => {
    if (!el.hasAttribute("data-i18n") && !el.textContent.trim()) {
      el.textContent = instituteName;
    }
  });

  const yearEl = document.querySelector("[data-year]");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  if (!document.body.classList.contains("page-admin")) {
    const openAdmin = () => {
      window.location.href = "admin.html";
    };

    let taps = 0;
    let tapTimer = 0;
    const bumpSecret = (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      taps += 1;
      window.clearTimeout(tapTimer);
      if (taps >= 3) {
        taps = 0;
        openAdmin();
        return;
      }
      tapTimer = window.setTimeout(() => {
        taps = 0;
      }, 1200);
    };

    const mark = document.querySelector(".brand-mark");
    if (mark) {
      mark.addEventListener("click", bumpSecret);
    }

    document.addEventListener("keydown", (event) => {
      const tag = (event.target && event.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key !== "a" && event.key !== "A") {
        taps = 0;
        return;
      }
      bumpSecret();
    });
  }

  const contactForm = document.querySelector("[data-contact-form]");
  const contactNote = document.querySelector("[data-contact-note]");
  if (contactNote && /(?:\?|&)murojaat=ok(?:&|$)/.test(location.search)) {
    contactNote.hidden = false;
    contactNote.classList.remove("error");
    contactNote.textContent = tx(
      "appeal.thanks",
      "Rahmat. Murojaatingiz qabul qilindi. Tez orada bog‘lanamiz."
    );
  }
  if (contactForm && contactNote) {
    contactForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const btn = contactForm.querySelector('button[type="submit"]');
      const fd = new FormData(contactForm);
      const payload = {
        name: String(fd.get("name") || "").trim(),
        contact: String(fd.get("contact") || "").trim(),
        message: String(fd.get("message") || "").trim(),
      };
      contactNote.hidden = false;
      contactNote.classList.remove("error");
      contactNote.textContent = tx("appeal.sending", "Yuborilmoqda...");
      if (btn) btn.disabled = true;
      try {
        const res = await fetch("/api/appeal", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(payload),
        });
        let data = {};
        try {
          data = await res.json();
        } catch {
          data = {};
        }
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || tx("appeal.error", "Yuborilmadi. Qayta urinib ko‘ring."));
        }
        contactNote.textContent = tx(
          "appeal.thanks",
          "Rahmat. Murojaatingiz qabul qilindi. Tez orada bog‘lanamiz."
        );
        contactForm.reset();
      } catch (err) {
        contactNote.classList.add("error");
        contactNote.textContent =
          (err && err.message) || tx("appeal.error", "Yuborilmadi. Qayta urinib ko‘ring.");
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  fetch("data/site-media.json", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((media) => {
      if (!media) return;
      const version = media.v || 1;
      document.querySelectorAll("[data-site-img]").forEach((img) => {
        const key = img.getAttribute("data-site-img");
        const path = media[key];
        if (path) img.src = `${path}?v=${version}`;
      });
    })
    .catch(() => {});

  function telHref(phone) {
    const digits = String(phone || "").replace(/[^\d+]/g, "");
    return digits ? `tel:${digits}` : "#";
  }

  function mapsUrl(lat, lng) {
    return `https://maps.google.com/maps?q=${lat},${lng}&ll=${lat},${lng}&z=16`;
  }

  function mapsEmbed(lat, lng) {
    return `${mapsUrl(lat, lng)}&output=embed`;
  }

  fetch("data/contact.json", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((c) => {
      if (!c) return;
      document.querySelectorAll("[data-contact]").forEach((el) => {
        const key = el.getAttribute("data-contact");
        if (key === "phone") {
          el.textContent = c.phone || el.textContent;
          if (el.tagName === "A") el.setAttribute("href", telHref(c.phone));
        } else if (key === "email") {
          el.textContent = c.email || el.textContent;
          if (el.tagName === "A") el.setAttribute("href", `mailto:${c.email}`);
        } else if (key === "address") {
          el.textContent = c.address || el.textContent;
        } else if (key === "title") {
          el.textContent = c.title || el.textContent;
        } else if (key === "map-iframe" && c.lat && c.lng) {
          el.setAttribute("src", mapsEmbed(c.lat, c.lng));
        } else if (key === "map-link" && c.lat && c.lng) {
          el.setAttribute("href", mapsUrl(c.lat, c.lng));
        }
      });
    })
    .catch(() => {});

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const staffGrid = document.querySelector("[data-staff-grid]");
  let staffData = null;

  function staffRole(raw, fallbackKey) {
    const v = String(raw || "").trim();
    if (!v || /^direktor$/i.test(v)) return tx(fallbackKey || "staff.director");
    if (/^ishchi$/i.test(v)) return tx("staff.worker");
    return v;
  }

  function renderStaff() {
    if (!staffGrid) return;
    if (!staffData) {
      staffGrid.innerHTML = `<p class="muted-note">${tx("staff.missing")}</p>`;
      return;
    }
    const dir = staffData.director || {};
    const photo = dir.photo
      ? `<img class="staff-photo" src="${escapeHtml(dir.photo)}" alt="" />`
      : "";
    staffGrid.innerHTML = `<article class="staff-block staff-director${photo ? " has-photo" : ""}" data-reveal>
          ${photo}
          <div>
            <p class="staff-role">${escapeHtml(staffRole(dir.role, "staff.director"))}</p>
            <h3>${escapeHtml(dir.name || tx("staff.dirFallback"))}</h3>
            <p>${escapeHtml(dir.bio || tx("staff.dirBio"))}</p>
          </div>
        </article>`;
    if (typeof watchReveal === "function") watchReveal(staffGrid);
  }

  if (staffGrid) {
    fetch("data/staff.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((staff) => {
        if (!staff) {
          staffData = null;
          renderStaff();
          return;
        }
        staffData = staff;
        renderStaff();
      })
      .catch(() => {
        staffGrid.innerHTML = `<p class="muted-note">${tx("staff.error")}</p>`;
      });
  }

  window.addEventListener("ttati:lang", () => {
    if (staffGrid && staffData) renderStaff();
  });

  const revealIo = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        revealIo.unobserve(entry.target);
      });
    },
    { threshold: 0.14, rootMargin: "0px 0px -8% 0px" }
  );

  function watchReveal(root) {
    (root || document).querySelectorAll("[data-reveal]").forEach((el) => {
      if (el.classList.contains("is-in")) return;
      revealIo.observe(el);
    });
  }

  watchReveal(document);
  window.ttatiWatchReveal = watchReveal;

  const galleryGrid = document.querySelector("[data-gallery-grid]");
  if (galleryGrid) {
    new MutationObserver(() => watchReveal(galleryGrid)).observe(galleryGrid, {
      childList: true,
    });
  }
})();

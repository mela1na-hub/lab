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

    const brand = document.querySelector(".brand");
    if (brand) {
      let clicks = 0;
      let clickTimer = 0;
      brand.addEventListener("click", (event) => {
        clicks += 1;
        window.clearTimeout(clickTimer);
        if (clicks >= 5) {
          event.preventDefault();
          clicks = 0;
          openAdmin();
          return;
        }
        clickTimer = window.setTimeout(() => {
          clicks = 0;
        }, 2000);
      });
    }

    let taps = 0;
    let tapTimer = 0;
    document.addEventListener("keydown", (event) => {
      const tag = (event.target && event.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key !== "a" && event.key !== "A") {
        taps = 0;
        return;
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
    });
  }

  const contactForm = document.querySelector("[data-contact-form]");
  const contactNote = document.querySelector("[data-contact-note]");
  if (contactForm && contactNote) {
    contactForm.addEventListener("submit", (event) => {
      event.preventDefault();
      contactNote.hidden = false;
      contactNote.textContent = tx(
        "appeal.thanks",
        "Rahmat. Murojaatingiz qabul qilindi (demo: serverga yuborilmaydi). Telefon yoki email orqali bog‘lanamiz."
      );
      contactForm.reset();
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

  function maskName(name) {
    return String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => {
        const first = word.charAt(0);
        const rest = word.length > 1 ? "*".repeat(word.length - 1) : "";
        return first + rest;
      })
      .join(" ");
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
    const workers = Array.isArray(staffData.workers) ? staffData.workers : [];
    const photo = dir.photo
      ? `<img class="staff-photo" src="${escapeHtml(dir.photo)}" alt="" />`
      : "";
    const workerCards = workers.length
      ? workers
          .map(
            (w) => `<article class="staff-block">
            ${w.photo ? `<img class="staff-photo" src="${escapeHtml(w.photo)}" alt="" />` : ""}
            <p class="staff-role">${escapeHtml(staffRole(w.lavozim, "staff.worker"))}</p>
            <h3>${escapeHtml(maskName(w.name || ""))}</h3>
          </article>`
          )
          .join("")
      : `<article class="staff-block">
            <p class="staff-role">${escapeHtml(tx("staff.workers"))}</p>
            <h3>${escapeHtml(tx("staff.teamTitle"))}</h3>
            <p>${escapeHtml(tx("staff.teamText"))}</p>
            <p class="muted-note">${escapeHtml(tx("staff.teamNote"))}</p>
          </article>`;
    staffGrid.innerHTML = `<article class="staff-block staff-director${photo ? " has-photo" : ""}">
          ${photo}
          <div>
            <p class="staff-role">${escapeHtml(staffRole(dir.role, "staff.director"))}</p>
            <h3>${escapeHtml(maskName(dir.name || tx("staff.dirFallback")))}</h3>
            <p>${escapeHtml(dir.bio || tx("staff.dirBio"))}</p>
          </div>
        </article>${workerCards}`;
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
})();

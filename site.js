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
    const existing = staffGrid.querySelector("[data-staff-static]");
    if (!staffData) {
      if (existing) return;
      staffGrid.innerHTML = `<p class="muted-note">${tx("staff.missing")}</p>`;
      return;
    }
    const dir = staffData.director || {};
    const name = dir.name || tx("staff.dirFallback");
    const role = staffRole(dir.role, "staff.director");
    const bio = String(dir.bio || "").trim() || tx("staff.dirBio");
    const photoSrc = String(dir.photo || "").trim();

    if (existing) {
      existing.classList.toggle("has-photo", Boolean(photoSrc));
      let img = existing.querySelector(".staff-photo");
      if (photoSrc) {
        if (!img) {
          img = document.createElement("img");
          img.className = "staff-photo";
          img.alt = "";
          existing.insertBefore(img, existing.firstChild);
        }
        img.src = photoSrc;
      } else if (img) {
        img.remove();
      }
      const roleEl = existing.querySelector("[data-staff-role]");
      const nameEl = existing.querySelector("[data-staff-name]");
      const bioEl = existing.querySelector("[data-staff-bio]");
      if (roleEl) {
        roleEl.textContent = role;
        if (dir.role && !/^direktor$/i.test(String(dir.role).trim())) {
          roleEl.removeAttribute("data-i18n");
        } else {
          roleEl.setAttribute("data-i18n", "staff.director");
        }
      }
      if (nameEl) nameEl.textContent = name;
      if (bioEl) {
        bioEl.textContent = bio;
        if (String(dir.bio || "").trim()) bioEl.removeAttribute("data-i18n");
        else bioEl.setAttribute("data-i18n", "staff.dirBio");
      }
      if (typeof watchReveal === "function") watchReveal(staffGrid);
      return;
    }

    const photo = photoSrc
      ? `<img class="staff-photo" src="${escapeHtml(photoSrc)}" alt="" />`
      : "";
    staffGrid.innerHTML = `<article class="staff-block staff-director${photo ? " has-photo" : ""}" data-reveal data-staff-static>
          ${photo}
          <div>
            <p class="staff-role" data-staff-role>${escapeHtml(role)}</p>
            <h3 data-staff-name>${escapeHtml(name)}</h3>
            <p data-staff-bio>${escapeHtml(bio)}</p>
          </div>
        </article>`;
    if (typeof watchReveal === "function") watchReveal(staffGrid);
  }

  if (staffGrid) {
    fetch("data/staff.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((staff) => {
        if (!staff) return;
        staffData = staff;
        renderStaff();
      })
      .catch(() => {
        /* static HTML qoladi */
      });
  }

  window.addEventListener("ttati:lang", () => {
    if (staffGrid && staffData) renderStaff();
  });

  document.querySelectorAll("[data-yt-lazy]").forEach((frame) => {
    const id = frame.getAttribute("data-yt-id");
    const playBtn = frame.querySelector("[data-yt-play]");
    if (!id || !playBtn) return;
    playBtn.addEventListener("click", () => {
      const title = frame.closest("figure")?.querySelector("strong")?.textContent || "YouTube";
      frame.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1" title="${escapeHtml(title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    });
  });

  const revealIo = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const el = entry.target;
        if (entry.isIntersecting) {
          // Transition qayta ishlashi uchun bir frame “off” holat
          if (!el.classList.contains("is-in")) {
            requestAnimationFrame(() => el.classList.add("is-in"));
          }
        } else {
          el.classList.remove("is-in");
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );

  function watchReveal(root) {
    (root || document).querySelectorAll("[data-reveal]").forEach((el) => {
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

  /* Bo‘lim matnlari — so‘z/blok/kartochka animatsiyasi (scrollda qayta) */
  (function initSectionReveals() {
    const sections = [...document.querySelectorAll("[data-section-reveal]")];
    if (!sections.length) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function splitWords(el) {
      if (el.querySelector(".reveal-word")) return;
      const text = el.textContent.replace(/\s+/g, " ").trim();
      if (!text) return;
      el.textContent = "";
      const parts = text.split(" ");
      parts.forEach((word, i) => {
        const span = document.createElement("span");
        span.className = "reveal-word";
        span.textContent = word;
        span.style.setProperty("--w", String(i));
        el.appendChild(span);
        if (i < parts.length - 1) el.appendChild(document.createTextNode(" "));
      });
    }

    function prepare(section) {
      if (section.dataset.revealPrepared === "1") return;
      section.dataset.revealPrepared = "1";
      section.querySelectorAll("[data-reveal-words]").forEach(splitWords);
      section.querySelectorAll("[data-reveal-block]").forEach((el) => {
        el.classList.add("reveal-block");
      });
      section.querySelectorAll("[data-reveal-item]").forEach((el, i) => {
        if (!el.style.getPropertyValue("--i")) el.style.setProperty("--i", String(i));
        el.classList.add("reveal-item");
      });
    }

    function clearInlineReveal(section) {
      section.querySelectorAll(".reveal-item, .reveal-block, .reveal-word").forEach((el) => {
        el.style.opacity = "";
        el.style.transform = "";
        el.style.filter = "";
      });
    }

    function activate(section) {
      prepare(section);
      clearInlineReveal(section);
      // Brauzer transitionni qayta o‘qishi uchun reflow
      section.classList.remove("is-reveal-in");
      void section.offsetWidth;
      requestAnimationFrame(() => section.classList.add("is-reveal-in"));
    }

    function deactivate(section) {
      section.classList.remove("is-reveal-in");
      clearInlineReveal(section);
    }

    sections.forEach((section) => {
      prepare(section);
      if (reduceMotion) {
        section.classList.add("is-reveal-in");
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.12) {
              if (!section.classList.contains("is-reveal-in")) activate(section);
            } else if (!entry.isIntersecting) {
              deactivate(section);
            }
          });
        },
        { threshold: [0, 0.12, 0.2], rootMargin: "0px 0px -4% 0px" }
      );
      io.observe(section);
    });

    document.querySelectorAll("[data-lang]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setTimeout(() => {
          sections.forEach((section) => {
            section.dataset.revealPrepared = "0";
            section.querySelectorAll("[data-reveal-words]").forEach((el) => {
              el.textContent = el.textContent;
            });
            prepare(section);
            if (section.classList.contains("is-reveal-in") || reduceMotion) {
              section.classList.add("is-reveal-in");
            }
          });
        }, 50);
      });
    });

    const galleryGrid = document.querySelector("[data-gallery-grid]");
    if (galleryGrid) {
      new MutationObserver(() => {
        const section = galleryGrid.closest("[data-section-reveal]");
        if (!section) return;
        galleryGrid.querySelectorAll(".gallery-card:not(.reveal-item)").forEach((el, i) => {
          el.classList.add("reveal-item");
          el.setAttribute("data-reveal-item", "");
          if (!el.style.getPropertyValue("--i")) el.style.setProperty("--i", String(i));
        });
        if (section.classList.contains("is-reveal-in")) {
          galleryGrid.querySelectorAll(".reveal-item").forEach((el) => {
            el.style.opacity = "1";
            el.style.transform = "none";
            el.style.filter = "none";
          });
        }
      }).observe(galleryGrid, { childList: true });
    }
  })();
})();

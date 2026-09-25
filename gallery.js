(() => {
  const grid = document.querySelector("[data-gallery-grid]");
  const filters = document.querySelector("[data-gallery-filters]");
  if (!grid) return;

  let items = [];
  let loaded = false;
  let filter = "all";

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isVideo(item) {
    return item.type === "video" || item.type === "youtube";
  }

  function tx(key, fallback) {
    return typeof window.t === "function" ? window.t(key) : fallback || key;
  }

  function playLabel() {
    return escapeHtml(tx("gallery.play", "Ijro etish"));
  }

  function card(item, index = 0) {
    const title = escapeHtml(item.title || tx("gallery.item", "Material"));
    const caption = escapeHtml(item.caption || "");
    const poster = String(item.poster || "").trim();
    let media = "";
    if (item.type === "photo") {
      media = `<img src="${escapeHtml(item.src)}" alt="${title}" loading="lazy" />`;
    } else if (item.type === "video") {
      const posterAttr = poster ? ` poster="${escapeHtml(poster)}"` : "";
      const preview = poster
        ? `<img class="gallery-poster" src="${escapeHtml(poster)}" alt="${title}" loading="lazy" />`
        : `<video src="${escapeHtml(item.src)}" preload="metadata" playsinline muted${posterAttr}></video>`;
      media = `<div class="gallery-video-wrap" data-gallery-video data-src="${escapeHtml(item.src)}">
        ${preview}
        <button type="button" class="gallery-play" data-gallery-play aria-label="${playLabel()}">
          <span class="gallery-play-icon" aria-hidden="true"></span>
        </button>
      </div>`;
    } else if (item.type === "youtube") {
      const id = escapeHtml(item.src);
      const thumb = poster
        ? escapeHtml(poster)
        : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      media = `<div class="gallery-video-wrap gallery-yt" data-gallery-yt data-yt-id="${id}">
        <img src="${thumb}" alt="${title}" loading="lazy" />
        <button type="button" class="gallery-play" data-gallery-yt-play aria-label="${playLabel()}">
          <span class="gallery-play-icon" aria-hidden="true"></span>
        </button>
      </div>`;
    }
    return `<figure class="gallery-card" data-kind="${escapeHtml(item.type)}" data-reveal-item style="--i:${index}">
      <div class="gallery-media">${media}</div>
      <figcaption>
        <strong>${title}</strong>
        ${caption ? `<span>${caption}</span>` : ""}
      </figcaption>
    </figure>`;
  }

  function bindVideoThumbs() {
    grid.querySelectorAll("[data-gallery-video]").forEach((wrap) => {
      if (wrap.dataset.bound === "1") return;
      wrap.dataset.bound = "1";
      const playBtn = wrap.querySelector("[data-gallery-play]");
      if (!playBtn) return;
      const src = wrap.getAttribute("data-src") || "";
      let video = wrap.querySelector("video");

      if (video) {
        const showFrame = () => {
          try {
            if (video.duration && Number.isFinite(video.duration) && video.duration > 0.8) {
              video.currentTime = Math.min(1, video.duration * 0.08);
            }
          } catch {
            /* ignore seek errors */
          }
        };
        if (video.readyState >= 1) showFrame();
        else video.addEventListener("loadedmetadata", showFrame, { once: true });
      }

      playBtn.addEventListener("click", async () => {
        wrap.classList.add("is-playing");
        if (!video) {
          video = document.createElement("video");
          video.src = src;
          video.controls = true;
          video.playsInline = true;
          video.setAttribute("playsinline", "");
          wrap.insertBefore(video, playBtn);
          const posterImg = wrap.querySelector(".gallery-poster");
          if (posterImg) posterImg.remove();
        } else {
          video.muted = false;
          video.controls = true;
        }
        playBtn.hidden = true;
        try {
          await video.play();
        } catch {
          /* user gesture / autoplay policy */
        }
      });
    });

    grid.querySelectorAll("[data-gallery-yt]").forEach((wrap) => {
      if (wrap.dataset.bound === "1") return;
      wrap.dataset.bound = "1";
      const id = wrap.getAttribute("data-yt-id");
      const playBtn = wrap.querySelector("[data-gallery-yt-play]");
      if (!id || !playBtn) return;
      playBtn.addEventListener("click", () => {
        wrap.classList.add("is-playing");
        wrap.innerHTML = `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1" title="YouTube" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
      });
    });
  }

  function filterStatic() {
    grid.querySelectorAll(".gallery-card").forEach((card) => {
      const kind = card.getAttribute("data-kind") || "";
      const show =
        filter === "all" ||
        (filter === "photo" && kind === "photo") ||
        (filter === "video" && (kind === "video" || kind === "youtube"));
      card.hidden = !show;
    });
  }

  function render() {
    if (!loaded) {
      filterStatic();
      bindVideoThumbs();
      return;
    }
    const visible = items.filter((item) => {
      if (filter === "all") return true;
      if (filter === "photo") return item.type === "photo";
      if (filter === "video") return isVideo(item);
      return true;
    });
    if (!visible.length) {
      grid.innerHTML = `<p class="muted-note">${tx("gallery.empty")}</p>`;
      return;
    }
    grid.innerHTML = visible.map(card).join("");
    bindVideoThumbs();
    const section = grid.closest("[data-section-reveal]");
    if (section) {
      grid.querySelectorAll("[data-reveal-item]").forEach((el) => {
        el.classList.add("reveal-item");
      });
      if (section.classList.contains("is-reveal-in")) {
        grid.querySelectorAll(".reveal-item").forEach((el) => {
          el.style.opacity = "1";
          el.style.transform = "none";
          el.style.filter = "none";
        });
      }
    }
  }

  if (filters) {
    filters.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filter = btn.getAttribute("data-filter") || "all";
        filters.querySelectorAll("[data-filter]").forEach((el) => {
          el.classList.toggle("is-active", el === btn);
        });
        render();
      });
    });
  }

  bindVideoThumbs();

  fetch("data/gallery.json", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data) return;
      items = Array.isArray(data.items) ? data.items : [];
      loaded = true;
      render();
    })
    .catch(() => {
      /* HTML dagi static galereya qoladi */
      bindVideoThumbs();
    });

  window.addEventListener("ttati:lang", () => {
    if (loaded) render();
  });
})();

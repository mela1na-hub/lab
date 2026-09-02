(() => {
  const grid = document.querySelector("[data-gallery-grid]");
  const filters = document.querySelector("[data-gallery-filters]");
  if (!grid) return;

  let items = [];
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

  function card(item) {
    const title = escapeHtml(item.title || tx("gallery.item", "Material"));
    const caption = escapeHtml(item.caption || "");
    let media = "";
    if (item.type === "photo") {
      media = `<img src="${escapeHtml(item.src)}" alt="${title}" loading="lazy" />`;
    } else if (item.type === "video") {
      media = `<video src="${escapeHtml(item.src)}" controls preload="metadata"></video>`;
    } else if (item.type === "youtube") {
      media = `<iframe src="https://www.youtube.com/embed/${escapeHtml(item.src)}" title="${title}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
    }
    return `<figure class="gallery-card" data-kind="${escapeHtml(item.type)}">
      <div class="gallery-media">${media}</div>
      <figcaption>
        <strong>${title}</strong>
        ${caption ? `<span>${caption}</span>` : ""}
      </figcaption>
    </figure>`;
  }

  function render() {
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

  fetch("data/gallery.json", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : { items: [] }))
    .then((data) => {
      items = Array.isArray(data.items) ? data.items : [];
      render();
    })
    .catch(() => {
      grid.innerHTML = `<p class="muted-note">${tx("gallery.error")}</p>`;
    });

  window.addEventListener("ttati:lang", render);
})();

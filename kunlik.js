(() => {
  const MONTHS = [
    "Yanvar",
    "Fevral",
    "Mart",
    "Aprel",
    "May",
    "Iyun",
    "Iyul",
    "Avgust",
    "Sentabr",
    "Oktabr",
    "Noyabr",
    "Dekabr",
  ];
  const WEEKDAYS = ["Du", "Se", "Cho", "Pa", "Ju", "Sha", "Ya"];

  const gridEl = document.querySelector("[data-cal-grid]");
  const monthEl = document.querySelector("[data-cal-month]");
  const titleEl = document.querySelector("[data-cal-title]");
  const whoEl = document.querySelector("[data-cal-who]");
  const roleEl = document.querySelector("[data-session-role]");
  const dayView = document.querySelector("[data-cal-day]");
  const dayTitle = document.querySelector("[data-cal-day-title]");
  const dayText = document.querySelector("[data-cal-day-text]");
  const editForm = document.querySelector("[data-cal-edit]");
  const editStatus = document.querySelector("[data-cal-edit-status]");
  if (!gridEl) return;

  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let session = null;
  let worker = null;
  let today = ymd(now);
  let logs = {};
  let selectedDate = "";

  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseYmd(value) {
    const p = String(value || "").split("-").map(Number);
    if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return null;
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function isRest(d) {
    const dow = d.getDay();
    return dow === 0 || dow === 6;
  }

  function asList(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object" && (value.id || value.name || value.date || value.text)) {
      return [value];
    }
    return [];
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function snippet(text) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    return s.length > 28 ? `${s.slice(0, 28)}…` : s;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(options.headers || {}),
      },
      ...options,
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Server xatosi (${res.status})`);
    }
    return data;
  }

  function workerIdFromUrl() {
    const q = new URLSearchParams(window.location.search);
    return String(q.get("id") || "").trim();
  }

  function statusFor(dateStr) {
    const d = parseYmd(dateStr);
    if (!d) return "future";
    if (isRest(d)) return "off";
    if (dateStr > today) return "future";
    if (logs[dateStr]) return "ok";
    return "miss";
  }

  function renderGrid() {
    if (monthEl) monthEl.textContent = `${MONTHS[month - 1]} ${year}`;
    const first = new Date(year, month - 1, 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(year, month - 1, 1 - mondayOffset);
    const cells = WEEKDAYS.map((w) => `<div class="cal-dow">${w}</div>`);
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const dateStr = ymd(d);
      const inMonth = d.getMonth() === month - 1;
      const kind = statusFor(dateStr);
      const selected = dateStr === selectedDate ? " is-selected" : "";
      const preview = kind === "ok" ? snippet(logs[dateStr]) : "";
      cells.push(
        `<button type="button" class="cal-day is-${kind}${inMonth ? "" : " is-out"}${selected}" data-date="${dateStr}">
          <span class="cal-day-num">${d.getDate()}</span>
          ${preview ? `<span class="cal-day-preview">${escapeHtml(preview)}</span>` : ""}
        </button>`
      );
    }
    gridEl.innerHTML = cells.join("");
  }

  function markSelected() {
    gridEl.querySelectorAll(".cal-day").forEach((btn) => {
      btn.classList.toggle("is-selected", btn.getAttribute("data-date") === selectedDate);
    });
  }

  function openDay(dateStr) {
    selectedDate = dateStr;
    markSelected();
    const d = parseYmd(dateStr);
    if (!d || !dayView) return;
    const label = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (dayTitle) dayTitle.textContent = label;
    const kind = statusFor(dateStr);
    const canEdit = session && session.role === "worker";
    if (editForm) editForm.hidden = true;
    if (kind === "off") {
      if (dayText) dayText.textContent = "Dam olish kuni. Ish yozilmaydi.";
      return;
    }
    if (kind === "future") {
      if (dayText) dayText.textContent = "Bu kun hali kelmagan.";
      return;
    }
    const text = logs[dateStr] || "";
    if (dayText) {
      dayText.textContent = text || "Bu kunda ish yozilmagan.";
    }
    if (canEdit && dateStr <= today && kind !== "off") {
      editForm.hidden = false;
      const area = editForm.querySelector("textarea");
      if (area) area.value = text;
      if (editStatus) editStatus.textContent = "";
    }
    if (dayView.scrollIntoView) {
      dayView.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  async function loadMonth() {
    if (!worker || !worker.id) return;
    const data = await api(
      `/api/daily/logs?workerId=${encodeURIComponent(worker.id)}&year=${year}&month=${month}`
    );
    today = data.today || today;
    worker = data.worker || worker;
    logs = {};
    asList(data.logs).forEach((item) => {
      if (item.date) logs[item.date] = item.text || "";
    });
    if (titleEl) titleEl.textContent = worker.name || "Kalendar";
    if (whoEl) whoEl.textContent = worker.lavozim || "";
    renderGrid();
    if (selectedDate) openDay(selectedDate);
    else if (logs[today] || (!isRest(now) && month === now.getMonth() + 1 && year === now.getFullYear())) {
      openDay(today);
    }
  }

  gridEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-date]");
    if (!btn) return;
    event.preventDefault();
    openDay(btn.getAttribute("data-date"));
  });

  document.querySelector("[data-cal-prev]").addEventListener("click", async () => {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    selectedDate = "";
    try {
      await loadMonth();
    } catch (err) {
      alert(err.message);
    }
  });

  document.querySelector("[data-cal-next]").addEventListener("click", async () => {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    selectedDate = "";
    try {
      await loadMonth();
    } catch (err) {
      alert(err.message);
    }
  });

  if (editForm) {
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = String(new FormData(editForm).get("text") || "").trim();
      if (!text || !selectedDate) return;
      try {
        if (editStatus) editStatus.textContent = "Saqlanmoqda...";
        await api("/api/daily/logs", {
          method: "POST",
          body: JSON.stringify({ date: selectedDate, text, workerId: worker.id }),
        });
        logs[selectedDate] = text;
        if (editStatus) editStatus.textContent = "Saqlandi.";
        renderGrid();
        openDay(selectedDate);
      } catch (err) {
        if (editStatus) editStatus.textContent = err.message;
      }
    });
  }

  async function logout() {
    try {
      await api("/api/logout", { method: "POST", body: "{}" });
    } catch {
      /* ignore */
    }
    window.location.replace("admin.html");
  }

  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", logout);
  });

  async function boot() {
    try {
      session = await api("/api/me");
    } catch {
      window.location.replace("admin.html");
      return;
    }
    if (roleEl) roleEl.textContent = session.label || session.role;
    if (session.role === "admin") {
      window.location.replace("sozlamalar.html");
      return;
    }
    const urlId = workerIdFromUrl();
    if (session.role === "director") {
      if (!urlId) {
        window.location.replace("admin.html");
        return;
      }
      worker = { id: urlId };
    } else if (session.role === "worker") {
      const own = String(session.workerId || "").trim();
      if (!own) {
        window.location.replace("admin.html");
        return;
      }
      worker = { id: own };
    } else {
      window.location.replace("admin.html");
      return;
    }
    try {
      await loadMonth();
    } catch (err) {
      if (whoEl) whoEl.textContent = err.message;
      if (dayText) dayText.textContent = err.message;
    }
  }

  boot();
})();

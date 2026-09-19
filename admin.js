(() => {
  const KEYS = {
    session: "ttati_session",
    workers: "ttati_workers",
    botToken: "ttati_bot_token",
    announcements: "ttati_announcements",
    districts: "ttati_districts",
  };

  const loginPanel = document.querySelector("[data-login-panel]");
  const appPanel = document.querySelector("[data-app-panel]");
  const loginForm = document.querySelector("[data-login-form]");
  const loginError = document.querySelector("[data-login-error]");
  const logoutBtn = document.querySelector("[data-logout]");
  const roleEl = document.querySelector("[data-session-role]");
  const directorWork = document.querySelector("[data-director-work]");
  const reportsPanel = document.querySelector("[data-reports-panel]");
  const workerView = document.querySelector("[data-worker-view]");
  const workerReportsNote = document.querySelector("[data-worker-reports-note]");
  const adminTabs = document.querySelector("[data-admin-tabs]");
  const dailyDirector = document.querySelector("[data-daily-director]");
  const dailyWorkerPanel = document.querySelector("[data-daily-worker]");
  const identityForm = document.querySelector("[data-identity-form]");
  const dailyForm = document.querySelector("[data-daily-form]");

  if (!loginPanel || !appPanel) return;

  let state = {
    hasToken: false,
    botUsername: "",
    workers: [],
    announcements: [],
    chats: [],
    districts: [],
    media: { hero: "images/bo-linma.jpg", building: "images/bo-linma.jpg", v: 1 },
    gallery: [],
    contact: {
      phone: "+998 71 246-09-50",
      email: "info@soil.uz",
      address: "Qarshi, Ravoq MFY, Islom Karimov ko‘chasi, 62-uy",
      title: "Qarshi bo‘linmasi",
      lat: "38.892663",
      lng: "65.810101",
    },
    staff: {
      director: {
        name: "Bo‘linma direktori",
        role: "Direktor",
        bio: "",
        photo: "",
      },
      workers: [],
    },
  };
  let apiReady = false;
  let districtCatalog = [];
  let editingDistrict = null;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getSession() {
    return readJson(KEYS.session, null);
  }

  function setSession(session) {
    if (!session) localStorage.removeItem(KEYS.session);
    else writeJson(KEYS.session, session);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function asList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (!value || typeof value !== "object") return [];
    if (value.id || value.chat_id || value.name || value.date || value.text) {
      return [value];
    }
    const vals = Object.values(value);
    if (vals.length && vals.every((v) => v && typeof v === "object" && (v.id || v.chat_id || v.name))) {
      return vals;
    }
    return [];
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

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error("Rasm o‘qilmadi"));
      reader.readAsDataURL(file);
    });
  }

  async function loadState() {
    const data = await api("/api/state");
    state = {
      hasToken: !!data.hasToken,
      botUsername: data.botUsername || "",
      workers: asList(data.workers),
      announcements: asList(data.announcements),
      chats: asList(data.chats),
      districts: Array.isArray(data.districts) ? data.districts : [],
      media: data.media || state.media,
      gallery: Array.isArray(data.gallery) ? data.gallery : [],
      contact: data.contact || state.contact,
      staff: data.staff || state.staff,
    };
    apiReady = true;
    return state;
  }

  async function migrateLocalIfNeeded(role) {
    if (!apiReady) return;
    if (role === "admin") {
      const oldWorkers = readJson(KEYS.workers, []);
      if (Array.isArray(oldWorkers) && oldWorkers.length) {
        localStorage.removeItem(KEYS.workers);
      }
      const oldToken = localStorage.getItem(KEYS.botToken);
      if (!state.hasToken && oldToken) {
        try {
          const saved = await api("/api/token", {
            method: "POST",
            body: JSON.stringify({ token: oldToken }),
          });
          state.hasToken = !!saved.hasToken;
          state.botUsername = saved.botUsername || "";
          localStorage.removeItem(KEYS.botToken);
        } catch {
          /* token noto‘g‘ri bo‘lishi mumkin — foydalanuvchi qayta yozadi */
        }
      }
    }
    if (role === "director" || role === "worker") {
      const oldDistricts = readJson(KEYS.districts, []);
      if (Array.isArray(oldDistricts) && oldDistricts.length) {
        await api("/api/districts", {
          method: "POST",
          body: JSON.stringify({ districts: oldDistricts }),
        });
        localStorage.removeItem(KEYS.districts);
      }
    }
  }

  function renderWorkers() {
    const listEl = document.querySelector("[data-worker-list]");
    if (!listEl) return;
    const workers = asList(state.workers);
    if (!workers.length) {
      listEl.innerHTML = "<li class=\"muted-note\">Ishchilar yo‘q. Telegram chat_id ni pastdagi ro‘yxatdan nusxalang.</li>";
      return;
    }
    listEl.innerHTML = workers
      .map(
        (w, idx) => `
      <li>
        <strong>${escapeHtml(w.name)}</strong> — ${escapeHtml(w.lavozim)}<br />
        Telegram chat_id: ${w.telegram ? `<code>${escapeHtml(String(w.telegram))}</code>` : "<span class=\"muted-note\">yo‘q — pastdan nusxalang</span>"}<br />
        Login: ${w.login ? `<code>${escapeHtml(w.login)}</code>` : "umumiy (<code>ishchi</code>)"}
        <div class="item-actions">
          <button type="button" data-edit-worker="${idx}">Tahrirlash</button>
          <button type="button" data-remove-worker="${idx}">O‘chirish</button>
        </div>
      </li>`
      )
      .join("");

    listEl.querySelectorAll("[data-edit-worker]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-edit-worker"));
        const w = asList(state.workers)[i];
        if (!w || !workerForm) return;
        const idInput = workerForm.querySelector('input[name="id"]');
        if (idInput) idInput.value = w.id || "";
        if (workerForm.name) workerForm.name.value = w.name || "";
        if (workerForm.lavozim) workerForm.lavozim.value = w.lavozim || "";
        if (workerForm.telegram) workerForm.telegram.value = w.telegram || "";
        if (workerForm.login) workerForm.login.value = w.login || "";
        workerForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });

    listEl.querySelectorAll("[data-remove-worker]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const i = Number(btn.getAttribute("data-remove-worker"));
        const next = asList(state.workers).filter((_, idx) => idx !== i);
        try {
          const saved = await api("/api/workers", {
            method: "POST",
            body: JSON.stringify({ workers: next }),
          });
          state.workers = saved.workers || next;
          renderWorkers();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function renderAnnouncements() {
    const lists = document.querySelectorAll("[data-announcement-list]");
    if (!lists.length) return;
    const items = asList(state.announcements);
    const canEdit = (getSession() || {}).role === "director";
    const html = !items.length
      ? "<li class=\"muted-note\">Hozircha e’lon yo‘q.</li>"
      : items
          .map((a) => {
            const actions = canEdit && a.id
              ? `<div class="item-actions">
                  <button type="button" data-edit-announce="${escapeHtml(a.id)}">Tahrirlash</button>
                  <button type="button" data-del-announce="${escapeHtml(a.id)}">O‘chirish</button>
                </div>`
              : "";
            return `
      <li>
        <strong>${escapeHtml(a.title)}</strong>
        <div>${escapeHtml(a.message)}</div>
        <small class="muted-note">${escapeHtml(a.createdAt || "")}</small>
        ${actions}
      </li>`;
          })
          .join("");
    lists.forEach((listEl) => {
      listEl.innerHTML = html;
      listEl.querySelectorAll("[data-edit-announce]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-edit-announce");
          const item = items.find((a) => a.id === id);
          const form = document.querySelector("[data-announce-form]");
          if (!item || !form) return;
          const idInput = form.querySelector('input[name="id"]');
          if (idInput) idInput.value = item.id;
          if (form.title) form.title.value = item.title || "";
          if (form.message) form.message.value = item.message || "";
          const submit = document.querySelector("[data-announce-submit]");
          const cancel = document.querySelector("[data-announce-cancel]");
          if (submit) submit.textContent = "Saqlash";
          if (cancel) cancel.hidden = false;
          form.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });
      listEl.querySelectorAll("[data-del-announce]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-del-announce");
          if (!id || !confirm("E’lonni o‘chirasizmi?")) return;
          try {
            const data = await api("/api/announce/delete", {
              method: "POST",
              body: JSON.stringify({ id }),
            });
            state.announcements = asList(data.announcements);
            renderAnnouncements();
          } catch (err) {
            alert(err.message);
          }
        });
      });
    });
  }

  async function loadAnnouncements() {
    try {
      const data = await api("/api/announcements");
      state.announcements = asList(data.announcements);
      renderAnnouncements();
    } catch {
      renderAnnouncements();
    }
  }

  function renderTokenStatus() {
    const el = document.querySelector("[data-token-status]");
    if (!el) return;
    if (!apiReady) {
      el.textContent = "Lokal server topilmadi. OCHISH.bat orqali oching.";
      return;
    }
    if (state.hasToken) {
      const bot = state.botUsername ? `@${state.botUsername}` : "bot";
      el.textContent = `Token ishlayapti. Bot: ${bot}`;
    } else {
      el.textContent = "Token hali saqlanmagan.";
    }
  }

  function renderChats() {
    const listEl = document.querySelector("[data-chat-list]");
    if (!listEl) return;
    const chats = asList(state.chats);
    if (!chats.length) {
      listEl.innerHTML =
        "<li class=\"muted-note\">Hali hech kim botga yozmagan. Ishchi botni ochib /start bosing, keyin shu tugmani qayta bosing.</li>";
      return;
    }
    listEl.innerHTML = chats
      .map((c) => {
        const user = c.username ? `@${c.username}` : "";
        const id = String(c.id || c.chat_id || "");
        return `<li>
          <strong>${escapeHtml(c.name || "Foydalanuvchi")}</strong> ${escapeHtml(user)}<br />
          chat_id: <code>${escapeHtml(id)}</code>
          <div class="item-actions">
            <button type="button" data-copy-chat="${escapeHtml(id)}">Nusxa</button>
            <button type="button" data-test-chat="${escapeHtml(id)}">Test yuborish</button>
            <button type="button" data-remove-chat="${escapeHtml(id)}">O‘chirish</button>
          </div>
        </li>`;
      })
      .join("");

    listEl.querySelectorAll("[data-copy-chat]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-copy-chat");
        const input = document.querySelector('[data-worker-form] input[name="telegram"]');
        if (input) input.value = id;
        try {
          await navigator.clipboard.writeText(id);
        } catch {
          /* ignore */
        }
      });
    });

    listEl.querySelectorAll("[data-test-chat]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const statusEl = document.querySelector("[data-token-status]");
        try {
          await api("/api/telegram/test", {
            method: "POST",
            body: JSON.stringify({ chat_id: btn.getAttribute("data-test-chat") }),
          });
          if (statusEl) statusEl.textContent = "Test xabar yuborildi. Telegramni tekshiring.";
        } catch (err) {
          if (statusEl) statusEl.textContent = err.message;
        }
      });
    });

    listEl.querySelectorAll("[data-remove-chat]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-remove-chat");
        if (!id || !confirm("Bu chat_id ni ro‘yxatdan o‘chirasizmi?")) return;
        const statusEl = document.querySelector("[data-token-status]");
        try {
          const data = await api("/api/telegram/chats/delete", {
            method: "POST",
            body: JSON.stringify({ chat_id: id }),
          });
          state.chats = asList(data.chats);
          renderChats();
          if (statusEl) statusEl.textContent = "Chat_id o‘chirildi.";
        } catch (err) {
          if (statusEl) statusEl.textContent = err.message;
        }
      });
    });
  }

  function mediaUrl(path) {
    if (!path) return "";
    const v = (state.media && state.media.v) || Date.now();
    return `${path}?v=${v}`;
  }

  function renderMedia() {
    const heroPrev = document.querySelector("[data-preview-hero]");
    if (heroPrev && state.media && state.media.hero) {
      heroPrev.src = mediaUrl(state.media.hero);
    }
  }

  function renderGallery() {
    const listEl = document.querySelector("[data-gallery-list]");
    if (!listEl) return;
    const items = state.gallery || [];
    if (!items.length) {
      listEl.innerHTML = "<li class=\"muted-note\">Hali material yo‘q. Rasm, video yoki YouTube qo‘shing.</li>";
      return;
    }
    const labels = { photo: "Rasm", video: "Video", youtube: "YouTube" };
    listEl.innerHTML = items
      .map(
        (item) => `
      <li>
        <strong>${escapeHtml(item.title)}</strong> — ${escapeHtml(labels[item.type] || item.type)}
        ${item.caption ? `<div>${escapeHtml(item.caption)}</div>` : ""}
        <small class="muted-note">${escapeHtml(item.createdAt || "")}</small>
        <div class="item-actions">
          <button type="button" data-remove-gallery="${escapeHtml(item.id)}">O‘chirish</button>
        </div>
      </li>`
      )
      .join("");

    listEl.querySelectorAll("[data-remove-gallery]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const saved = await api("/api/gallery/delete", {
            method: "POST",
            body: JSON.stringify({ id: btn.getAttribute("data-remove-gallery") }),
          });
          state.gallery = saved.gallery || [];
          renderGallery();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function fillContactForm() {
    const form = document.querySelector("[data-contact-admin-form]");
    if (!form || !state.contact) return;
    const c = state.contact;
    if (form.phone) form.phone.value = c.phone || "";
    if (form.email) form.email.value = c.email || "";
    if (form.address) form.address.value = c.address || "";
    if (form.title) form.title.value = c.title || "";
    if (form.lat) form.lat.value = c.lat || "";
    if (form.lng) form.lng.value = c.lng || "";
  }

  function fillStaffForm() {
    const form = document.querySelector("[data-staff-form]");
    const dir = state.staff && state.staff.director;
    if (!form || !dir) return;
    if (form.name) form.name.value = dir.name || "";
    if (form.role) form.role.value = dir.role || "Direktor";
    if (form.bio) form.bio.value = dir.bio || "";
    const prev = document.querySelector("[data-preview-director]");
    if (prev) {
      if (dir.photo) {
        prev.src = `${dir.photo}?v=${Date.now()}`;
        prev.hidden = false;
      } else {
        prev.hidden = true;
      }
    }
    renderPublicWorkers();
  }

  function publicStaffWorkers() {
    return asList(state.staff && state.staff.workers);
  }

  function renderPublicWorkers() {
    const listEl = document.querySelector("[data-public-worker-list]");
    if (!listEl) return;
    const workers = publicStaffWorkers();
    if (!workers.length) {
      listEl.innerHTML = "<li class=\"muted-note\">Saytda ishchi yo‘q. Pastdan ism va lavozim qo‘shing.</li>";
      return;
    }
    listEl.innerHTML = workers
      .map(
        (w, idx) => `
      <li>
        <strong>${escapeHtml(w.name)}</strong> — ${escapeHtml(w.lavozim || "Ishchi")}
        <div class="item-actions">
          <button type="button" data-edit-public-worker="${idx}">Tahrirlash</button>
          <button type="button" data-remove-public-worker="${idx}">O‘chirish</button>
        </div>
      </li>`
      )
      .join("");
    const form = document.querySelector("[data-public-worker-form]");
    listEl.querySelectorAll("[data-edit-public-worker]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-edit-public-worker"));
        const w = publicStaffWorkers()[i];
        if (!w || !form) return;
        const idInput = form.querySelector('input[name="id"]');
        if (idInput) idInput.value = w.id || "";
        if (form.name) form.name.value = w.name || "";
        if (form.lavozim) form.lavozim.value = w.lavozim || "";
        form.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
    listEl.querySelectorAll("[data-remove-public-worker]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const i = Number(btn.getAttribute("data-remove-public-worker"));
        const next = publicStaffWorkers().filter((_, idx) => idx !== i);
        try {
          const saved = await api("/api/staff/workers", {
            method: "POST",
            body: JSON.stringify({ workers: next }),
          });
          if (saved.staff) state.staff = saved.staff;
          else state.staff = { ...(state.staff || {}), workers: next };
          renderPublicWorkers();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function mergeDistricts(baseDistricts, overrides) {
    const map = new Map();
    (baseDistricts || []).forEach((d) => {
      if (d && d.id) map.set(d.id, { ...d });
    });
    (overrides || []).forEach((d) => {
      if (!d || !d.id) return;
      if (d.deleted) {
        map.delete(d.id);
        return;
      }
      map.set(d.id, { ...(map.get(d.id) || {}), ...d });
    });
    return Array.from(map.values()).sort((a, b) =>
      String(a.name || a.id).localeCompare(String(b.name || b.id), "uz")
    );
  }

  async function loadDistrictCatalog() {
    try {
      const [baseRes, overRes] = await Promise.all([
        fetch("data/districts.json", { cache: "no-store", credentials: "same-origin" }),
        fetch("data/district-overrides.json", { cache: "no-store", credentials: "same-origin" }),
      ]);
      const base = baseRes.ok ? await baseRes.json() : { districts: [] };
      const over = overRes.ok ? await overRes.json() : { districts: [] };
      districtCatalog = mergeDistricts(base.districts, over.districts);
    } catch {
      districtCatalog = [];
    }
    renderDistrictAdmin();
  }

  function findDistrict(id) {
    return districtCatalog.find((d) => d.id === id) || null;
  }

  function setDistrictFileNote(district) {
    const note = document.querySelector("[data-district-file-note]");
    if (!note) return;
    if (district && district.file) {
      note.textContent = `Hozirgi fayl: ${district.file}`;
    } else {
      note.textContent = "";
    }
  }

  function fillDistrictForm(district) {
    const form = document.querySelector("[data-district-form]");
    if (!form || !district) return;
    editingDistrict = district;
    const set = (name, value) => {
      if (form[name] != null) form[name].value = value ?? "";
    };
    set("id", district.id);
    set("name", district.name);
    set("type", district.type || "tuman");
    set("sampleId", district.sampleId);
    set("date", district.date);
    set("depth", district.depth);
    set("description", district.description);
    set("uscs", district.uscs);
    set("mc", district.mc);
    set("ll", district.ll);
    set("pl", district.pl);
    set("pi", district.pi);
    set("fines", district.fines);
    set("ph", district.ph);
    set("organic", district.organic);
    const npk = district.npk || {};
    set("n", npk.n);
    set("p", npk.p);
    set("k", npk.k);
    const texture = district.texture || {};
    set("sand", texture.sand);
    set("silt", texture.silt);
    set("clay", texture.clay);
    const pick = document.querySelector("[data-district-pick]");
    if (pick) pick.value = district.id || "";
    setDistrictFileNote(district);
    const fileInput = form.querySelector('input[name="file"]');
    if (fileInput) fileInput.value = "";
  }

  function resetDistrictForm() {
    const form = document.querySelector("[data-district-form]");
    if (form) form.reset();
    editingDistrict = null;
    const pick = document.querySelector("[data-district-pick]");
    if (pick) pick.value = "";
    setDistrictFileNote(null);
  }

  function renderDistrictAdmin() {
    const pick = document.querySelector("[data-district-pick]");
    const listEl = document.querySelector("[data-admin-district-list]");
    if (pick) {
      const current = pick.value;
      pick.innerHTML =
        '<option value="">— Yangi hisobot —</option>' +
        districtCatalog
          .map(
            (d) =>
              `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name || d.id)}</option>`
          )
          .join("");
      if (current && districtCatalog.some((d) => d.id === current)) {
        pick.value = current;
      }
    }
    if (!listEl) return;
    if (!districtCatalog.length) {
      listEl.innerHTML = '<li class="muted-note">Hisobot yo‘q.</li>';
      return;
    }
    listEl.innerHTML = districtCatalog
      .map((d) => {
        const file = d.file
          ? `<div class="muted-note">Fayl: ${escapeHtml(d.file)}</div>`
          : '<div class="muted-note">Fayl yo‘q</div>';
        return `<li>
          <strong>${escapeHtml(d.name || d.id)}</strong> — ${escapeHtml(d.date || "")}
          ${file}
          <div class="item-actions">
            <button type="button" data-edit-district="${escapeHtml(d.id)}">Tahrirlash</button>
            <button type="button" data-remove-district="${escapeHtml(d.id)}">O‘chirish</button>
          </div>
        </li>`;
      })
      .join("");

    listEl.querySelectorAll("[data-edit-district]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = findDistrict(btn.getAttribute("data-edit-district"));
        if (d) {
          fillDistrictForm(d);
          document.querySelector("[data-district-form]")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      });
    });

    listEl.querySelectorAll("[data-remove-district]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-remove-district");
        const d = findDistrict(id);
        if (!confirm(`“${d ? d.name : id}” hisobotini o‘chirasizmi?`)) return;
        try {
          await api("/api/districts/delete", {
            method: "POST",
            body: JSON.stringify({ id }),
          });
          if (editingDistrict && editingDistrict.id === id) resetDistrictForm();
          await loadDistrictCatalog();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function announceWorkerSource() {
    const fromState = asList(state.workers);
    if (fromState.length) return fromState;
    return asList(dailyRoster);
  }

  function renderAnnounceTargets() {
    const box = document.querySelector("[data-announce-worker-list]");
    if (!box) return;
    const workers = announceWorkerSource();
    if (!workers.length) {
      box.innerHTML = '<p class="muted-note">Ishchilar yo‘q. Kunlik ish yoki Sozlamalarda ism qo‘shing.</p>';
      return;
    }
    box.innerHTML = workers
      .map((w) => {
        const id = String(w.id || "");
        const note = w.telegram ? "" : ' <span class="muted-note">(chat_id yo‘q)</span>';
        return `<label class="check-row"><input type="checkbox" name="workerId" value="${escapeHtml(id)}" /> ${escapeHtml(w.name || "Ishchi")}${note}</label>`;
      })
      .join("");
    box.querySelectorAll('input[name="workerId"]').forEach((el) => {
      el.addEventListener("change", () => {
        const all = document.querySelector("[data-announce-all]");
        if (el.checked && all) all.checked = false;
      });
    });
  }

  function bindAnnounceAll() {
    const all = document.querySelector("[data-announce-all]");
    if (!all || all.dataset.bound === "1") return;
    all.dataset.bound = "1";
    all.addEventListener("change", () => {
      if (!all.checked) return;
      document.querySelectorAll('input[name="workerId"]').forEach((el) => {
        el.checked = false;
      });
    });
  }

  function renderAll() {
    renderAnnouncements();
    renderWorkers();
    renderAnnounceTargets();
    bindAnnounceAll();
    renderTokenStatus();
    renderChats();
    renderMedia();
    renderGallery();
    fillContactForm();
    fillStaffForm();
    renderPublicWorkers();
    loadDistrictCatalog();
  }

  let currentTab = "daily";
  let dailyRoster = [];
  let dailyToday = "";

  function hideWorkPanels() {
    if (directorWork) directorWork.hidden = true;
    if (reportsPanel) reportsPanel.hidden = true;
    if (workerView) workerView.hidden = true;
    if (dailyDirector) dailyDirector.hidden = true;
    if (dailyWorkerPanel) dailyWorkerPanel.hidden = true;
  }

  function showTab(name) {
    currentTab = name;
    const session = getSession() || {};
    const isDirector = session.role === "director";
    const isWorker = session.role === "worker";
    hideWorkPanels();
    if (adminTabs) {
      adminTabs.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.getAttribute("data-tab") === name);
      });
    }
    if (name === "daily") {
      if (isDirector && dailyDirector) dailyDirector.hidden = false;
      if (isWorker && dailyWorkerPanel) dailyWorkerPanel.hidden = false;
    } else if (name === "soil") {
      if (reportsPanel) reportsPanel.hidden = false;
      loadDistrictCatalog();
    } else if (name === "announce") {
      if (isDirector && directorWork) directorWork.hidden = false;
      if (workerView) workerView.hidden = false;
      renderAnnounceTargets();
      bindAnnounceAll();
    }
  }

  function renderDailyRoster() {
    const listEl = document.querySelector("[data-daily-worker-list]");
    if (!listEl) return;
    if (!dailyRoster.length) {
      listEl.innerHTML = "<p class=\"muted-note\">Hali ishchi yo‘q. Pastdan ism qo‘shing.</p>";
      return;
    }
    listEl.innerHTML = dailyRoster
      .map((w) => {
        const status = w.todayStatus || "miss";
        return `<div class="worker-row-wrap">
          <a class="worker-row" href="kunlik.html?id=${encodeURIComponent(w.id)}">
            <span class="worker-dot is-${escapeHtml(status)}"></span>
            <span>
              <strong>${escapeHtml(w.name)}</strong>
              <small>${escapeHtml(w.lavozim || "")}</small>
            </span>
          </a>
          <div class="item-actions">
            <button type="button" data-edit-staff="${escapeHtml(w.id)}">Tahrirlash</button>
            <button type="button" data-del-staff="${escapeHtml(w.id)}">O‘chirish</button>
          </div>
        </div>`;
      })
      .join("");

    listEl.querySelectorAll("[data-edit-staff]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-edit-staff");
        const w = dailyRoster.find((item) => item.id === id);
        const form = document.querySelector("[data-daily-add-form]");
        if (!w || !form) return;
        const idInput = form.querySelector('input[name="id"]');
        if (idInput) idInput.value = w.id;
        if (form.name) form.name.value = w.name || "";
        if (form.lavozim) form.lavozim.value = w.lavozim || "Ishchi";
        const title = document.querySelector("[data-daily-add-title]");
        const submit = document.querySelector("[data-daily-add-submit]");
        const cancel = document.querySelector("[data-daily-add-cancel]");
        if (title) title.textContent = "Ishchini tahrirlash";
        if (submit) submit.textContent = "Saqlash";
        if (cancel) cancel.hidden = false;
        form.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });

    listEl.querySelectorAll("[data-del-staff]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del-staff");
        const w = dailyRoster.find((item) => item.id === id);
        if (!id || !confirm(`${w ? w.name : "Ishchi"}ni o‘chirasizmi?`)) return;
        try {
          await api("/api/daily/staff/delete", {
            method: "POST",
            body: JSON.stringify({ id }),
          });
          const session = getSession();
          if (session) await loadDailyRoster(session);
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function fillIdentitySelect() {
    const sel = document.querySelector("[data-identity-select]");
    if (!sel) return;
    const current = String((getSession() || {}).workerId || "");
    sel.innerHTML =
      "<option value=\"\">— Tanlang —</option>" +
      dailyRoster
        .map(
          (w) =>
            `<option value="${escapeHtml(w.id)}" ${w.id === current ? "selected" : ""}>${escapeHtml(w.name)}</option>`
        )
        .join("");
  }

  async function fillTodayLog(session) {
    if (!dailyForm || !session.workerId) return;
    dailyForm.hidden = false;
    if (identityForm && session.username !== "ishchi") identityForm.hidden = true;
    else if (identityForm && session.workerId) identityForm.hidden = true;
    const todayEl = document.querySelector("[data-daily-today]");
    const calLink = document.querySelector("[data-own-calendar]");
    if (calLink) calLink.href = "kunlik.html";
    const area = dailyForm.querySelector("textarea");
    const submitBtn = dailyForm.querySelector("button[type='submit']");
    const now = new Date();
    const rest = now.getDay() === 0 || now.getDay() === 6;
    if (rest) {
      if (todayEl) todayEl.textContent = "Bugun dam olish kuni. Hisobot yozilmaydi.";
      if (area) area.disabled = true;
      if (submitBtn) submitBtn.hidden = true;
      return;
    }
    if (area) area.disabled = false;
    if (submitBtn) submitBtn.hidden = false;
    try {
      const data = await api(
        `/api/daily/logs?workerId=${encodeURIComponent(session.workerId)}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`
      );
      dailyToday = data.today || dailyToday;
      if (todayEl) todayEl.textContent = `Sana: ${dailyToday}`;
      const found = asList(data.logs).find((item) => item.date === dailyToday);
      if (area) area.value = found ? found.text : "";
    } catch {
      if (todayEl) todayEl.textContent = dailyToday ? `Sana: ${dailyToday}` : "";
    }
  }

  async function loadDailyRoster(session) {
    try {
      const data = await api("/api/daily/workers");
      dailyRoster = asList(data.workers);
      dailyToday = data.today || "";
      if (data.workerId && session && !session.workerId) {
        session.workerId = data.workerId;
        setSession(session);
      }
      if (session.role === "director") {
        renderDailyRoster();
        renderAnnounceTargets();
        bindAnnounceAll();
      }
      if (session.role === "worker") {
        fillIdentitySelect();
        const sid = String(session.workerId || data.workerId || "");
        if (sid) {
          session.workerId = sid;
          setSession(session);
          await fillTodayLog(session);
        } else if (identityForm) {
          identityForm.hidden = false;
          if (dailyForm) dailyForm.hidden = true;
        }
      }
    } catch (err) {
      const listEl = document.querySelector("[data-daily-worker-list]");
      if (listEl) listEl.innerHTML = `<p class="muted-note">${escapeHtml(err.message)}</p>`;
    }
  }

  function showApp(session) {
    const isSitePage = document.body.hasAttribute("data-site-admin");
    const isAdmin = session.role === "admin";
    const isDirector = session.role === "director";
    const isWorker = session.role === "worker";

    if (isSitePage) {
      if (!isAdmin) {
        window.location.replace("admin.html");
        return;
      }
    } else if (isAdmin) {
      window.location.replace("sozlamalar.html");
      return;
    } else if (!isDirector && !isWorker) {
      showLogin();
      return;
    }

    loginPanel.hidden = true;
    appPanel.hidden = false;
    if (roleEl) roleEl.textContent = session.label || session.role;

    document.body.classList.toggle("is-site-admin", isAdmin);
    document.body.classList.toggle("is-director-admin", isDirector);
    document.body.classList.toggle("is-worker-admin", isWorker);

    if (workerReportsNote) workerReportsNote.hidden = !isWorker;

    if (isAdmin) {
      renderAll();
      return;
    }

    hideWorkPanels();
    if (adminTabs) {
      adminTabs.hidden = false;
      const announceTab = adminTabs.querySelector("[data-tab-announce]");
      if (announceTab) announceTab.hidden = false;
    }
    loadAnnouncements();
    showTab("daily");
    loadDailyRoster(session);
  }

  function showLogin() {
    document.body.classList.remove("is-director-admin", "is-worker-admin", "is-site-admin");
    loginPanel.hidden = false;
    appPanel.hidden = true;
  }

  async function enterSession(session) {
    setSession(session);
    if (session.role === "admin" || session.role === "director") {
      await loadState();
      await migrateLocalIfNeeded(session.role);
      await loadState();
    } else if (session.role === "worker") {
      await migrateLocalIfNeeded(session.role);
    }
    showApp(session);
  }

  async function boot() {
    try {
      const me = await api("/api/me");
      if (me.role === "admin" || me.role === "director" || me.role === "worker") {
        await enterSession({
          username: me.username,
          role: me.role,
          label: me.label,
          workerId: me.workerId || "",
        });
        return;
      }
    } catch {
      apiReady = false;
    }
    showLogin();
  }

  if (loginForm) {
    loginForm.querySelectorAll("[data-fill-user]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const user = loginForm.querySelector("[name=username]");
        const pass = loginForm.querySelector("[name=password]");
        if (user) user.value = btn.getAttribute("data-fill-user") || "";
        if (pass) pass.focus();
      });
    });
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(loginForm);
      const username = String(fd.get("username") || "").trim();
      const password = String(fd.get("password") || "");
      try {
        if (loginError) loginError.hidden = true;
        const session = await api("/api/login", {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });
        await enterSession({
          username: session.username,
          role: session.role,
          label: session.label,
          workerId: session.workerId || "",
        });
        loginForm.reset();
      } catch (err) {
        if (loginError) {
          loginError.hidden = false;
          loginError.textContent = err.message || "Login yoki parol noto‘g‘ri.";
        }
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await api("/api/logout", { method: "POST", body: "{}" });
      } catch {
        /* ignore */
      }
      setSession(null);
      showLogin();
    });
  }

  const workerForm = document.querySelector("[data-worker-form]");
  if (workerForm) {
    workerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(workerForm);
      const worker = {
        id: String(fd.get("id") || "").trim(),
        name: String(fd.get("name") || "").trim(),
        lavozim: String(fd.get("lavozim") || "").trim(),
        telegram: String(fd.get("telegram") || "").trim(),
        login: String(fd.get("login") || "").trim().toLowerCase(),
        password: String(fd.get("password") || "").trim(),
      };
      if (!worker.name || !worker.lavozim) return;
      const list = [...asList(state.workers)];
      let idx = worker.id
        ? list.findIndex((w) => w.id === worker.id)
        : list.findIndex((w) => String(w.name || "").toLowerCase() === worker.name.toLowerCase());
      if (idx >= 0) {
        worker.id = list[idx].id || worker.id;
        if (!worker.password) delete worker.password;
        if (!worker.telegram) worker.telegram = list[idx].telegram || "";
        if (!worker.login) worker.login = list[idx].login || "";
        list[idx] = { ...list[idx], ...worker };
      } else {
        if (!worker.password) delete worker.password;
        list.push(worker);
      }
      try {
        const saved = await api("/api/workers", {
          method: "POST",
          body: JSON.stringify({ workers: list }),
        });
        state.workers = asList(saved.workers).length ? asList(saved.workers) : list;
        renderWorkers();
        renderAnnounceTargets();
        workerForm.reset();
        const idInput = workerForm.querySelector('input[name="id"]');
        if (idInput) idInput.value = "";
      } catch (err) {
        alert(err.message);
      }
    });
  }

  const tokenForm = document.querySelector("[data-token-form]");
  if (tokenForm) {
    tokenForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(tokenForm);
      const token = String(fd.get("token") || "").trim();
      const statusEl = document.querySelector("[data-token-status]");
      if (!token) {
        if (statusEl) statusEl.textContent = "Token maydonini to‘ldiring.";
        return;
      }
      try {
        if (statusEl) statusEl.textContent = "Tekshirilmoqda...";
        const saved = await api("/api/token", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        state.hasToken = !!saved.hasToken;
        state.botUsername = saved.botUsername || "";
        state.chats = asList(saved.chats);
        localStorage.removeItem(KEYS.botToken);
        renderTokenStatus();
        renderChats();
        tokenForm.reset();
        if (statusEl) {
          statusEl.textContent = state.chats.length
            ? `Token saqlandi. ${state.chats.length} ta chat_id topildi.`
            : "Token saqlandi. Ishchi botga /start yozsin, keyin «Chatlarni yangilash» bosing.";
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  const chatsBtn = document.querySelector("[data-refresh-chats]");
  if (chatsBtn) {
    chatsBtn.addEventListener("click", async () => {
      const statusEl = document.querySelector("[data-token-status]");
      try {
        chatsBtn.disabled = true;
        const data = await api("/api/telegram/chats");
        state.chats = asList(data.chats);
        renderChats();
        if (statusEl) {
          statusEl.textContent = state.chats.length
            ? `${state.chats.length} ta chat_id topildi. Nusxa tugmasi bilan ishchiga yozing.`
            : "Hali chat_id yo‘q. Ishchi botni ochib /start yozsin, 5 soniya kutib qayta bosing.";
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      } finally {
        chatsBtn.disabled = false;
      }
    });
  }

  const announceForm = document.querySelector("[data-announce-form]");
  if (announceForm) {
    bindAnnounceAll();
    announceForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(announceForm);
      const title = String(fd.get("title") || "").trim();
      const message = String(fd.get("message") || "").trim();
      const statusEl = document.querySelector("[data-announce-status]");
      const sendAll = Boolean(announceForm.querySelector("[data-announce-all]")?.checked);
      const workerIds = [...announceForm.querySelectorAll('input[name="workerId"]:checked')].map(
        (el) => String(el.value || "").trim()
      ).filter(Boolean);
      const scope = !sendAll && workerIds.length ? "selected" : "all";
      if (!title || !message) return;
      if (!sendAll && !workerIds.length) {
        if (statusEl) statusEl.textContent = "Hammaga ni belgilang, yoki kamida bitta ishchini tanlang.";
        return;
      }
      try {
        if (statusEl) statusEl.textContent = "Yuborilmoqda...";
        const data = await api("/api/announce", {
          method: "POST",
          body: JSON.stringify({
            title,
            message,
            id: String(fd.get("id") || "").trim(),
            scope,
            workerIds: scope === "selected" ? workerIds : [],
          }),
        });
        state.announcements = asList(data.announcements);
        renderAnnouncements();
        const editing = String(fd.get("id") || "").trim();
        const failed = Array.isArray(data.failed)
          ? data.failed.map(String).filter(Boolean)
          : data.failed
            ? Object.values(data.failed).map(String).filter(Boolean)
            : [];
        if (statusEl) {
          if (editing) statusEl.textContent = "E’lon yangilandi.";
          else if (Number(data.sent) > 0 && failed.length) {
            statusEl.textContent = `Telegram: ${data.sent} ta yetib bordi. Xato: ${failed.join("; ")}`;
          } else if (Number(data.sent) > 0) {
            statusEl.textContent = `E’lon Telegramga ${data.sent} ta odamga yuborildi.`;
          } else {
            statusEl.textContent = failed.length
              ? failed.join("; ")
              : "E’lon saytga saqlandi, lekin Telegramga yuborilmadi. Xodimda chat_id bo‘lsin yoki botga /start yozsin.";
          }
        }
        announceForm.reset();
        renderAnnounceTargets();
        const allBox = announceForm.querySelector("[data-announce-all]");
        if (allBox) allBox.checked = true;
        const submit = document.querySelector("[data-announce-submit]");
        const cancel = document.querySelector("[data-announce-cancel]");
        if (submit) submit.textContent = "Yuborish";
        if (cancel) cancel.hidden = true;
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  const announceCancel = document.querySelector("[data-announce-cancel]");
  if (announceCancel && announceForm) {
    announceCancel.addEventListener("click", () => {
      announceForm.reset();
      renderAnnounceTargets();
      const allBox = announceForm.querySelector("[data-announce-all]");
      if (allBox) allBox.checked = true;
      const submit = document.querySelector("[data-announce-submit]");
      if (submit) submit.textContent = "Yuborish";
      announceCancel.hidden = true;
      const statusEl = document.querySelector("[data-announce-status]");
      if (statusEl) statusEl.textContent = "";
    });
  }

  async function uploadSlot(slot, file, statusEl) {
    if (!file) return;
    if (statusEl) statusEl.textContent = "Yuklanmoqda...";
    const data = await fileToBase64(file);
    const saved = await api("/api/upload", {
      method: "POST",
      body: JSON.stringify({
        slot,
        filename: file.name,
        type: file.type,
        data,
      }),
    });
    state.media = saved.media || {
      ...state.media,
      [slot]: saved.path,
      v: saved.v,
    };
    if (saved.staff) state.staff = saved.staff;
    renderMedia();
    fillStaffForm();
    if (statusEl) {
      statusEl.textContent =
        slot === "director"
          ? "Rasm saqlandi. Bosh sahifadagi Rahbariyatda ko‘rinadi."
          : "Rasm saqlandi. Bosh sahifada ko‘rinadi.";
    }
  }

  const heroForm = document.querySelector("[data-hero-form]");
  if (heroForm) {
    heroForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const file = heroForm.querySelector('input[type="file"]')?.files?.[0];
      const statusEl = document.querySelector("[data-hero-status]");
      try {
        await uploadSlot("hero", file, statusEl);
        heroForm.reset();
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  const galleryKind = document.querySelector("[data-gallery-kind]");
  const galleryFileWrap = document.querySelector("[data-gallery-file-wrap]");
  const galleryUrlWrap = document.querySelector("[data-gallery-url-wrap]");
  const galleryFileInput = document.querySelector('[data-gallery-form] input[name="file"]');

  function syncGalleryKind() {
    const kind = galleryKind ? galleryKind.value : "photo";
    const isYt = kind === "youtube";
    if (galleryFileWrap) galleryFileWrap.hidden = isYt;
    if (galleryUrlWrap) galleryUrlWrap.hidden = !isYt;
    if (galleryFileInput) {
      galleryFileInput.required = !isYt;
      galleryFileInput.accept =
        kind === "video"
          ? "video/mp4,video/webm"
          : "image/png,image/jpeg,image/webp,image/gif";
    }
  }

  if (galleryKind) {
    galleryKind.addEventListener("change", syncGalleryKind);
    syncGalleryKind();
  }

  const galleryForm = document.querySelector("[data-gallery-form]");
  if (galleryForm) {
    galleryForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(galleryForm);
      const title = String(fd.get("title") || "").trim();
      const caption = String(fd.get("caption") || "").trim();
      const kind = String(fd.get("kind") || "photo");
      const statusEl = document.querySelector("[data-gallery-status]");
      if (!title) return;
      try {
        if (statusEl) statusEl.textContent = "Saqlanmoqda...";
        let saved;
        if (kind === "youtube") {
          saved = await api("/api/gallery", {
            method: "POST",
            body: JSON.stringify({
              title,
              caption,
              url: String(fd.get("url") || "").trim(),
            }),
          });
        } else {
          const file = galleryForm.querySelector('input[name="file"]')?.files?.[0];
          if (!file) {
            if (statusEl) statusEl.textContent = "Fayl tanlang.";
            return;
          }
          const params = new URLSearchParams({
            kind,
            title,
            caption,
            filename: file.name,
          });
          const res = await fetch(`/api/gallery/upload?${params.toString()}`, {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
            cache: "no-store",
            credentials: "same-origin",
          });
          saved = await res.json().catch(() => ({}));
          if (!res.ok || saved.ok === false) {
            throw new Error(saved.error || `Server xatosi (${res.status})`);
          }
        }
        state.gallery = saved.gallery || state.gallery;
        renderGallery();
        galleryForm.reset();
        syncGalleryKind();
        if (statusEl) statusEl.textContent = "Galereyaga qo‘shildi.";
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  const contactAdminForm = document.querySelector("[data-contact-admin-form]");
  if (contactAdminForm) {
    contactAdminForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(contactAdminForm);
      const statusEl = document.querySelector("[data-contact-admin-status]");
      const payload = {
        phone: String(fd.get("phone") || "").trim(),
        email: String(fd.get("email") || "").trim(),
        address: String(fd.get("address") || "").trim(),
        title: String(fd.get("title") || "").trim(),
        lat: String(fd.get("lat") || "").trim(),
        lng: String(fd.get("lng") || "").trim(),
      };
      try {
        if (statusEl) statusEl.textContent = "Saqlanmoqda...";
        const saved = await api("/api/contact", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        state.contact = saved.contact || payload;
        fillContactForm();
        if (statusEl) statusEl.textContent = "Aloqa ma’lumotlari saqlandi.";
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  const districtForm = document.querySelector("[data-district-form]");
  const districtPick = document.querySelector("[data-district-pick]");
  const districtReset = document.querySelector("[data-district-reset]");

  if (districtPick) {
    districtPick.addEventListener("change", () => {
      const id = districtPick.value;
      if (!id) {
        resetDistrictForm();
        return;
      }
      const d = findDistrict(id);
      if (d) fillDistrictForm(d);
    });
  }

  if (districtReset) {
    districtReset.addEventListener("click", () => resetDistrictForm());
  }

  async function uploadDistrictFile(id, file) {
    const params = new URLSearchParams({
      id,
      filename: file.name,
    });
    const res = await fetch(`/api/districts/file?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
      cache: "no-store",
      credentials: "same-origin",
    });
    const saved = await res.json().catch(() => ({}));
    if (!res.ok || saved.ok === false) {
      throw new Error(saved.error || `Server xatosi (${res.status})`);
    }
    return saved;
  }

  if (districtForm) {
    districtForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(districtForm);
      const id = String(fd.get("id") || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");

      const sand = Number(fd.get("sand") || 40);
      const silt = Number(fd.get("silt") || 35);
      const clay = Number(fd.get("clay") || 25);
      const existing = findDistrict(id) || editingDistrict || {};
      const file = districtForm.querySelector('input[name="file"]')?.files?.[0];

      const report = {
        ...existing,
        id,
        name: String(fd.get("name") || "").trim(),
        type: String(fd.get("type") || "tuman"),
        sampleId: String(fd.get("sampleId") || "").trim(),
        date: String(fd.get("date") || "").trim(),
        depth: String(fd.get("depth") || "").trim(),
        description: String(fd.get("description") || "").trim(),
        uscs: String(fd.get("uscs") || "").trim(),
        mc: Number(fd.get("mc")),
        ll: Number(fd.get("ll")),
        pl: Number(fd.get("pl")),
        pi: Number(fd.get("pi")),
        fines: Number(fd.get("fines")),
        ph: Number(fd.get("ph") || 7),
        organic: Number(fd.get("organic") || 1),
        npk: {
          n: Number(fd.get("n")),
          p: Number(fd.get("p")),
          k: Number(fd.get("k")),
        },
        texture: { sand, silt, clay },
        proctor: existing.proctor || {
          moisture: [8, 10, 12, 14, 16, 18],
          density: [1.55, 1.62, 1.68, 1.71, 1.66, 1.58],
          mdx: 1.71,
          omc: 14,
        },
        grain: existing.grain || {
          sizes: [20, 10, 4.75, 2, 0.425, 0.075, 0.02, 0.005],
          finer: [100, 98, 92, 85, 70, 58, 40, 23],
        },
        cbr: existing.cbr || {
          pen: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5],
          stress: [120, 240, 410, 560, 680, 760],
          cbr95: 18,
        },
      };
      delete report.deleted;

      const statusEl = document.querySelector("[data-district-status]");
      try {
        if (statusEl) statusEl.textContent = "Saqlanmoqda...";
        await api("/api/districts", {
          method: "POST",
          body: JSON.stringify(report),
        });
        if (file) {
          const uploaded = await uploadDistrictFile(id, file);
          report.file = uploaded.path;
        }
        if (statusEl) {
          statusEl.textContent = file
            ? `“${report.name}” saqlandi va fayl almashtirildi.`
            : `“${report.name}” saqlandi. Hisobotlar sahifasida ko‘rinadi.`;
        }
        districtForm.querySelector('input[name="file"]').value = "";
        await loadDistrictCatalog();
        const updated = findDistrict(id);
        if (updated) fillDistrictForm(updated);
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  const staffForm = document.querySelector("[data-staff-form]");
  if (staffForm) {
    staffForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(staffForm);
      const statusEl = document.querySelector("[data-staff-status]");
      const payload = {
        name: String(fd.get("name") || "").trim(),
        role: String(fd.get("role") || "").trim(),
        bio: String(fd.get("bio") || "").trim(),
      };
      try {
        if (statusEl) statusEl.textContent = "Saqlanmoqda...";
        const saved = await api("/api/staff", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        state.staff = saved.staff || state.staff;
        fillStaffForm();
        if (statusEl) statusEl.textContent = "Direktor ma’lumoti saqlandi. Bosh sahifadagi Rahbariyatda ko‘rinadi.";
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  const publicWorkerForm = document.querySelector("[data-public-worker-form]");
  if (publicWorkerForm) {
    publicWorkerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(publicWorkerForm);
      const statusEl = document.querySelector("[data-public-worker-status]");
      const worker = {
        id: String(fd.get("id") || "").trim(),
        name: String(fd.get("name") || "").trim(),
        lavozim: String(fd.get("lavozim") || "").trim(),
      };
      if (!worker.name || !worker.lavozim) return;
      const list = [...publicStaffWorkers()];
      let idx = worker.id
        ? list.findIndex((w) => w.id === worker.id)
        : list.findIndex((w) => String(w.name || "").toLowerCase() === worker.name.toLowerCase());
      if (idx >= 0) {
        worker.id = list[idx].id || worker.id;
        list[idx] = { ...list[idx], ...worker };
      } else {
        list.push(worker);
      }
      try {
        if (statusEl) statusEl.textContent = "Saqlanmoqda...";
        const saved = await api("/api/staff/workers", {
          method: "POST",
          body: JSON.stringify({ workers: list }),
        });
        if (saved.staff) state.staff = saved.staff;
        else state.staff = { ...(state.staff || {}), workers: list };
        renderPublicWorkers();
        publicWorkerForm.reset();
        const idInput = publicWorkerForm.querySelector('input[name="id"]');
        if (idInput) idInput.value = "";
        if (statusEl) statusEl.textContent = "Saqlandi. Bosh sahifadagi Rahbariyatda ko‘rinadi.";
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  const directorPhotoForm = document.querySelector("[data-director-photo-form]");
  if (directorPhotoForm) {
    directorPhotoForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const file = directorPhotoForm.querySelector('input[type="file"]')?.files?.[0];
      const statusEl = document.querySelector("[data-director-photo-status]");
      try {
        await uploadSlot("director", file, statusEl);
        if (statusEl && !statusEl.textContent.includes("xato") && file) {
          statusEl.textContent = "Rasm saqlandi. Bosh sahifadagi Rahbariyatda ko‘rinadi.";
        }
        const prev = document.querySelector("[data-preview-director]");
        if (prev && file) {
          prev.src = URL.createObjectURL(file);
          prev.hidden = false;
        }
        directorPhotoForm.reset();
        try {
          const data = await api("/api/state");
          if (data.staff) {
            state.staff = data.staff;
            fillStaffForm();
          }
        } catch {
          /* ignore */
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  const passwordForm = document.querySelector("[data-password-form]");
  if (passwordForm) {
    passwordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(passwordForm);
      const statusEl = document.querySelector("[data-password-status]");
      const currentPassword = String(fd.get("currentPassword") || "");
      const adminPassword = String(fd.get("adminPassword") || "").trim();
      const adminPassword2 = String(fd.get("adminPassword2") || "").trim();
      const directorPassword = String(fd.get("directorPassword") || "").trim();
      const directorPassword2 = String(fd.get("directorPassword2") || "").trim();
      const workerPassword = String(fd.get("workerPassword") || "").trim();
      const workerPassword2 = String(fd.get("workerPassword2") || "").trim();
      if (adminPassword && adminPassword !== adminPassword2) {
        if (statusEl) statusEl.textContent = "Sayt admin parollari mos emas.";
        return;
      }
      if (directorPassword && directorPassword !== directorPassword2) {
        if (statusEl) statusEl.textContent = "Direktor parollari mos emas.";
        return;
      }
      if (workerPassword && workerPassword !== workerPassword2) {
        if (statusEl) statusEl.textContent = "Ishchi parollari mos emas.";
        return;
      }
      if (!adminPassword && !directorPassword && !workerPassword) {
        if (statusEl) statusEl.textContent = "Yangi parol yozing.";
        return;
      }
      try {
        if (statusEl) statusEl.textContent = "Saqlanmoqda...";
        const payload = { currentPassword };
        if (adminPassword) payload.adminPassword = adminPassword;
        if (directorPassword) payload.directorPassword = directorPassword;
        if (workerPassword) payload.workerPassword = workerPassword;
        await api("/api/passwords", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        passwordForm.reset();
        if (statusEl) {
          statusEl.textContent =
            "Parol yangilandi. O‘zgargan loginlar yangi parol bilan kiradi.";
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  if (adminTabs) {
    adminTabs.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-tab");
        if (name) showTab(name);
      });
    });
  }

  if (identityForm) {
    identityForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(identityForm);
      const workerId = String(fd.get("workerId") || "").trim();
      const name = String(fd.get("name") || "").trim();
      const lavozim = String(fd.get("lavozim") || "").trim();
      const statusEl = document.querySelector("[data-identity-status]");
      if (!workerId && !name) {
        if (statusEl) statusEl.textContent = "Ismingizni tanlang yoki yozing.";
        return;
      }
      try {
        if (statusEl) statusEl.textContent = "";
        const saved = await api("/api/daily/identity", {
          method: "POST",
          body: JSON.stringify({ workerId, name, lavozim }),
        });
        const session = getSession() || {};
        session.workerId = saved.workerId;
        session.label = saved.label || session.label;
        setSession(session);
        if (roleEl) roleEl.textContent = session.label || session.role;
        identityForm.hidden = true;
        await fillTodayLog(session);
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
        else alert(err.message);
      }
    });
  }

  const dailyAddForm = document.querySelector("[data-daily-add-form]");
  if (dailyAddForm) {
    dailyAddForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(dailyAddForm);
      const statusEl = document.querySelector("[data-daily-add-status]");
      const name = String(fd.get("name") || "").trim();
      const lavozim = String(fd.get("lavozim") || "").trim();
      const id = String(fd.get("id") || "").trim();
      if (!name) return;
      try {
        if (statusEl) statusEl.textContent = "Saqlanmoqda...";
        await api("/api/daily/staff", {
          method: "POST",
          body: JSON.stringify({ id, name, lavozim }),
        });
        dailyAddForm.reset();
        if (dailyAddForm.lavozim) dailyAddForm.lavozim.value = "Ishchi";
        const title = document.querySelector("[data-daily-add-title]");
        const submit = document.querySelector("[data-daily-add-submit]");
        const cancel = document.querySelector("[data-daily-add-cancel]");
        if (title) title.textContent = "Ishchi qo‘shish";
        if (submit) submit.textContent = "Qo‘shish";
        if (cancel) cancel.hidden = true;
        if (statusEl) statusEl.textContent = id ? "Saqlandi." : "Qo‘shildi.";
        const session = getSession();
        if (session) await loadDailyRoster(session);
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  const dailyAddCancel = document.querySelector("[data-daily-add-cancel]");
  if (dailyAddCancel && dailyAddForm) {
    dailyAddCancel.addEventListener("click", () => {
      dailyAddForm.reset();
      if (dailyAddForm.lavozim) dailyAddForm.lavozim.value = "Ishchi";
      const title = document.querySelector("[data-daily-add-title]");
      const submit = document.querySelector("[data-daily-add-submit]");
      if (title) title.textContent = "Ishchi qo‘shish";
      if (submit) submit.textContent = "Qo‘shish";
      dailyAddCancel.hidden = true;
      const statusEl = document.querySelector("[data-daily-add-status]");
      if (statusEl) statusEl.textContent = "";
    });
  }

  if (dailyForm) {
    dailyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const statusEl = document.querySelector("[data-daily-status]");
      const text = String(new FormData(dailyForm).get("text") || "").trim();
      const session = getSession() || {};
      try {
        if (statusEl) statusEl.textContent = "Saqlanmoqda...";
        await api("/api/daily/logs", {
          method: "POST",
          body: JSON.stringify({
            workerId: session.workerId,
            date: dailyToday,
            text,
          }),
        });
        if (statusEl) statusEl.textContent = "Bugungi hisobot saqlandi.";
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  boot();
})();

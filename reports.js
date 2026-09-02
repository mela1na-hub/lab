(() => {
  const STORAGE_KEY = "ttati_districts";
  const charts = {
    proctor: null,
    grain: null,
    npk: null,
    texture: null,
    cbr: null,
  };

  const listEl = document.querySelector("[data-district-list]");
  const sheetEl = document.querySelector("[data-report-sheet]");
  const emptyEl = document.querySelector("[data-report-empty]");
  const instituteEl = document.querySelector("[data-report-institute]");
  const printBtn = document.querySelector("[data-print-report]");

  if (!listEl || !sheetEl) return;

  function tx(key, fallback) {
    return typeof window.t === "function" ? window.t(key) : fallback || key;
  }

  let currentDistrict = null;
  let lastDistricts = [];

  const field = (key) => sheetEl.querySelector(`[data-f="${key}"]`);

  function destroyCharts() {
    Object.keys(charts).forEach((key) => {
      if (charts[key]) {
        charts[key].destroy();
        charts[key] = null;
      }
    });
  }

  function mergeDistricts(baseDistricts, overrides) {
    const map = new Map();
    (baseDistricts || []).forEach((d) => map.set(d.id, { ...d }));
    (overrides || []).forEach((d) => {
      if (!d || !d.id) return;
      if (d.deleted) {
        map.delete(d.id);
        return;
      }
      map.set(d.id, { ...(map.get(d.id) || {}), ...d });
    });
    return Array.from(map.values()).sort((a, b) =>
      String(a.name).localeCompare(String(b.name), typeof window.getLang === "function" ? window.getLang() : "uz")
    );
  }

  function readLocalOverrides() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function readFileOverrides() {
    try {
      const res = await fetch("data/district-overrides.json", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.districts) ? data.districts : [];
    } catch {
      return [];
    }
  }

  function setActiveButton(id) {
    listEl.querySelectorAll(".district-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.id === id);
    });
  }

  function renderButtons(districts) {
    listEl.innerHTML = "";
    if (!districts.length) {
      listEl.innerHTML = `<p class="muted-note">${tx("reports.none")}</p>`;
      return;
    }

    districts.forEach((d) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "district-btn";
      btn.dataset.id = d.id;
      btn.textContent = d.name;
      btn.addEventListener("click", () => {
        setActiveButton(d.id);
        renderReport(d);
      });
      listEl.appendChild(btn);
    });
  }

  function chartDefaults() {
    return {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          labels: {
            font: { family: "Sora" },
            color: "#1c241e",
          },
        },
      },
      scales: {
        x: {
          ticks: { font: { family: "Sora" }, color: "#4a564c" },
          grid: { color: "rgba(26,46,31,0.08)" },
        },
        y: {
          ticks: { font: { family: "Sora" }, color: "#4a564c" },
          grid: { color: "rgba(26,46,31,0.08)" },
        },
      },
    };
  }

  function renderReport(d) {
    currentDistrict = d;
    destroyCharts();
    sheetEl.hidden = false;
    if (emptyEl) emptyEl.hidden = true;

    if (instituteEl) {
      instituteEl.textContent = tx("brand.institute");
    }

    const values = {
      name: d.name,
      description: d.description || "—",
      sampleId: d.sampleId || "—",
      date: d.date || "—",
      depth: d.depth || "—",
      uscs: d.uscs || "—",
      mc: d.mc ?? "—",
      ll: d.ll ?? "—",
      pl: d.pl ?? "—",
      pi: d.pi ?? "—",
      fines: d.fines ?? "—",
      ph: d.ph ?? "—",
      organic: d.organic ?? "—",
    };

    Object.entries(values).forEach(([key, val]) => {
      const el = field(key);
      if (el) el.textContent = String(val);
    });

    const fileWrap = sheetEl.querySelector("[data-report-file]");
    if (fileWrap) {
      const file = String(d.file || "").trim();
      if (file) {
        const safe = file
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/"/g, "&quot;");
        const ext = file.split(".").pop().toLowerCase();
        const isImg = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);
        if (isImg) {
          fileWrap.innerHTML = `<img src="${safe}" alt="${String(d.name || tx("nav.reports"))} ${tx("reports.fileAlt")}" />
            <p class="map-link"><a href="${safe}" target="_blank" rel="noopener noreferrer">${tx("reports.openFile")}</a></p>`;
        } else {
          fileWrap.innerHTML = `<iframe src="${safe}" title="${tx("reports.fileTitle")}"></iframe>
            <p class="map-link"><a href="${safe}" target="_blank" rel="noopener noreferrer">${tx("reports.openPdf")}</a></p>`;
        }
        fileWrap.hidden = false;
      } else {
        fileWrap.innerHTML = "";
        fileWrap.hidden = true;
      }
    }

    const soilGreen = "#2f5236";
    const earth = "#a8844f";
    const clay = "#6b4f2f";

    const proctor = d.proctor || {
      moisture: [8, 10, 12, 14, 16, 18],
      density: [1.5, 1.58, 1.65, 1.68, 1.62, 1.54],
    };
    const grain = d.grain || {
      sizes: [20, 10, 4.75, 2, 0.425, 0.075],
      finer: [100, 98, 90, 80, 60, 40],
    };
    const npk = d.npk || { n: 0, p: 0, k: 0 };
    const texture = d.texture || { sand: 40, silt: 35, clay: 25 };
    const cbr = d.cbr || {
      pen: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5],
      stress: [100, 200, 350, 480, 600, 700],
    };

    charts.proctor = new Chart(document.getElementById("chart-proctor"), {
      type: "line",
      data: {
        labels: proctor.moisture,
        datasets: [
          {
            label: tx("chart.density"),
            data: proctor.density,
            borderColor: soilGreen,
            backgroundColor: "rgba(47,82,54,0.15)",
            tension: 0.25,
            fill: false,
            pointRadius: 4,
          },
        ],
      },
      options: {
        ...chartDefaults(),
        scales: {
          ...chartDefaults().scales,
          x: {
            ...chartDefaults().scales.x,
            title: { display: true, text: tx("chart.moisture") },
          },
          y: {
            ...chartDefaults().scales.y,
            title: { display: true, text: tx("chart.densityAxis") },
          },
        },
      },
    });

    charts.grain = new Chart(document.getElementById("chart-grain"), {
      type: "line",
      data: {
        labels: (grain.sizes || []).map((s) => String(s)),
        datasets: [
          {
            label: "% finer",
            data: grain.finer,
            borderColor: earth,
            backgroundColor: "rgba(168,132,79,0.15)",
            tension: 0.2,
            fill: false,
            pointRadius: 4,
          },
        ],
      },
      options: {
        ...chartDefaults(),
        scales: {
          ...chartDefaults().scales,
          x: {
            ...chartDefaults().scales.x,
            title: { display: true, text: tx("chart.size") },
          },
          y: {
            ...chartDefaults().scales.y,
            min: 0,
            max: 100,
            title: { display: true, text: "% finer" },
          },
        },
      },
    });

    charts.npk = new Chart(document.getElementById("chart-npk"), {
      type: "bar",
      data: {
        labels: ["N", "P", "K"],
        datasets: [
          {
            label: "mg/kg",
            data: [npk.n, npk.p, npk.k],
            backgroundColor: [soilGreen, earth, clay],
          },
        ],
      },
      options: chartDefaults(),
    });

    charts.texture = new Chart(document.getElementById("chart-texture"), {
      type: "doughnut",
      data: {
        labels: [tx("chart.sand"), tx("chart.silt"), tx("chart.clay")],
        datasets: [
          {
            data: [texture.sand, texture.silt, texture.clay],
            backgroundColor: [earth, "#c4b28a", clay],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: "bottom",
            labels: { font: { family: "Sora" } },
          },
        },
      },
    });

    charts.cbr = new Chart(document.getElementById("chart-cbr"), {
      type: "line",
      data: {
        labels: cbr.pen,
        datasets: [
          {
            label: tx("chart.stress"),
            data: cbr.stress,
            borderColor: clay,
            backgroundColor: "rgba(107,79,47,0.12)",
            tension: 0.2,
            fill: false,
            pointRadius: 4,
          },
        ],
      },
      options: {
        ...chartDefaults(),
        scales: {
          ...chartDefaults().scales,
          x: {
            ...chartDefaults().scales.x,
            title: { display: true, text: tx("chart.pen") },
          },
          y: {
            ...chartDefaults().scales.y,
            title: { display: true, text: tx("chart.stressAxis") },
          },
        },
      },
    });
  }

  if (printBtn) {
    printBtn.addEventListener("click", () => window.print());
  }

  async function init() {
    try {
      const res = await fetch("data/districts.json", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Yuklash xatosi");
      const data = await res.json();
      const districts = mergeDistricts(
        data.districts || [],
        await readFileOverrides()
      );
      lastDistricts = districts;
      renderButtons(districts);
      if (districts[0]) {
        setActiveButton(districts[0].id);
        renderReport(districts[0]);
      }
    } catch (err) {
      listEl.innerHTML = `<p class="muted-note">${tx("reports.loadFail")}</p>`;
      console.error(err);
    }
  }

  let started = false;
  window.initReports = function initReports() {
    if (started) return;
    started = true;
    init();
  };

  if (!document.body.hasAttribute("data-require-auth")) {
    window.initReports();
  }

  window.addEventListener("ttati:lang", () => {
    if (lastDistricts.length) renderButtons(lastDistricts);
    if (currentDistrict) {
      if (currentDistrict.id) setActiveButton(currentDistrict.id);
      renderReport(currentDistrict);
    }
  });
})();

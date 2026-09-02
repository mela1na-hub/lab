(() => {
  const loginPanel = document.querySelector("[data-login-panel]");
  const reportsApp = document.querySelector("[data-reports-app]");
  const loginForm = document.querySelector("[data-login-form]");
  const loginError = document.querySelector("[data-login-error]");
  const logoutBtn = document.querySelector("[data-logout]");
  const roleEl = document.querySelector("[data-session-role]");
  const directorLink = document.querySelector("[data-director-link]");

  function tx(key, fallback) {
    return typeof window.t === "function" ? window.t(key) : fallback || key;
  }

  function roleText(session) {
    if (!session) return "";
    if (session.role === "director") return tx("role.director");
    if (session.role === "worker") return tx("role.worker");
    return session.label || session.role || "";
  }

  let lastSession = null;

  if (!loginPanel || !reportsApp) return;

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
      throw new Error(data.error || `${tx("auth.error")} (${res.status})`);
    }
    return data;
  }

  function showReports(session) {
    lastSession = session;
    loginPanel.hidden = true;
    reportsApp.hidden = false;
    if (logoutBtn) logoutBtn.hidden = false;
    if (roleEl) roleEl.textContent = roleText(session);
    if (directorLink) directorLink.hidden = session.role !== "director";
    if (typeof window.initReports === "function") window.initReports();
  }

  function showLogin() {
    loginPanel.hidden = false;
    reportsApp.hidden = true;
    if (logoutBtn) logoutBtn.hidden = true;
    if (directorLink) directorLink.hidden = true;
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(loginForm);
      try {
        if (loginError) loginError.hidden = true;
        const session = await api("/api/login", {
          method: "POST",
          body: JSON.stringify({
            username: String(fd.get("username") || "").trim(),
            password: String(fd.get("password") || ""),
          }),
        });
        loginForm.reset();
        showReports(session);
      } catch (err) {
        if (loginError) {
          loginError.hidden = false;
          loginError.textContent = err.message || tx("auth.badCreds");
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
      showLogin();
    });
  }

  (async () => {
    try {
      const me = await api("/api/me");
      if (me.role) showReports(me);
      else showLogin();
    } catch {
      showLogin();
    }
  })();

  window.addEventListener("ttati:lang", () => {
    if (lastSession && roleEl && !reportsApp.hidden) {
      roleEl.textContent = roleText(lastSession);
    }
  });
})();

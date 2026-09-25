(() => {
  const stage = document.getElementById("hero-stage");
  if (!stage) return;

  const svg = stage.querySelector("svg");
  const mqMobile = window.matchMedia("(max-width: 720px)");
  const REPLAY_EVERY_MS = 3 * 60 * 1000;

  function syncViewport() {
    const mobile = mqMobile.matches;
    document.body.classList.toggle("hero-is-mobile", mobile);
    if (svg) {
      // Mobile: to‘liq sahna (meet). Desktop: viewportni to‘ldirish (slice).
      svg.setAttribute(
        "preserveAspectRatio",
        mobile ? "xMidYMid meet" : "xMidYMid slice"
      );
    }
  }

  function play() {
    stage.classList.remove("play");
    void stage.offsetWidth;
    stage.classList.add("play");
  }

  syncViewport();
  if (typeof mqMobile.addEventListener === "function") {
    mqMobile.addEventListener("change", syncViewport);
  } else if (typeof mqMobile.addListener === "function") {
    mqMobile.addListener(syncViewport);
  }

  play();
  setInterval(play, REPLAY_EVERY_MS);

  if (!document.body.classList.contains("has-hero-autohide")) return;

  const SHOW_AFTER = 56;
  let ticking = false;

  function syncHeader() {
    ticking = false;
    document.body.classList.toggle("is-header-shown", window.scrollY > SHOW_AFTER);
  }

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(syncHeader);
    },
    { passive: true }
  );

  syncHeader();
})();

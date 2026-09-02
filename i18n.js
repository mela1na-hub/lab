(() => {
  const KEY = "ttati_lang";
  const LANGS = [
    { id: "uz", label: "O‘Z", html: "uz" },
    { id: "ru", label: "РУ", html: "ru" },
    { id: "en", label: "EN", html: "en" },
  ];

  const I18N = {
    uz: {
      "meta.title":
        "Tuproqshunoslik va agrokimyoviy tadqiqotlar instituti — Qashqadaryo bo‘linmasi",
      "meta.desc":
        "Qashqadaryo viloyati tuproq tahlili, agrokimyoviy tadqiqotlar va laborator hisobotlar.",
      "meta.reports": "Hisobotlar",
      "brand.institute":
        "Tuproqshunoslik va agrokimyoviy tadqiqotlar instituti",
      "brand.branch": "Qashqadaryo bo‘linmasi",
      "nav.menu": "Menyu",
      "nav.home": "Bosh sahifa",
      "nav.about": "Haqida",
      "nav.reports": "Hisobotlar",
      "nav.gallery": "Galereya",
      "nav.staff": "Rahbariyat",
      "nav.contact": "Aloqa",
      "nav.appeal": "Murojaat",
      "nav.back": "Saytga qaytish",
      "hero.h1": "Viloyat tuproq tahlili — laborator aniqlik bilan",
      "hero.lead":
        "Qashqadaryo shahar va tumanlaridan olingan namunalarni agrokimyoviy va mexanik tahlil qilamiz, amaliy tavsiyalar tayyorlaymiz.",
      "hero.contact": "Bog‘lanish",
      "about.eyebrow": "Haqida",
      "about.h2": "Bo‘linma haqida",
      "about.p1":
        "Qishloq xo‘jaligi vazirligi tizimidagi Tuproqshunoslik va agrokimyoviy tadqiqotlar institutining Qashqadaryo mintaqaviy bo‘linmasi. Viloyatdagi shahar va tumanlardan olingan tuproq namunalarini tahlil qiladi, agrokimyoviy kartogrammalar va amaliy tavsiyalar tayyorlaydi. Manzil: ",
      "about.p2": " (VMQ-389, 19.07.2022).",
      "services.eyebrow": "Xizmatlar",
      "services.h2": "Laboratoriya xizmatlari",
      "services.intro":
        "Asosiy tahlil yo‘nalishlari — dala va laborator natijalar asosida.",
      "services.agro.h": "Agrokimyoviy tahlil",
      "services.agro.p": "N-P-K, pH, organik modda va ozuqa rejimini baholash.",
      "services.grain.h": "Granulometrik tarkib",
      "services.grain.p": "Qum, chang va loy ulushlari; USCS klassifikatsiyasi.",
      "services.proctor.h": "Proctor va CBR",
      "services.proctor.p":
        "Optimal namlik, maksimal zichlik va yuk ko‘tarish ko‘rsatkichlari.",
      "services.report.h": "Hisobot va tavsiyalar",
      "services.report.p":
        "Tuman/shahar kesimida laborator hisobotlar va amaliy yo‘riqnoma.",
      "gallery.eyebrow": "Galereya",
      "gallery.h2": "Rasmlar va videolar",
      "gallery.intro": "Laboratoriya, dala ishlari va tadbirlar.",
      "gallery.all": "Barchasi",
      "gallery.photos": "Rasmlar",
      "gallery.videos": "Videolar",
      "gallery.loading": "Yuklanmoqda...",
      "gallery.empty":
        "Hozircha material yo‘q. Admin panel orqali rasm yoki video qo‘shiladi.",
      "gallery.error":
        "Galereyani yuklab bo‘lmadi. Saytni OCHISH.bat orqali oching.",
      "gallery.item": "Material",
      "staff.eyebrow": "Rahbariyat",
      "staff.h2": "Direktor va ishchilar",
      "staff.loading": "Yuklanmoqda...",
      "staff.missing":
        "Ma’lumot topilmadi. Saytni OCHISH.bat orqali oching.",
      "staff.error":
        "Rahbariyatni yuklab bo‘lmadi. Saytni OCHISH.bat orqali oching.",
      "staff.director": "Direktor",
      "staff.worker": "Ishchi",
      "staff.workers": "Ishchilar",
      "staff.teamTitle": "Laborant va mutaxassislar",
      "staff.teamText":
        "Namuna olish, laborator tahlil va hisobot tayyorlash bo‘yicha ishchi guruhi.",
      "staff.teamNote": "Ishchilar ro‘yxati admin panelda saqlanadi.",
      "staff.dirFallback": "Bo‘linma direktori",
      "staff.dirBio": "Qashqadaryo bo‘linmasi rahbariyati.",
      "videos.eyebrow": "Videolar",
      "videos.h2": "O‘quv materiallari",
      "videos.intro":
        "Tuproqshunoslik va agrokimyo bo‘yicha tanlangan videolar.",
      "videos.soil": "Tuproq qanday hosil bo‘ladi",
      "videos.soilNote": "Tuproq shakllanishi va qatlamlari",
      "videos.roots": "O‘simlik ildizi va tuproq",
      "videos.rootsNote": "Ildizdan barggacha suv va ozuqa",
      "videos.n": "Azot aylanishi",
      "videos.nNote": "Agrokimyo — ozuqa elementlari",
      "contact.eyebrow": "Aloqa",
      "contact.h2": "Bog‘lanish",
      "contact.intro1":
        "Telefon, email va manzil. Savol yoki buyurtma uchun ",
      "contact.introLink": "murojaat formasini",
      "contact.intro2": " to‘ldiring.",
      "contact.phone": "Telefon",
      "contact.email": "Email",
      "contact.address": "Manzil",
      "contact.mapSee": "Xaritada ko‘rish",
      "map.eyebrow": "Manzil",
      "map.title": "Qarshi — bo‘linma manzili",
      "map.open": "Google Maps’da ochish",
      "appeal.eyebrow": "Murojaat",
      "appeal.h2": "Murojaat qoldiring",
      "appeal.intro": "Savol yoki buyurtma uchun formani to‘ldiring.",
      "appeal.name": "Ism",
      "appeal.contact": "Telefon yoki email",
      "appeal.message": "Xabar",
      "appeal.send": "Yuborish",
      "appeal.thanks":
        "Rahmat. Murojaatingiz qabul qilindi (demo: serverga yuborilmaydi). Telefon yoki email orqali bog‘lanamiz.",
      "footer.copy": "Barcha huquqlar himoyalangan.",
      "lang.label": "Til",
      "auth.login": "Login",
      "auth.password": "Parol",
      "auth.enter": "Kirish",
      "auth.logout": "Chiqish",
      "auth.reportsNote": "Faqat ruxsat berilgan xodimlar ko‘ra oladi.",
      "auth.badCreds": "Login yoki parol noto‘g‘ri.",
      "auth.error": "Xato",
      "reports.h1": "Tuman va shahar laborator hisobotlari",
      "reports.you": "Siz:",
      "reports.admin": "Boshqaruv",
      "reports.print": "Chop etish",
      "reports.pick": "Hududni tanlang",
      "reports.loading": "Ma’lumotlar yuklanmoqda…",
      "reports.empty": "Hisobotni ko‘rish uchun yuqoridan hududni tanlang.",
      "reports.branchLine": "Qashqadaryo bo‘linmasi — laborator hisobot",
      "reports.sample": "Namuna ID",
      "reports.date": "Sana",
      "reports.depth": "Chuqurlik",
      "reports.fileAlt": "hisobot fayli",
      "reports.openFile": "Hisobot faylini ochish",
      "reports.openPdf": "Hisobotni ochish / yuklab olish",
      "reports.fileTitle": "Hisobot fayli",
      "reports.none": "Hududlar topilmadi.",
      "reports.loadFail":
        "Ma’lumotlarni yuklab bo‘lmadi. Sahifani lokal server orqali oching.",
      "chart.proctor": "Proctor (namlik — zichlik)",
      "chart.grain": "Granulometriya (% finer)",
      "chart.npk": "NPK",
      "chart.texture": "Tekstura (qum / chang / loy)",
      "chart.cbr": "CBR (stress — penetratsiya)",
      "chart.density": "Zichlik (g/cm³)",
      "chart.moisture": "Namlik %",
      "chart.densityAxis": "Zichlik",
      "chart.size": "O‘lcham (mm)",
      "chart.sand": "Qum",
      "chart.silt": "Chang",
      "chart.clay": "Loy",
      "chart.stress": "Stress (kPa)",
      "chart.pen": "Penetratsiya (in)",
      "chart.stressAxis": "Stress",
      "role.director": "Direktor",
      "role.worker": "Ishchi",
    },
    ru: {
      "meta.title":
        "Институт почвоведения и агрохимических исследований — Кашкадарьинское отделение",
      "meta.desc":
        "Анализ почв Кашкадарьинской области, агрохимические исследования и лабораторные отчёты.",
      "meta.reports": "Отчёты",
      "brand.institute":
        "Институт почвоведения и агрохимических исследований",
      "brand.branch": "Кашкадарьинское отделение",
      "nav.menu": "Меню",
      "nav.home": "Главная",
      "nav.about": "О нас",
      "nav.reports": "Отчёты",
      "nav.gallery": "Галерея",
      "nav.staff": "Руководство",
      "nav.contact": "Контакты",
      "nav.appeal": "Обращение",
      "nav.back": "На сайт",
      "hero.h1": "Анализ почв области — с лабораторной точностью",
      "hero.lead":
        "Проводим агрохимический и механический анализ проб из городов и районов Кашкадарьи, готовим практические рекомендации.",
      "hero.contact": "Связаться",
      "about.eyebrow": "О нас",
      "about.h2": "Об отделении",
      "about.p1":
        "Кашкадарьинское региональное отделение Института почвоведения и агрохимических исследований в системе Министерства сельского хозяйства. Анализирует почвенные пробы городов и районов области, готовит агрохимические картограммы и практические рекомендации. Адрес: ",
      "about.p2": " (ВМК-389, 19.07.2022).",
      "services.eyebrow": "Услуги",
      "services.h2": "Лабораторные услуги",
      "services.intro":
        "Основные направления анализа — по полевым и лабораторным результатам.",
      "services.agro.h": "Агрохимический анализ",
      "services.agro.p": "Оценка N-P-K, pH, органического вещества и режима питания.",
      "services.grain.h": "Гранулометрический состав",
      "services.grain.p": "Доли песка, пыли и глины; классификация USCS.",
      "services.proctor.h": "Проктор и CBR",
      "services.proctor.p":
        "Оптимальная влажность, максимальная плотность и несущая способность.",
      "services.report.h": "Отчёты и рекомендации",
      "services.report.p":
        "Лабораторные отчёты и практические указания по районам и городам.",
      "gallery.eyebrow": "Галерея",
      "gallery.h2": "Фото и видео",
      "gallery.intro": "Лаборатория, полевые работы и мероприятия.",
      "gallery.all": "Все",
      "gallery.photos": "Фото",
      "gallery.videos": "Видео",
      "gallery.loading": "Загрузка...",
      "gallery.empty":
        "Пока нет материалов. Фото или видео добавляются через панель администратора.",
      "gallery.error":
        "Не удалось загрузить галерею. Откройте сайт через OCHISH.bat.",
      "gallery.item": "Материал",
      "staff.eyebrow": "Руководство",
      "staff.h2": "Директор и сотрудники",
      "staff.loading": "Загрузка...",
      "staff.missing":
        "Данные не найдены. Откройте сайт через OCHISH.bat.",
      "staff.error":
        "Не удалось загрузить руководство. Откройте сайт через OCHISH.bat.",
      "staff.director": "Директор",
      "staff.worker": "Сотрудник",
      "staff.workers": "Сотрудники",
      "staff.teamTitle": "Лаборанты и специалисты",
      "staff.teamText":
        "Рабочая группа по отбору проб, лабораторному анализу и подготовке отчётов.",
      "staff.teamNote": "Список сотрудников хранится в панели администратора.",
      "staff.dirFallback": "Директор отделения",
      "staff.dirBio": "Руководство Кашкадарьинского отделения.",
      "videos.eyebrow": "Видео",
      "videos.h2": "Учебные материалы",
      "videos.intro":
        "Подборка видео по почвоведению и агрохимии.",
      "videos.soil": "Как образуется почва",
      "videos.soilNote": "Формирование почвы и её слои",
      "videos.roots": "Корни растений и почва",
      "videos.rootsNote": "Вода и питание от корня до листа",
      "videos.n": "Круговорот азота",
      "videos.nNote": "Агрохимия — элементы питания",
      "contact.eyebrow": "Контакты",
      "contact.h2": "Связаться",
      "contact.intro1":
        "Телефон, email и адрес. Для вопроса или заявки заполните ",
      "contact.introLink": "форму обращения",
      "contact.intro2": ".",
      "contact.phone": "Телефон",
      "contact.email": "Email",
      "contact.address": "Адрес",
      "contact.mapSee": "Посмотреть на карте",
      "map.eyebrow": "Адрес",
      "map.title": "Карши — адрес отделения",
      "map.open": "Открыть в Google Maps",
      "appeal.eyebrow": "Обращение",
      "appeal.h2": "Оставьте обращение",
      "appeal.intro": "Заполните форму для вопроса или заявки.",
      "appeal.name": "Имя",
      "appeal.contact": "Телефон или email",
      "appeal.message": "Сообщение",
      "appeal.send": "Отправить",
      "appeal.thanks":
        "Спасибо. Обращение принято (демо: на сервер не отправляется). Свяжемся по телефону или email.",
      "footer.copy": "Все права защищены.",
      "lang.label": "Язык",
      "auth.login": "Логин",
      "auth.password": "Пароль",
      "auth.enter": "Войти",
      "auth.logout": "Выйти",
      "auth.reportsNote": "Доступно только уполномоченным сотрудникам.",
      "auth.badCreds": "Неверный логин или пароль.",
      "auth.error": "Ошибка",
      "reports.h1": "Лабораторные отчёты районов и городов",
      "reports.you": "Вы:",
      "reports.admin": "Управление",
      "reports.print": "Печать",
      "reports.pick": "Выберите территорию",
      "reports.loading": "Данные загружаются…",
      "reports.empty": "Выберите территорию выше, чтобы открыть отчёт.",
      "reports.branchLine":
        "Кашкадарьинское отделение — лабораторный отчёт",
      "reports.sample": "ID образца",
      "reports.date": "Дата",
      "reports.depth": "Глубина",
      "reports.fileAlt": "файл отчёта",
      "reports.openFile": "Открыть файл отчёта",
      "reports.openPdf": "Открыть / скачать отчёт",
      "reports.fileTitle": "Файл отчёта",
      "reports.none": "Территории не найдены.",
      "reports.loadFail":
        "Не удалось загрузить данные. Откройте страницу через локальный сервер.",
      "chart.proctor": "Проктор (влажность — плотность)",
      "chart.grain": "Гранулометрия (% finer)",
      "chart.npk": "NPK",
      "chart.texture": "Текстура (песок / пыль / глина)",
      "chart.cbr": "CBR (напряжение — пенетрация)",
      "chart.density": "Плотность (г/см³)",
      "chart.moisture": "Влажность %",
      "chart.densityAxis": "Плотность",
      "chart.size": "Размер (мм)",
      "chart.sand": "Песок",
      "chart.silt": "Пыль",
      "chart.clay": "Глина",
      "chart.stress": "Напряжение (кПа)",
      "chart.pen": "Пенетрация (in)",
      "chart.stressAxis": "Напряжение",
      "role.director": "Директор",
      "role.worker": "Сотрудник",
    },
    en: {
      "meta.title":
        "Institute of Soil Science and Agrochemical Research — Kashkadarya branch",
      "meta.desc":
        "Soil analysis, agrochemical research and laboratory reports for Kashkadarya region.",
      "meta.reports": "Reports",
      "brand.institute":
        "Institute of Soil Science and Agrochemical Research",
      "brand.branch": "Kashkadarya branch",
      "nav.menu": "Menu",
      "nav.home": "Home",
      "nav.about": "About",
      "nav.reports": "Reports",
      "nav.gallery": "Gallery",
      "nav.staff": "Leadership",
      "nav.contact": "Contact",
      "nav.appeal": "Inquiry",
      "nav.back": "Back to site",
      "hero.h1": "Regional soil analysis — with laboratory precision",
      "hero.lead":
        "We run agrochemical and mechanical tests on samples from Kashkadarya cities and districts, and prepare practical recommendations.",
      "hero.contact": "Get in touch",
      "about.eyebrow": "About",
      "about.h2": "About the branch",
      "about.p1":
        "The Kashkadarya regional branch of the Institute of Soil Science and Agrochemical Research under the Ministry of Agriculture. It analyses soil samples from the region’s cities and districts, and prepares agrochemical cartograms and practical recommendations. Address: ",
      "about.p2": " (CMQ-389, 19.07.2022).",
      "services.eyebrow": "Services",
      "services.h2": "Laboratory services",
      "services.intro":
        "Core analysis areas — based on field and laboratory results.",
      "services.agro.h": "Agrochemical analysis",
      "services.agro.p": "Assessment of N-P-K, pH, organic matter and nutrient status.",
      "services.grain.h": "Particle-size composition",
      "services.grain.p": "Sand, silt and clay fractions; USCS classification.",
      "services.proctor.h": "Proctor and CBR",
      "services.proctor.p":
        "Optimum moisture, maximum density and bearing capacity.",
      "services.report.h": "Reports and advice",
      "services.report.p":
        "Laboratory reports and practical guidance by district and city.",
      "gallery.eyebrow": "Gallery",
      "gallery.h2": "Photos and videos",
      "gallery.intro": "The laboratory, fieldwork and events.",
      "gallery.all": "All",
      "gallery.photos": "Photos",
      "gallery.videos": "Videos",
      "gallery.loading": "Loading...",
      "gallery.empty":
        "No media yet. Photos or videos are added from the admin panel.",
      "gallery.error":
        "Could not load the gallery. Open the site with OCHISH.bat.",
      "gallery.item": "Item",
      "staff.eyebrow": "Leadership",
      "staff.h2": "Director and staff",
      "staff.loading": "Loading...",
      "staff.missing":
        "Data not found. Open the site with OCHISH.bat.",
      "staff.error":
        "Could not load leadership. Open the site with OCHISH.bat.",
      "staff.director": "Director",
      "staff.worker": "Staff member",
      "staff.workers": "Staff",
      "staff.teamTitle": "Lab technicians and specialists",
      "staff.teamText":
        "The team for sampling, laboratory analysis and report preparation.",
      "staff.teamNote": "The staff list is stored in the admin panel.",
      "staff.dirFallback": "Branch director",
      "staff.dirBio": "Leadership of the Kashkadarya branch.",
      "videos.eyebrow": "Videos",
      "videos.h2": "Learning materials",
      "videos.intro": "Selected videos on soil science and agrochemistry.",
      "videos.soil": "How soil is formed",
      "videos.soilNote": "Soil formation and layers",
      "videos.roots": "Plant roots and soil",
      "videos.rootsNote": "Water and nutrients from root to leaf",
      "videos.n": "The nitrogen cycle",
      "videos.nNote": "Agrochemistry — nutrient elements",
      "contact.eyebrow": "Contact",
      "contact.h2": "Get in touch",
      "contact.intro1":
        "Phone, email and address. For a question or order, fill in the ",
      "contact.introLink": "inquiry form",
      "contact.intro2": ".",
      "contact.phone": "Phone",
      "contact.email": "Email",
      "contact.address": "Address",
      "contact.mapSee": "View on map",
      "map.eyebrow": "Location",
      "map.title": "Karshi — branch address",
      "map.open": "Open in Google Maps",
      "appeal.eyebrow": "Inquiry",
      "appeal.h2": "Leave an inquiry",
      "appeal.intro": "Fill in the form for a question or order.",
      "appeal.name": "Name",
      "appeal.contact": "Phone or email",
      "appeal.message": "Message",
      "appeal.send": "Send",
      "appeal.thanks":
        "Thank you. Your inquiry was received (demo: it is not sent to a server). We will contact you by phone or email.",
      "footer.copy": "All rights reserved.",
      "lang.label": "Language",
      "auth.login": "Username",
      "auth.password": "Password",
      "auth.enter": "Sign in",
      "auth.logout": "Sign out",
      "auth.reportsNote": "Only authorised staff can view this.",
      "auth.badCreds": "Incorrect username or password.",
      "auth.error": "Error",
      "reports.h1": "District and city laboratory reports",
      "reports.you": "You:",
      "reports.admin": "Admin",
      "reports.print": "Print",
      "reports.pick": "Select an area",
      "reports.loading": "Loading data…",
      "reports.empty": "Select an area above to view a report.",
      "reports.branchLine": "Kashkadarya branch — laboratory report",
      "reports.sample": "Sample ID",
      "reports.date": "Date",
      "reports.depth": "Depth",
      "reports.fileAlt": "report file",
      "reports.openFile": "Open report file",
      "reports.openPdf": "Open / download report",
      "reports.fileTitle": "Report file",
      "reports.none": "No areas found.",
      "reports.loadFail":
        "Could not load data. Open the page through the local server.",
      "chart.proctor": "Proctor (moisture — density)",
      "chart.grain": "Grain size (% finer)",
      "chart.npk": "NPK",
      "chart.texture": "Texture (sand / silt / clay)",
      "chart.cbr": "CBR (stress — penetration)",
      "chart.density": "Density (g/cm³)",
      "chart.moisture": "Moisture %",
      "chart.densityAxis": "Density",
      "chart.size": "Size (mm)",
      "chart.sand": "Sand",
      "chart.silt": "Silt",
      "chart.clay": "Clay",
      "chart.stress": "Stress (kPa)",
      "chart.pen": "Penetration (in)",
      "chart.stressAxis": "Stress",
      "role.director": "Director",
      "role.worker": "Staff",
    },
  };

  function getLang() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && I18N[saved]) return saved;
    } catch {
      /* ignore */
    }
    return "uz";
  }

  function setLang(lang) {
    const next = I18N[lang] ? lang : "uz";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
    applyI18n();
  }

  function t(key) {
    const lang = getLang();
    return (I18N[lang] && I18N[lang][key]) || I18N.uz[key] || key;
  }

  function applyI18n() {
    const lang = getLang();
    const meta = LANGS.find((item) => item.id === lang) || LANGS[0];
    document.documentElement.lang = meta.html;

    const titleEl = document.querySelector("title");
    if (titleEl) {
      if (document.body && document.body.classList.contains("page-reports")) {
        titleEl.textContent = t("meta.reports");
      } else if (
        !document.body ||
        !document.body.classList.contains("page-admin")
      ) {
        titleEl.textContent = t("meta.title");
      }
    }

    const desc = document.querySelector('meta[name="description"]');
    if (desc && desc.getAttribute("content")) {
      desc.setAttribute("content", t("meta.desc"));
    }

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key) el.textContent = t(key);
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (key) el.setAttribute("title", t(key));
    });

    document.querySelectorAll("[data-lang-switch]").forEach((root) => {
      root.querySelectorAll("button[data-lang]").forEach((btn) => {
        const active = btn.getAttribute("data-lang") === lang;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      });
    });

    window.dispatchEvent(new CustomEvent("ttati:lang", { detail: { lang } }));
  }

  function renderSwitchers() {
    document.querySelectorAll("[data-lang-switch]").forEach((root) => {
      root.setAttribute("role", "group");
      root.setAttribute("aria-label", t("lang.label"));
      root.innerHTML = LANGS.map(
        (item) =>
          `<button type="button" data-lang="${item.id}" aria-pressed="false">${item.label}</button>`
      ).join("");
      root.querySelectorAll("button[data-lang]").forEach((btn) => {
        btn.addEventListener("click", () => {
          setLang(btn.getAttribute("data-lang"));
        });
      });
    });
  }

  window.t = t;
  window.getLang = getLang;
  window.setLang = setLang;
  window.applyI18n = applyI18n;

  renderSwitchers();
  applyI18n();
})();

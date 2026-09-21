"use strict";

const expected = "127";
if (process.versions.modules !== expected) {
  console.error(
    "Bu loyiha Node 22 talab qiladi (NODE_MODULE_VERSION 127). Hozir:",
    process.version,
    "modules=" + process.versions.modules
  );
  console.error("Ishlating: /opt/node22/bin/npm");
  process.exit(1);
}

if (process.argv.includes("--sqlite")) {
  try {
    require("better-sqlite3");
  } catch (err) {
    console.error(
      "better-sqlite3 Node 22 bilan mos emas. Qayta yig‘ing:",
      "/opt/node22/bin/npm rebuild better-sqlite3 --build-from-source"
    );
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }
}

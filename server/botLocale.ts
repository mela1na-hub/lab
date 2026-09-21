import { telegram } from "./telegram.js";

const NAME = "Qashqadaryo Tuproq Lab";
const SHORT =
  "Qashqadaryo tuproq laboratoriyasi. E’lonlar va xodimlar uchun rasmiy bot.";
const DESCRIPTION =
  "Qashqadaryo Tuproqshunoslik va agrokimyoviy tadqiqotlar instituti — Qashqadaryo bo‘linmasi rasmiy boti.\n\nIshchilar /start bosib ulanadi. Admin e’lon yuborishi mumkin.";

const COMMANDS = [
  { command: "start", description: "Botni ishga tushirish" },
  { command: "help", description: "Yordam" },
  { command: "elon", description: "E’lon yuborish" },
];

function locales() {
  return [{}, { language_code: "uz" }];
}

export async function applyUzbekBotProfile(token: string) {
  if (!token) return;
  for (const extra of locales()) {
    await telegram(token, "setMyName", "", { name: NAME, ...extra });
    await telegram(token, "setMyShortDescription", "", {
      short_description: SHORT,
      ...extra,
    });
    await telegram(token, "setMyDescription", "", { description: DESCRIPTION, ...extra });
    await telegram(token, "setMyCommands", "", { commands: COMMANDS, ...extra });
  }
}

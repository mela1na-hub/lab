import { migrate, closeDb } from "./db.js";

await migrate();
closeDb();
console.log("Migrations applied.");

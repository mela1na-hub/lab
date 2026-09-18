import { migrate } from "./db.js";
import { pool } from "./db.js";

await migrate();
await pool.end();
console.log("Migrations applied.");

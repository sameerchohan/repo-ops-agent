import { initSchema, pool } from "./db.js";

initSchema()
  .then(() => pool.end())
  .catch(console.error);
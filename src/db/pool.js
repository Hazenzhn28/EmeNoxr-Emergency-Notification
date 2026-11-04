const path = require("node:path");
const fs = require("node:fs");
const { Pool } = require("pg");
const { databaseUrl, databaseSslCaPath } = require("../config/env");

// node-pg treats ?sslmode=... in the URL as an override of the ssl object below.
// Remove it so our explicit, strict SSL settings are always the ones used.
const connectionUrl = new URL(databaseUrl);
connectionUrl.searchParams.delete("sslmode");

const ssl = { rejectUnauthorized: true };
if (databaseSslCaPath) {
  ssl.ca = fs.readFileSync(path.resolve(databaseSslCaPath), "utf8");
}

const pool = new Pool({
  connectionString: connectionUrl.toString(),
  ssl
});

pool.on("error", error => {
  console.error(
    "Unexpected PostgreSQL pool error:",
    error.name || "UnknownError",
    error.code || ""
  );
});

module.exports = { pool };
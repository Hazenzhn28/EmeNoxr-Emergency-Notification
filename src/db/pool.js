const path = require("node:path");
const fs = require("node:fs");
const { Pool } = require("pg");
const { databaseUrl, databaseSslCa } = require("../config/env");

// node-pg treats ?sslmode=... in the URL as an override of the ssl object below.
// Remove it so our explicit, strict SSL settings are always the ones used.
const connectionUrl = new URL(databaseUrl);
connectionUrl.searchParams.delete("sslmode");

const ssl = { rejectUnauthorized: true };
if (databaseSslCa) {
  ssl.ca = databaseSslCa.includes("-----BEGIN CERTIFICATE-----")
    ? databaseSslCa
    : fs.readFileSync(path.resolve(databaseSslCa), "utf8");
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
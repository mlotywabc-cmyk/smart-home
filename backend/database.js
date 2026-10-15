
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sensor_readings (
        id BIGSERIAL PRIMARY KEY,
        temperature DOUBLE PRECISION,
        humidity DOUBLE PRECISION,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS access_events (
        id BIGSERIAL PRIMARY KEY,
        card_uid VARCHAR(100),
        event_type VARCHAR(100) NOT NULL,
        access_granted BOOLEAN,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS device_status (
        id BIGSERIAL PRIMARY KEY,
        device_name VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    console.log("Database tables created successfully.");
  } catch (error) {
    console.error("Could not create tables:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

createTables();

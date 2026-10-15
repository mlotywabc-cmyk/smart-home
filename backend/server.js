
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

// Check that the API is running
app.get("/", (req, res) => {
  res.json({ message: "Smart Home API is running" });
});

// Check the database connection
app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS server_time");
    res.json({
      status: "connected",
      databaseTime: result.rows[0].server_time
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ status: "error" });
  }
});

// Receive temperature and humidity from the ESP32
app.post("/api/sensors", async (req, res) => {
  try {
    const { temperature, humidity } = req.body;

    if (
      (temperature != null && !Number.isFinite(temperature)) ||
      (humidity != null && !Number.isFinite(humidity)) ||
      (temperature == null && humidity == null)
    ) {
      return res.status(400).json({
        error: "Provide a valid temperature or humidity reading."
      });
    }

    const result = await pool.query(
      `INSERT INTO sensor_readings (temperature, humidity)
       VALUES ($1, $2)
       RETURNING *`,
      [temperature ?? null, humidity ?? null]
    );

    res.status(201).json({
      message: "Sensor reading saved",
      reading: result.rows[0]
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Could not save sensor reading" });
  }
});

// Get the latest sensor readings
app.get("/api/sensors/latest", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM sensor_readings
       ORDER BY recorded_at DESC
       LIMIT 1`
    );

    res.json(result.rows[0] ?? null);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Could not load sensor reading" });
  }
});

// Get sensor history
app.get("/api/sensors", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM sensor_readings
       ORDER BY recorded_at DESC
       LIMIT 100`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Could not load sensor history" });
  }
});

// Receive RFID and door events
app.post("/api/access-events", async (req, res) => {
  try {
    const { card_uid, event_type, access_granted } = req.body;

    if (typeof event_type !== "string" || !event_type.trim()) {
      return res.status(400).json({
        error: "event_type is required"
      });
    }

    if (
      access_granted != null &&
      typeof access_granted !== "boolean"
    ) {
      return res.status(400).json({
        error: "access_granted must be true or false"
      });
    }

    const result = await pool.query(
      `INSERT INTO access_events
       (card_uid, event_type, access_granted)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [card_uid ?? null, event_type.trim(), access_granted ?? null]
    );

    res.status(201).json({
      message: "Access event saved",
      event: result.rows[0]
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Could not save access event" });
  }
});

// Get access event history
app.get("/api/access-events", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM access_events
       ORDER BY recorded_at DESC
       LIMIT 100`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Could not load access events" });
  }
});

// Save a device status
app.post("/api/devices", async (req, res) => {
  try {
    const { device_name, status } = req.body;

    if (
      typeof device_name !== "string" || !device_name.trim() ||
      typeof status !== "string" || !status.trim()
    ) {
      return res.status(400).json({
        error: "device_name and status are required"
      });
    }

    const result = await pool.query(
      `INSERT INTO device_status (device_name, status)
       VALUES ($1, $2)
       RETURNING *`,
      [device_name.trim(), status.trim()]
    );

    res.status(201).json({
      message: "Device status saved",
      device: result.rows[0]
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Could not save device status" });
  }
});

// Get latest status for each device
app.get("/api/devices", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (device_name)
        id, device_name, status, recorded_at
      FROM device_status
      ORDER BY device_name, recorded_at DESC, id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Could not load device status" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Smart Home API running on port ${PORT}`);
});

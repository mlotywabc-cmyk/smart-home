
"use strict";

const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "100kb" }));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

// Create and prepare database tables
async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sensor_readings (
      id BIGSERIAL PRIMARY KEY,
      temperature DOUBLE PRECISION,
      humidity DOUBLE PRECISION,
      rain_value INTEGER,
      rain_detected BOOLEAN,
      distance_cm DOUBLE PRECISION,
      pir_motion BOOLEAN,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE sensor_readings
      ADD COLUMN IF NOT EXISTS temperature DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS humidity DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS rain_value INTEGER,
      ADD COLUMN IF NOT EXISTS rain_detected BOOLEAN,
      ADD COLUMN IF NOT EXISTS distance_cm DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS pir_motion BOOLEAN,
      ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ DEFAULT NOW();

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

    CREATE TABLE IF NOT EXISTS device_commands (
      id BIGSERIAL PRIMARY KEY,
      command TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      delivered_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_device_commands_pending
      ON device_commands (id)
      WHERE status = 'pending';
  `);

  console.log("Database tables are ready.");
}

// Check the ESP32 device token
function requireDeviceToken(req, res, next) {
  const expectedToken = process.env.DEVICE_TOKEN;
  const suppliedToken = req.get("X-Device-Token");

  if (!expectedToken) {
    return res.status(503).json({
      error: "Device token is not configured on the server"
    });
  }

  if (
    typeof suppliedToken !== "string" ||
    suppliedToken !== expectedToken
  ) {
    return res.status(401).json({
      error: "Unauthorized device"
    });
  }

  next();
}

// Commands accepted from the website
const ALLOWED_COMMANDS = new Set([
  // Front door
  "door_open",
  "door_close",

  // Garage door
  "garage_open",
  "garage_close",

  // Rain cover
  "rain_open",
  "rain_close",
  "rain_auto",

  // Fan
  "fan_on",
  "fan_off",
  "fan_auto",

  // Bedroom light - ESP32 GPIO 22
  "bedroom_light_on",
  "bedroom_light_off",

  // Living room light - ESP32 GPIO 23
  "living_light_on",
  "living_light_off"
]);

function validateCommand(command) {
  if (typeof command !== "string") {
    return false;
  }

  const normalized = command.trim().toLowerCase();

  if (ALLOWED_COMMANDS.has(normalized)) {
    return true;
  }

  // Validate temperature commands, for example temperature:24.5
  const match = normalized.match(/^temperature:(\d+(?:\.\d+)?)$/);

  if (!match) {
    return false;
  }

  const value = Number(match[1]);

  return Number.isFinite(value) && value >= 0 && value <= 60;
}

// API home page
app.get("/", (req, res) => {
  res.json({
    message: "Smart Home API is running"
  });
});

// Check API and database health
app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT NOW() AS server_time"
    );

    res.json({
      status: "connected",
      databaseTime: result.rows[0].server_time
    });
  } catch (error) {
    console.error("Health check error:", error.message);

    res.status(500).json({
      status: "error",
      error: "Database connection failed"
    });
  }
});

// Save sensor readings, including PIR motion
app.post("/api/sensors", async (req, res) => {
  try {
    const {
      temperature,
      humidity,
      rain_value,
      rain_detected,
      distance_cm,
      pir_motion
    } = req.body;

    // Validate numeric sensor readings
    const numericFields = {
      temperature,
      humidity,
      rain_value,
      distance_cm
    };

    for (const [field, value] of Object.entries(numericFields)) {
      if (
        value !== undefined &&
        value !== null &&
        (typeof value !== "number" || !Number.isFinite(value))
      ) {
        return res.status(400).json({
          error: field + " must be a valid number or null"
        });
      }
    }

    // Validate rain sensor integer
    if (
      rain_value !== undefined &&
      rain_value !== null &&
      !Number.isInteger(rain_value)
    ) {
      return res.status(400).json({
        error: "rain_value must be an integer"
      });
    }

    // Validate Boolean sensor readings
    const booleanFields = {
      rain_detected,
      pir_motion
    };

    for (const [field, value] of Object.entries(booleanFields)) {
      if (
        value !== undefined &&
        value !== null &&
        typeof value !== "boolean"
      ) {
        return res.status(400).json({
          error: field + " must be true, false or null"
        });
      }
    }

    const values = [
      temperature ?? null,
      humidity ?? null,
      rain_value ?? null,
      rain_detected ?? null,
      distance_cm ?? null,
      pir_motion ?? null
    ];

    if (values.every(value => value === null)) {
      return res.status(400).json({
        error: "Provide at least one valid sensor reading"
      });
    }

    const result = await pool.query(
      `INSERT INTO sensor_readings (
        temperature,
        humidity,
        rain_value,
        rain_detected,
        distance_cm,
        pir_motion
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      values
    );

    res.status(201).json({
      message: "Sensor readings saved",
      reading: result.rows[0]
    });
  } catch (error) {
    console.error("Sensor upload error:", error.message);

    res.status(500).json({
      error: "Could not save sensor readings"
    });
  }
});

// Get the latest sensor reading
app.get("/api/sensors/latest", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM sensor_readings
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1
    `);

    res.json(result.rows[0] ?? null);
  } catch (error) {
    console.error("Latest sensor error:", error.message);

    res.status(500).json({
      error: "Could not load sensor readings"
    });
  }
});

// Get sensor history
app.get("/api/sensors", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM sensor_readings
      ORDER BY recorded_at DESC, id DESC
      LIMIT 100
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Sensor history error:", error.message);

    res.status(500).json({
      error: "Could not load sensor history"
    });
  }
});

// Save an RFID access event
app.post("/api/access-events", async (req, res) => {
  try {
    const {
      card_uid,
      event_type,
      access_granted
    } = req.body;

    if (
      typeof event_type !== "string" ||
      !event_type.trim()
    ) {
      return res.status(400).json({
        error: "event_type is required"
      });
    }

    if (
      card_uid !== undefined &&
      card_uid !== null &&
      typeof card_uid !== "string"
    ) {
      return res.status(400).json({
        error: "card_uid must be a string or null"
      });
    }

    if (
      access_granted !== undefined &&
      access_granted !== null &&
      typeof access_granted !== "boolean"
    ) {
      return res.status(400).json({
        error: "access_granted must be true, false or null"
      });
    }

    const result = await pool.query(
      `INSERT INTO access_events
        (card_uid, event_type, access_granted)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [
        card_uid ?? null,
        event_type.trim(),
        access_granted ?? null
      ]
    );

    res.status(201).json({
      message: "Access event saved",
      event: result.rows[0]
    });
  } catch (error) {
    console.error("Access event error:", error.message);

    res.status(500).json({
      error: "Could not save access event"
    });
  }
});

// Get the latest RFID access event
app.get("/api/access-events/latest", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM access_events
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1
    `);

    res.json(result.rows[0] ?? null);
  } catch (error) {
    console.error("Latest access event error:", error.message);

    res.status(500).json({
      error: "Could not load latest access event"
    });
  }
});

// Get RFID access history
app.get("/api/access-events", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM access_events
      ORDER BY recorded_at DESC, id DESC
      LIMIT 100
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Access history error:", error.message);

    res.status(500).json({
      error: "Could not load access events"
    });
  }
});

// Save device status
app.post("/api/devices", async (req, res) => {
  try {
    const { device_name, status } = req.body;

    if (
      typeof device_name !== "string" ||
      !device_name.trim() ||
      typeof status !== "string" ||
      !status.trim()
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
    console.error("Device status error:", error.message);

    res.status(500).json({
      error: "Could not save device status"
    });
  }
});

// Get the latest status for each device
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
    console.error("Device status read error:", error.message);

    res.status(500).json({
      error: "Could not load device status"
    });
  }
});

// Queue a command from the website
app.post("/api/device-commands", async (req, res) => {
  try {
    const { command } = req.body;

    if (!validateCommand(command)) {
      return res.status(400).json({
        error: "Invalid command"
      });
    }

    const normalizedCommand = command.trim().toLowerCase();

    const result = await pool.query(
      `INSERT INTO device_commands (command)
       VALUES ($1)
       RETURNING id, command, status, created_at`,
      [normalizedCommand]
    );

    res.status(201).json({
      message: "Command queued for the ESP32",
      command: result.rows[0]
    });
  } catch (error) {
    console.error("Command queue error:", error.message);

    res.status(500).json({
      error: "Could not queue device command"
    });
  }
});

// Let the ESP32 fetch the next pending command
app.get(
  "/api/device-commands/next",
  requireDeviceToken,
  async (req, res) => {
    let client;

    try {
      client = await pool.connect();

      await client.query("BEGIN");

      const result = await client.query(`
        SELECT id, command
        FROM device_commands
        WHERE status = 'pending'
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);

      if (result.rows.length === 0) {
        await client.query("COMMIT");

        return res.json({
          command: "none"
        });
      }

      const pendingCommand = result.rows[0];

      await client.query(
        `UPDATE device_commands
         SET status = 'delivered',
             delivered_at = NOW()
         WHERE id = $1`,
        [pendingCommand.id]
      );

      await client.query("COMMIT");

      res.json({
        id: pendingCommand.id,
        command: pendingCommand.command
      });
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Rollback error:", rollbackError.message);
        }
      }

      console.error("Command delivery error:", error.message);

      res.status(500).json({
        error: "Could not retrieve device command"
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);

// Start the server
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`Smart Home API running on port ${PORT}`);
    });
  } catch (error) {
    console.error(
      "Database initialization failed:",
      error.message
    );

    process.exit(1);
  }
}

startServer();

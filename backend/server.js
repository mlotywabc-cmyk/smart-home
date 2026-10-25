
"use strict";

const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "100kb" }));

// =====================================================
// 1. DATABASE CONNECTION
// =====================================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL
        ? { rejectUnauthorized: false }
        : false
});

// Use South African local time for automatic schedules.
const TIME_ZONE = "Africa/Johannesburg";

// =====================================================
// 2. DATABASE INITIALIZATION
// =====================================================

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
            ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ
                DEFAULT NOW();

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

        -- Daily automatic timer settings.
        CREATE TABLE IF NOT EXISTS device_timers (
            device_name VARCHAR(50) PRIMARY KEY,
            on_time TIME NOT NULL,
            off_time TIME NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Prevent the same scheduled action from being queued
        -- more than once on the same South African calendar date.
        CREATE TABLE IF NOT EXISTS device_timer_runs (
            id BIGSERIAL PRIMARY KEY,
            device_name VARCHAR(50) NOT NULL,
            action VARCHAR(3) NOT NULL,
            scheduled_date DATE NOT NULL,
            executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (device_name, action, scheduled_date)
        );
    `);

    console.log("Database tables are ready.");
}

// =====================================================
// 3. ESP32 DEVICE AUTHENTICATION
// =====================================================

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

// =====================================================
// 4. ALLOWED DEVICE COMMANDS
// =====================================================

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

    // Bedroom light
    "bedroom_light_on",
    "bedroom_light_off",

    // Living room light
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

    // Accept temperature commands, for example temperature:24.5.
    const match = normalized.match(/^temperature:(\d+(?:\.\d+)?)$/);

    if (!match) {
        return false;
    }

    const value = Number(match[1]);

    return Number.isFinite(value) && value >= 0 && value <= 60;
}

// =====================================================
// 5. TIMER CONFIGURATION
// =====================================================

const TIMER_DEVICES = {
    bedroom_light: {
        onCommand: "bedroom_light_on",
        offCommand: "bedroom_light_off"
    },
    living_light: {
        onCommand: "living_light_on",
        offCommand: "living_light_off"
    },
    fan: {
        onCommand: "fan_on",
        offCommand: "fan_off"
    }
};

function isValidTime(value) {
    return (
        typeof value === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    );
}

function getSouthAfricanDateTime() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date());

    const values = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    }

    return {
        date: `${values.year}-${values.month}-${values.day}`,
        time: `${values.hour}:${values.minute}`
    };
}

// =====================================================
// 6. AUTOMATIC TIMER SCHEDULER
// =====================================================

// Checks schedules and queues commands for the ESP32.
// It checks every 10 seconds, but only queues each action
// once per device per South African calendar date.

let timerCheckRunning = false;

async function checkAutomaticTimers() {
    if (timerCheckRunning) {
        return;
    }

    timerCheckRunning = true;

    try {
        const current = getSouthAfricanDateTime();

        const result = await pool.query(`
            SELECT device_name, on_time, off_time
            FROM device_timers
            WHERE enabled = TRUE
        `);

        for (const timer of result.rows) {
            const device = TIMER_DEVICES[timer.device_name];

            if (!device) {
                continue;
            }

            // PostgreSQL TIME values can be returned with seconds.
            const onTime = String(timer.on_time).slice(0, 5);
            const offTime = String(timer.off_time).slice(0, 5);

            let action = null;
            let command = null;

            if (current.time === onTime) {
                action = "ON";
                command = device.onCommand;
            } else if (current.time === offTime) {
                action = "OFF";
                command = device.offCommand;
            }

            if (!action || !command) {
                continue;
            }

            const client = await pool.connect();

            try {
                await client.query("BEGIN");

                // A unique database constraint prevents duplicates
                // if the scheduler checks the same minute repeatedly.
                const runResult = await client.query(
                    `
                    INSERT INTO device_timer_runs (
                        device_name,
                        action,
                        scheduled_date
                    )
                    VALUES ($1, $2, $3::date)
                    ON CONFLICT (
                        device_name,
                        action,
                        scheduled_date
                    ) DO NOTHING
                    RETURNING id
                    `,
                    [timer.device_name, action, current.date]
                );

                if (runResult.rows.length === 0) {
                    await client.query("COMMIT");
                    continue;
                }

                // Queue the command for the existing ESP32 polling API.
                await client.query(
                    `
                    INSERT INTO device_commands (command)
                    VALUES ($1)
                    `,
                    [command]
                );

                await client.query("COMMIT");

                console.log(
                    `[TIMER] ${timer.device_name}: ${action} ` +
                    `at ${current.time} on ${current.date}. ` +
                    `Command queued: ${command}`
                );
            } catch (error) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    console.error(
                        "Timer rollback error:",
                        rollbackError.message
                    );
                }

                console.error(
                    "Timer execution error:",
                    error.message
                );
            } finally {
                client.release();
            }
        }
    } catch (error) {
        console.error(
            "Automatic timer check failed:",
            error.message
        );
    } finally {
        timerCheckRunning = false;
    }
}

// =====================================================
// 7. HOME PAGE AND HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
    res.json({
        message: "Smart Home API is running",
        timers: "enabled"
    });
});

app.get("/api/health", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT NOW() AS server_time"
        );

        res.json({
            status: "connected",
            databaseTime: result.rows[0].server_time,
            timezone: TIME_ZONE
        });
    } catch (error) {
        console.error("Health check error:", error.message);

        res.status(500).json({
            status: "error",
            error: "Database connection failed"
        });
    }
});

// =====================================================
// 8. SENSOR READINGS AND PIR MOTION
// =====================================================

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
                (
                    typeof value !== "number" ||
                    !Number.isFinite(value)
                )
            ) {
                return res.status(400).json({
                    error: field + " must be a valid number or null"
                });
            }
        }

        if (
            rain_value !== undefined &&
            rain_value !== null &&
            !Number.isInteger(rain_value)
        ) {
            return res.status(400).json({
                error: "rain_value must be an integer"
            });
        }

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
            `
            INSERT INTO sensor_readings (
                temperature,
                humidity,
                rain_value,
                rain_detected,
                distance_cm,
                pir_motion
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            `,
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

// =====================================================
// 9. RFID ACCESS EVENTS
// =====================================================

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
            `
            INSERT INTO access_events (
                card_uid,
                event_type,
                access_granted
            )
            VALUES ($1, $2, $3)
            RETURNING *
            `,
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

// =====================================================
// 10. DEVICE STATUS
// =====================================================

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
            `
            INSERT INTO device_status (device_name, status)
            VALUES ($1, $2)
            RETURNING *
            `,
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

app.get("/api/devices", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT ON (device_name)
                id,
                device_name,
                status,
                recorded_at
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

// =====================================================
// 11. AUTOMATIC TIMER API
// =====================================================

// Get the saved schedules for all three devices.
app.get("/api/device-timers", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT device_name, on_time, off_time, enabled, updated_at
            FROM device_timers
            ORDER BY device_name
        `);

        res.json({
            timezone: TIME_ZONE,
            timers: result.rows.map(timer => ({
                ...timer,
                on_time: String(timer.on_time).slice(0, 5),
                off_time: String(timer.off_time).slice(0, 5)
            }))
        });
    } catch (error) {
        console.error("Load timer settings error:", error.message);

        res.status(500).json({
            error: "Could not load timer settings"
        });
    }
});

// Save one or more schedules.
//
// Expected body:
// {
//   "timers": [
//     {
//       "device_name": "bedroom_light",
//       "on_time": "18:00",
//       "off_time": "23:00",
//       "enabled": true
//     }
//   ]
// }
//
// The website can send all three devices in one request.
app.put("/api/device-timers", async (req, res) => {
    const { timers } = req.body;

    if (!Array.isArray(timers) || timers.length === 0) {
        return res.status(400).json({
            error: "Provide a non-empty timers array"
        });
    }

    if (timers.length > Object.keys(TIMER_DEVICES).length) {
        return res.status(400).json({
            error: "Too many timer entries"
        });
    }

    const seenDevices = new Set();

    for (const timer of timers) {
        if (!timer || typeof timer !== "object") {
            return res.status(400).json({
                error: "Each timer must be an object"
            });
        }

        const { device_name, on_time, off_time } = timer;
        const enabled = timer.enabled === undefined
            ? true
            : timer.enabled;

        if (!Object.hasOwn(TIMER_DEVICES, device_name)) {
            return res.status(400).json({
                error: "Unsupported timer device: " + device_name
            });
        }

        if (seenDevices.has(device_name)) {
            return res.status(400).json({
                error: "Duplicate timer device: " + device_name
            });
        }

        seenDevices.add(device_name);

        if (!isValidTime(on_time) || !isValidTime(off_time)) {
            return res.status(400).json({
                error: "ON and OFF times must use HH:MM format"
            });
        }

        if (typeof enabled !== "boolean") {
            return res.status(400).json({
                error: "enabled must be true or false"
            });
        }
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (const timer of timers) {
            const enabled = timer.enabled === undefined
                ? true
                : timer.enabled;

            await client.query(
                `
                INSERT INTO device_timers (
                    device_name,
                    on_time,
                    off_time,
                    enabled,
                    updated_at
                )
                VALUES ($1, $2::time, $3::time, $4, NOW())
                ON CONFLICT (device_name)
                DO UPDATE SET
                    on_time = EXCLUDED.on_time,
                    off_time = EXCLUDED.off_time,
                    enabled = EXCLUDED.enabled,
                    updated_at = NOW()
                `,
                [
                    timer.device_name,
                    timer.on_time,
                    timer.off_time,
                    enabled
                ]
            );
        }

        await client.query("COMMIT");

        const result = await pool.query(`
            SELECT device_name, on_time, off_time, enabled, updated_at
            FROM device_timers
            ORDER BY device_name
        `);

        res.json({
            message: "Timer settings saved successfully",
            timezone: TIME_ZONE,
            timers: result.rows.map(timer => ({
                ...timer,
                on_time: String(timer.on_time).slice(0, 5),
                off_time: String(timer.off_time).slice(0, 5)
            }))
        });
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("Timer save rollback error:", rollbackError.message);
        }

        console.error("Save timer settings error:", error.message);

        res.status(500).json({
            error: "Could not save timer settings"
        });
    } finally {
        client.release();
    }
});

// Clear all saved timer settings.
app.delete("/api/device-timers", async (req, res) => {
    try {
        await pool.query("DELETE FROM device_timers");

        res.json({
            message: "All automatic timer settings have been cleared"
        });
    } catch (error) {
        console.error("Clear timers error:", error.message);

        res.status(500).json({
            error: "Could not clear timer settings"
        });
    }
});

// =====================================================
// 12. WEBSITE DEVICE COMMANDS
// =====================================================

// Queue a manual command from the website.
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
            `
            INSERT INTO device_commands (command)
            VALUES ($1)
            RETURNING id, command, status, created_at
            `,
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

// =====================================================
// 13. ESP32 COMMAND POLLING
// =====================================================

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
                `
                UPDATE device_commands
                SET status = 'delivered',
                    delivered_at = NOW()
                WHERE id = $1
                `,
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
                    console.error(
                        "Rollback error:",
                        rollbackError.message
                    );
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

// =====================================================
// 14. START SERVER AND TIMER CHECKER
// =====================================================

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await initializeDatabase();

        app.listen(PORT, () => {
            console.log(`Smart Home API running on port ${PORT}`);
            console.log(`Automatic timer timezone: ${TIME_ZONE}`);
        });

        // Check schedules immediately, then every 10 seconds.
        checkAutomaticTimers();
        setInterval(checkAutomaticTimers, 10_000);
    } catch (error) {
        console.error(
            "Server initialization failed:",
            error.message
        );

        process.exit(1);
    }
}

startServer();

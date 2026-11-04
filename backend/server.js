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

const TIME_ZONE = "Africa/Johannesburg";

// =====================================================
// 2. PERMANENT RFID TAGS
// =====================================================

// Add your TWO existing permanent RFID UIDs to your
// environment variables. Separate them with commas.
//
// Example:
// PERMANENT_RFID_UIDS=YOUR_FIRST_UID,YOUR_SECOND_UID
//
// Do not put visitor UIDs in this variable.

function normalizeCardUID(uid) {
    if (typeof uid !== "string") {
        return "";
    }

    return uid.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function getPermanentRFIDTags() {
    return new Set(
        (process.env.PERMANENT_RFID_UIDS || "")
            .split(",")
            .map(normalizeCardUID)
            .filter(Boolean)
    );
}

function isPermanentRFIDTag(uid) {
    return getPermanentRFIDTags().has(normalizeCardUID(uid));
}

// =====================================================
// 3. DATABASE INITIALIZATION
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

        CREATE TABLE IF NOT EXISTS device_timers (
            device_name VARCHAR(50) PRIMARY KEY,
            on_time TIME NOT NULL,
            off_time TIME NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS device_timer_runs (
            id BIGSERIAL PRIMARY KEY,
            device_name VARCHAR(50) NOT NULL,
            action VARCHAR(3) NOT NULL,
            scheduled_date DATE NOT NULL,
            executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (device_name, action, scheduled_date)
        );

        -- VISITOR RFID TAGS
        CREATE TABLE IF NOT EXISTS visitor_tags (
            id BIGSERIAL PRIMARY KEY,
            visitor_name VARCHAR(100) NOT NULL,
            card_uid VARCHAR(100) NOT NULL UNIQUE,
            duration_minutes INTEGER NOT NULL,
            registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            first_used_at TIMESTAMPTZ,
            expires_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_visitor_tags_card_uid
            ON visitor_tags (card_uid);

        CREATE INDEX IF NOT EXISTS idx_visitor_tags_expiry
            ON visitor_tags (expires_at);
    `);

    console.log("Database tables are ready.");

    const permanentTags = getPermanentRFIDTags();

    if (permanentTags.size !== 2) {
        console.warn(
            "WARNING: Configure exactly TWO permanent RFID UIDs " +
            "using PERMANENT_RFID_UIDS in your environment variables."
        );
    } else {
        console.log("Two permanent RFID tags configured.");
    }
}

// =====================================================
// 4. ESP32 DEVICE AUTHENTICATION
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
// 5. ALLOWED DEVICE COMMANDS
// =====================================================

const ALLOWED_COMMANDS = new Set([
    "door_open",
    "door_close",

    "garage_open",
    "garage_close",

    "rain_open",
    "rain_close",
    "rain_auto",

    "fan_on",
    "fan_off",
    "fan_auto",

    "bedroom_light_on",
    "bedroom_light_off",

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

    const match = normalized.match(
        /^temperature:(\d+(?:\.\d+)?)$/
    );

    if (!match) {
        return false;
    }

    const value = Number(match[1]);

    return Number.isFinite(value) && value >= 0 && value <= 60;
}

// =====================================================
// 6. TIMER CONFIGURATION
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
// 7. AUTOMATIC TIMER SCHEDULER
// =====================================================

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
                    `at ${current.time} on ${current.date}.`
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
// 8. HOME PAGE AND HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
    res.json({
        message: "Smart Home API is running",
        timers: "enabled",
        visitorRFID: "enabled"
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
// 9. SENSOR READINGS AND PIR MOTION
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
// 10. VISITOR RFID MANAGEMENT
// =====================================================

// Register a new visitor tag.
//
// Expected body:
//
// {
//     "visitor_name": "John",
//     "card_uid": "VISITOR_CARD_UID",
//     "duration_minutes": 120
// }
//
// The timer starts on the FIRST successful scan.

app.post("/api/visitor-tags", async (req, res) => {
    try {
        const {
            visitor_name,
            card_uid,
            duration_minutes
        } = req.body;

        if (
            typeof visitor_name !== "string" ||
            !visitor_name.trim()
        ) {
            return res.status(400).json({
                error: "Visitor name is required"
            });
        }

        if (
            typeof card_uid !== "string" ||
            !card_uid.trim()
        ) {
            return res.status(400).json({
                error: "RFID card UID is required"
            });
        }

        if (
            !Number.isInteger(duration_minutes) ||
            duration_minutes < 1 ||
            duration_minutes > 43200
        ) {
            return res.status(400).json({
                error: "Duration must be between 1 and 43200 minutes"
            });
        }

        const normalizedUID = normalizeCardUID(card_uid);

        if (!normalizedUID) {
            return res.status(400).json({
                error: "Invalid RFID card UID"
            });
        }

        // Never allow a permanent card to be registered
        // as a visitor card.
        if (isPermanentRFIDTag(normalizedUID)) {
            return res.status(409).json({
                error: "This is a permanent RFID tag and cannot be registered as a visitor tag"
            });
        }

        const result = await pool.query(
            `
            INSERT INTO visitor_tags (
                visitor_name,
                card_uid,
                duration_minutes
            )
            VALUES ($1, $2, $3)
            RETURNING *
            `,
            [
                visitor_name.trim(),
                normalizedUID,
                duration_minutes
            ]
        );

        res.status(201).json({
            message: "Visitor RFID tag registered successfully",
            visitor: result.rows[0],
            timer_starts: "On first successful scan"
        });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                error: "This RFID tag is already registered"
            });
        }

        console.error("Visitor registration error:", error.message);

        res.status(500).json({
            error: "Could not register visitor RFID tag"
        });
    }
});

// Get all visitor tags.

app.get("/api/visitor-tags", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id,
                visitor_name,
                card_uid,
                duration_minutes,
                registered_at,
                first_used_at,
                expires_at,
                revoked_at,
                CASE
                    WHEN revoked_at IS NOT NULL THEN 'Revoked'
                    WHEN first_used_at IS NULL THEN 'Not activated'
                    WHEN expires_at <= NOW() THEN 'Expired'
                    ELSE 'Active'
                END AS access_status,
                CASE
                    WHEN first_used_at IS NULL THEN NULL
                    WHEN expires_at <= NOW() THEN 0
                    WHEN revoked_at IS NOT NULL THEN 0
                    ELSE GREATEST(
                        0,
                        EXTRACT(EPOCH FROM (expires_at - NOW()))::BIGINT
                    )
                END AS remaining_seconds
            FROM visitor_tags
            ORDER BY registered_at DESC
        `);

        res.json({
            visitors: result.rows
        });

    } catch (error) {
        console.error("Visitor list error:", error.message);

        res.status(500).json({
            error: "Could not load visitor tags"
        });
    }
});

// Revoke a visitor tag.
// Revocation is permanent for that registration.

app.delete("/api/visitor-tags/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({
                error: "Invalid visitor tag ID"
            });
        }

        const result = await pool.query(
            `
            UPDATE visitor_tags
            SET revoked_at = COALESCE(revoked_at, NOW())
            WHERE id = $1
            RETURNING *
            `,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Visitor tag not found"
            });
        }

        res.json({
            message: "Visitor RFID access revoked successfully",
            visitor: result.rows[0]
        });

    } catch (error) {
        console.error("Visitor revocation error:", error.message);

        res.status(500).json({
            error: "Could not revoke visitor RFID tag"
        });
    }
});

// =====================================================
// 11. RFID AUTHORISATION FOR THE ESP32
// =====================================================

// IMPORTANT:
// The ESP32 must call this endpoint for every RFID scan.
//
// It must send:
// Header: X-Device-Token
//
// Body:
// {
//     "card_uid": "SCANNED_CARD_UID"
// }
//
// The backend checks permanent tags first, then visitor tags.
//
// Visitor access starts on the first successful scan.
// Expired or revoked visitor tags are denied.

app.post(
    "/api/rfid/authorize",
    requireDeviceToken,
    async (req, res) => {
        try {
            const { card_uid } = req.body;

            if (
                typeof card_uid !== "string" ||
                !card_uid.trim()
            ) {
                return res.status(400).json({
                    access_granted: false,
                    error: "A valid card UID is required"
                });
            }

            const normalizedUID = normalizeCardUID(card_uid);

            // -----------------------------------------
            // A. CHECK PERMANENT RFID TAGS
            // -----------------------------------------

            if (isPermanentRFIDTag(normalizedUID)) {
                await pool.query(
                    `
                    INSERT INTO access_events (
                        card_uid,
                        event_type,
                        access_granted
                    )
                    VALUES ($1, $2, TRUE)
                    `,
                    [
                        normalizedUID,
                        "PERMANENT_TAG_ACCESS"
                    ]
                );

                return res.json({
                    access_granted: true,
                    tag_type: "permanent",
                    reason: "Permanent RFID tag authorised"
                });
            }

            // -----------------------------------------
            // B. CHECK VISITOR RFID TAGS
            // -----------------------------------------

            const client = await pool.connect();

            try {
                await client.query("BEGIN");

                const visitorResult = await client.query(
                    `
                    SELECT *
                    FROM visitor_tags
                    WHERE card_uid = $1
                    FOR UPDATE
                    `,
                    [normalizedUID]
                );

                if (visitorResult.rows.length === 0) {
                    await client.query(
                        `
                        INSERT INTO access_events (
                            card_uid,
                            event_type,
                            access_granted
                        )
                        VALUES ($1, $2, FALSE)
                        `,
                        [
                            normalizedUID,
                            "UNKNOWN_TAG_DENIED"
                        ]
                    );

                    await client.query("COMMIT");

                    return res.status(403).json({
                        access_granted: false,
                        tag_type: "unknown",
                        reason: "RFID tag is not registered"
                    });
                }

                const visitor = visitorResult.rows[0];

                // Revoked tags are always denied.
                if (visitor.revoked_at !== null) {
                    await client.query(
                        `
                        INSERT INTO access_events (
                            card_uid,
                            event_type,
                            access_granted
                        )
                        VALUES ($1, $2, FALSE)
                        `,
                        [
                            normalizedUID,
                            "VISITOR_TAG_REVOKED"
                        ]
                    );

                    await client.query("COMMIT");

                    return res.status(403).json({
                        access_granted: false,
                        tag_type: "visitor",
                        reason: "Visitor access has been revoked"
                    });
                }

                // -------------------------------------
                // C. START TIMER ON FIRST SCAN
                // -------------------------------------

                if (visitor.first_used_at === null) {
                    const activationResult = await client.query(
                        `
                        UPDATE visitor_tags
                        SET
                            first_used_at = NOW(),
                            expires_at =
                                NOW() +
                                (duration_minutes * INTERVAL '1 minute')
                        WHERE id = $1
                        RETURNING *
                        `,
                        [visitor.id]
                    );

                    const activatedVisitor =
                        activationResult.rows[0];

                    await client.query(
                        `
                        INSERT INTO access_events (
                            card_uid,
                            event_type,
                            access_granted
                        )
                        VALUES ($1, $2, TRUE)
                        `,
                        [
                            normalizedUID,
                            "VISITOR_TAG_ACTIVATED"
                        ]
                    );

                    await client.query("COMMIT");

                    return res.json({
                        access_granted: true,
                        tag_type: "visitor",
                        visitor_name: activatedVisitor.visitor_name,
                        reason: "Visitor tag activated. Access granted.",
                        first_used_at: activatedVisitor.first_used_at,
                        expires_at: activatedVisitor.expires_at,
                        duration_minutes: activatedVisitor.duration_minutes
                    });
                }

                // -------------------------------------
                // D. CHECK VISITOR EXPIRY
                // -------------------------------------

                const expiryResult = await client.query(
                    `
                    SELECT
                        expires_at,
                        expires_at > NOW() AS is_active
                    FROM visitor_tags
                    WHERE id = $1
                    `,
                    [visitor.id]
                );

                const expiry = expiryResult.rows[0];

                if (!expiry.is_active) {
                    await client.query(
                        `
                        INSERT INTO access_events (
                            card_uid,
                            event_type,
                            access_granted
                        )
                        VALUES ($1, $2, FALSE)
                        `,
                        [
                            normalizedUID,
                            "VISITOR_TAG_EXPIRED"
                        ]
                    );

                    await client.query("COMMIT");

                    return res.status(403).json({
                        access_granted: false,
                        tag_type: "visitor",
                        reason: "Visitor access has expired",
                        expires_at: expiry.expires_at
                    });
                }

                // -------------------------------------
                // E. ACTIVE VISITOR ACCESS
                // -------------------------------------

                await client.query(
                    `
                    INSERT INTO access_events (
                        card_uid,
                        event_type,
                        access_granted
                    )
                    VALUES ($1, $2, TRUE)
                    `,
                    [
                        normalizedUID,
                        "VISITOR_TAG_ACCESS"
                    ]
                );

                await client.query("COMMIT");

                return res.json({
                    access_granted: true,
                    tag_type: "visitor",
                    visitor_name: visitor.visitor_name,
                    reason: "Visitor access is active",
                    expires_at: expiry.expires_at
                });

            } catch (error) {
                await client.query("ROLLBACK");
                throw error;

            } finally {
                client.release();
            }

        } catch (error) {
            console.error("RFID authorisation error:", error.message);

            res.status(500).json({
                access_granted: false,
                error: "Could not validate RFID tag"
            });
        }
    }
);

// =====================================================
// 12. RFID ACCESS EVENTS
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
// 13. DEVICE STATUS
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
// 14. AUTOMATIC TIMER API
// =====================================================

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
            console.error(
                "Timer save rollback error:",
                rollbackError.message
            );
        }

        console.error("Save timer settings error:", error.message);

        res.status(500).json({
            error: "Could not save timer settings"
        });

    } finally {
        client.release();
    }
});

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
// 15. WEBSITE DEVICE COMMANDS
// =====================================================

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
// 16. ESP32 COMMAND POLLING
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
// 17. START SERVER AND TIMER CHECKER
// =====================================================

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await initializeDatabase();

        app.listen(PORT, () => {
            console.log(`Smart Home API running on port ${PORT}`);
            console.log(`Automatic timer timezone: ${TIME_ZONE}`);
            console.log("Visitor RFID management is enabled.");
        });

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
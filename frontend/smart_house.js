
"use strict";

// =====================================================
// 1. SMART HOME BACKEND
// =====================================================

const API_BASE = "https://smart-home-b1p5.onrender.com";

const DEMO_USERNAME = "admin";
const DEMO_PASSWORD = "home123";

// =====================================================
// 2. DEVICE DATA
// =====================================================

const devices = [
    {
        id: "livingLight",
        name: "Living Room Light",
        room: "Living room",
        icon: "☀",
        on: false,
        type: "switch"
    },
    {
        id: "bedroomLight",
        name: "Bedroom Light",
        room: "Bedroom",
        icon: "☼",
        on: false,
        type: "switch"
    },
    {
        id: "fan",
        name: "Cooling Fan",
        room: "Living room",
        icon: "❄",
        on: false,
        type: "switch"
    },
    {
        id: "securityLight",
        name: "Security Light",
        room: "Outside",
        icon: "⌑",
        on: false,
        type: "switch"
    },
    {
        id: "frontDoor",
        name: "Front Door",
        room: "Entrance",
        icon: "🚪",
        on: false,
        type: "servo",
        openCommand: "door_open",
        closeCommand: "door_close"
    },
    {
        id: "rainCover",
        name: "Rain Cover",
        room: "Window",
        icon: "☂",
        on: false,
        type: "servo",
        openCommand: "rain_open",
        closeCommand: "rain_close"
    },
    {
        id: "garageDoor",
        name: "Garage Door",
        room: "Garage",
        icon: "🚗",
        on: false,
        type: "servo",
        openCommand: "garage_open",
        closeCommand: "garage_close"
    }
];

// =====================================================
// 3. SENSOR AND SYSTEM VARIABLES
// =====================================================

let currentTemperature = null;
let humidity = null;
let rainValue = null;
let rainDetected = null;
let distanceCm = null;

let pirMotion = null;
const PIR_GPIO_PIN = 15;

let lastSensorTimestamp = null;

let targetTemperature = 23;
let doorLocked = true;
let lastCard = "None";
let lastAccessResult = "No scan yet";
let events = [];
let toastTimer;

// Timer storage
const DEVICE_TIMERS_KEY = "smartHomeDeviceTimers";
const TIMER_FIRED_PREFIX = "smartHomeTimerFired_";

let timerCheckInterval = null;
let timerCommandInProgress = {};

// Cached HTML elements
const loginScreen = document.getElementById("loginScreen");
const app = document.getElementById("app");
const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
const toast = document.getElementById("toast");

// =====================================================
// 4. INITIALISE WEBSITE
// =====================================================

document.addEventListener("DOMContentLoaded", initialiseWebsite);

function initialiseWebsite() {
    addEventListeners();

    updateClock();
    setInterval(updateClock, 1000);

    addEvent(
        "Website opened",
        "SmartHome dashboard started.",
        "Success",
        "⌂"
    );

    renderAllDevices();
    updateDashboard();
    updateClimateDisplay();
    updateSecurityDisplay();
    updateSensorDisplay();
    renderEvents();

    // Start the automatic device timers.
    initialiseDeviceTimers();

    loadLatestSensorReading();
    setInterval(loadLatestSensorReading, 10000);

    loadLatestAccessEvent();
    setInterval(loadLatestAccessEvent, 10000);
}

// =====================================================
// 5. EVENT LISTENERS
// =====================================================

function addEventListeners() {
    if (loginForm) {
        loginForm.addEventListener("submit", handleLogin);
    }

    const logoutButton = document.getElementById("logoutButton");

    if (logoutButton) {
        logoutButton.addEventListener("click", logout);
    }

    document.querySelectorAll(".nav-link").forEach(button => {
        button.addEventListener("click", () => {
            showPage(button.dataset.page);
        });
    });

    document.querySelectorAll("[data-goto]").forEach(button => {
        button.addEventListener("click", () => {
            showPage(button.dataset.goto);
        });
    });

    const temperatureSlider =
        document.getElementById("temperatureSlider");

    if (temperatureSlider) {
        temperatureSlider.addEventListener(
            "input",
            updateTargetPreview
        );
    }

    const saveTemperatureButton =
        document.getElementById("saveTemperature");

    if (saveTemperatureButton) {
        saveTemperatureButton.addEventListener(
            "click",
            saveTemperature
        );
    }

    const validRfidButton =
        document.getElementById("validRfidButton");

    if (validRfidButton) {
        validRfidButton.addEventListener(
            "click",
            simulateValidCard
        );
    }

    const invalidRfidButton =
        document.getElementById("invalidRfidButton");

    if (invalidRfidButton) {
        invalidRfidButton.addEventListener(
            "click",
            simulateInvalidCard
        );
    }

    const lockDoorButton =
        document.getElementById("lockDoorButton");

    if (lockDoorButton) {
        lockDoorButton.addEventListener("click", lockDoor);
    }

    const clearHistoryButton =
        document.getElementById("clearHistoryButton");

    if (clearHistoryButton) {
        clearHistoryButton.addEventListener(
            "click",
            clearHistory
        );
    }

    // Automatic device timers
    const deviceTimerForm =
        document.getElementById("deviceTimerForm");

    if (deviceTimerForm) {
        deviceTimerForm.addEventListener(
            "submit",
            saveDeviceTimers
        );
    }

    const clearDeviceTimersButton =
        document.getElementById("clearDeviceTimers");

    if (clearDeviceTimersButton) {
        clearDeviceTimersButton.addEventListener(
            "click",
            clearDeviceTimers
        );
    }
}

// =====================================================
// 6. LOGIN AND LOGOUT
// =====================================================

function handleLogin(event) {
    event.preventDefault();

    const username =
        document.getElementById("username").value.trim();

    const password =
        document.getElementById("password").value;

    if (
        username === DEMO_USERNAME &&
        password === DEMO_PASSWORD
    ) {
        if (loginScreen) {
            loginScreen.classList.add("hidden");
        }

        if (app) {
            app.classList.remove("hidden");
        }

        if (loginMessage) {
            loginMessage.textContent = "";
        }

        document.getElementById("username").value = "";
        document.getElementById("password").value = "";

        addEvent(
            "User login",
            "Administrator signed in.",
            "Success",
            "↪"
        );

        updateDashboard();
        renderEvents();

        showToast("Welcome to your SmartHome dashboard.");
    } else {
        if (loginMessage) {
            loginMessage.textContent =
                "Incorrect username or password.";

            loginMessage.className = "message error";
        }

        addEvent(
            "Login attempt",
            "Incorrect login details entered.",
            "Warning",
            "!"
        );

        renderEvents();
    }
}

function logout() {
    if (loginScreen) {
        loginScreen.classList.remove("hidden");
    }

    if (app) {
        app.classList.add("hidden");
    }

    showPage("dashboard");
    showToast("You have signed out.");
}

// =====================================================
// 7. NAVIGATION
// =====================================================

function showPage(pageName) {
    const pages = {
        dashboard: "dashboardPage",
        devices: "devicesPage",
        climate: "climatePage",
        security: "securityPage",
        history: "historyPage"
    };

    if (!pages[pageName]) return;

    Object.values(pages).forEach(id => {
        const page = document.getElementById(id);

        if (page) {
            page.classList.add("hidden");
        }
    });

    const selectedPage =
        document.getElementById(pages[pageName]);

    if (selectedPage) {
        selectedPage.classList.remove("hidden");
    }

    document.querySelectorAll(".nav-link").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === pageName
        );
    });

    const titles = {
        dashboard: "Dashboard",
        devices: "Devices",
        climate: "Climate Control",
        security: "Security & RFID",
        history: "Event History"
    };

    setText("pageTitle", titles[pageName]);

    if (pageName === "history") {
        renderEvents();
    }
}

// =====================================================
// 8. CLOCK
// =====================================================

function updateClock() {
    const now = new Date();

    setText(
        "currentDate",
        now.toLocaleDateString("en-ZA", {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric"
        })
    );

    setText(
        "currentTime",
        now.toLocaleTimeString("en-ZA", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        })
    );
}

// =====================================================
// 9. DEVICE DISPLAY
// =====================================================

function renderAllDevices() {
    const allDevicesContainer =
        document.getElementById("allDevices");

    const dashboardDevices =
        document.getElementById("dashboardDevices");

    if (allDevicesContainer) {
        allDevicesContainer.innerHTML = "";
    }

    if (dashboardDevices) {
        dashboardDevices.innerHTML = "";
    }

    devices.forEach(device => {
        if (allDevicesContainer) {
            allDevicesContainer.appendChild(
                createDeviceCard(device)
            );
        }

        if (dashboardDevices) {
            dashboardDevices.appendChild(
                createDeviceRow(device)
            );
        }
    });

    updateActiveDeviceCount();
}

function createDeviceRow(device) {
    const row = document.createElement("div");
    row.className = "device-row";

    const icon = document.createElement("div");
    icon.className = "device-symbol";
    icon.textContent = device.icon;

    const description = document.createElement("div");
    description.className = "device-description";

    const name = document.createElement("h4");
    name.textContent = device.name;

    const room = document.createElement("p");
    room.textContent = device.room;

    description.append(name, room);

    const state = document.createElement("span");

    state.className =
        "device-state" + (device.on ? " on" : "");

    state.textContent = device.type === "servo"
        ? (device.on ? "Open" : "Closed")
        : (device.on ? "On" : "Off");

    row.append(icon, description, state);

    if (device.type === "servo") {
        row.appendChild(createServoControls(device));
    } else {
        row.appendChild(createToggle(device));
    }

    return row;
}

function createDeviceCard(device) {
    const card = document.createElement("article");
    card.className = "device-card";

    const top = document.createElement("div");
    top.className = "device-card-top";

    const icon = document.createElement("div");
    icon.className = "device-symbol";
    icon.textContent = device.icon;

    const state = document.createElement("span");
    state.className = "status-pill";

    state.textContent = device.type === "servo"
        ? (device.on ? "Open" : "Closed")
        : (device.on ? "On" : "Off");

    if (!device.on) {
        state.style.color = "#94a599";
        state.style.background = "#29312b";
    }

    top.append(icon, state);

    const name = document.createElement("h3");
    name.textContent = device.name;

    const room = document.createElement("p");
    room.className = "muted";
    room.textContent = device.room;

    const bottom = document.createElement("div");
    bottom.className = "device-card-bottom";

    const statusText = document.createElement("span");

    if (device.type === "servo") {
        statusText.textContent = device.on
            ? "Motor is open"
            : "Motor is closed";

        bottom.append(
            statusText,
            createServoControls(device)
        );
    } else {
        statusText.textContent = device.on
            ? "Device is running"
            : "Device is off";

        bottom.append(statusText, createToggle(device));
    }

    card.append(top, name, room, bottom);

    return card;
}

// =====================================================
// 10. SERVO CONTROLS
// =====================================================

function createServoControls(device) {
    const controls = document.createElement("div");
    controls.className = "servo-controls";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.textContent = "Open";
    openButton.className = "servo-open-button";

    openButton.style.padding = "8px 14px";
    openButton.style.marginRight = "6px";
    openButton.style.cursor = "pointer";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Close";
    closeButton.className = "servo-close-button";

    closeButton.style.padding = "8px 14px";
    closeButton.style.cursor = "pointer";

    openButton.disabled = device.on;
    closeButton.disabled = !device.on;

    openButton.addEventListener("click", () => {
        controlServo(device, true);
    });

    closeButton.addEventListener("click", () => {
        controlServo(device, false);
    });

    controls.append(openButton, closeButton);

    return controls;
}

async function controlServo(device, open) {
    const command = open
        ? device.openCommand
        : device.closeCommand;

    const action = open ? "opened" : "closed";

    try {
        showToast("Sending command to " + device.name + "...");

        const response = await fetch(
            API_BASE + "/api/device-commands",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ command })
            }
        );

        const result = await readResponse(response);

        if (!response.ok) {
            throw new Error(
                result.message || "Command could not be sent."
            );
        }

        device.on = open;

        addEvent(
            "Servo command sent",
            device.name + " " + action +
            ". Command: " + command,
            "Success",
            device.icon
        );

        renderAllDevices();
        updateDashboard();
        renderEvents();

        showToast(
            device.name + " " + action + " command sent."
        );

    } catch (error) {
        console.error(
            "Servo command failed for " + device.name + ":",
            error
        );

        addEvent(
            "Servo command failed",
            "Could not send the command to " + device.name + ".",
            "Warning",
            "!"
        );

        renderEvents();

        showToast(
            "Could not control " + device.name +
            ". Check the backend connection."
        );
    }
}

// =====================================================
// 11. LIGHT AND FAN SWITCHES
// =====================================================

const DEVICE_COMMANDS = {
    bedroomLight: {
        on: "bedroom_light_on",
        off: "bedroom_light_off"
    },

    livingLight: {
        on: "living_light_on",
        off: "living_light_off"
    },

    fan: {
        on: "fan_on",
        off: "fan_off"
    }
};

function createToggle(device) {
    const button = document.createElement("button");

    button.className =
        "toggle" + (device.on ? " is-on" : "");

    button.type = "button";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-checked", String(device.on));
    button.setAttribute("aria-label", "Switch " + device.name);

    button.addEventListener("click", async () => {
        if (button.disabled) return;

        const newState = !device.on;
        const commandSet = DEVICE_COMMANDS[device.id];

        if (commandSet) {
            const command = newState
                ? commandSet.on
                : commandSet.off;

            button.disabled = true;

            try {
                showToast(
                    "Sending command to " + device.name + "..."
                );

                const response = await fetch(
                    API_BASE + "/api/device-commands",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ command })
                    }
                );

                const result = await readResponse(response);

                if (!response.ok) {
                    throw new Error(
                        result.message ||
                        "The server rejected the command."
                    );
                }

                device.on = newState;

                addEvent(
                    "Device command sent",
                    device.name + " was " +
                    (newState
                        ? "switched on"
                        : "switched off") +
                    ". Command: " + command,
                    "Success",
                    device.icon
                );

                renderAllDevices();
                updateDashboard();
                renderEvents();

                showToast(
                    device.name +
                    (newState
                        ? " ON command sent."
                        : " OFF command sent.")
                );

            } catch (error) {
                console.error(
                    "Could not control " + device.name + ":",
                    error
                );

                addEvent(
                    "Device command failed",
                    "Could not send a command to " +
                    device.name + ".",
                    "Warning",
                    "!"
                );

                renderEvents();

                showToast(
                    "Could not control " + device.name +
                    ". Check the backend connection."
                );
            }

            return;
        }

        // Website-only switches without configured commands.
        device.on = newState;

        addEvent(
            "Device updated",
            device.name + " was " +
            (device.on
                ? "switched on"
                : "switched off") + ".",
            "Success",
            device.icon
        );

        renderAllDevices();
        updateDashboard();
        renderEvents();

        showToast(
            device.name +
            (device.on
                ? " switched on."
                : " switched off.")
        );
    });

    return button;
}

// =====================================================
// 12. AUTOMATIC DEVICE TIMERS
// =====================================================

function initialiseDeviceTimers() {
    loadDeviceTimersIntoForm();
    updateTimerStatusText();

    // Check the configured times every five seconds.
    checkDeviceTimers();

    if (timerCheckInterval !== null) {
        clearInterval(timerCheckInterval);
    }

    timerCheckInterval = setInterval(
        checkDeviceTimers,
        5000
    );
}

function getTimerInputValues() {
    return {
        bedroomLight: {
            on: document.getElementById(
                "bedroomLightOnTime"
            )?.value || "",

            off: document.getElementById(
                "bedroomLightOffTime"
            )?.value || ""
        },

        livingLight: {
            on: document.getElementById(
                "livingRoomLightOnTime"
            )?.value || "",

            off: document.getElementById(
                "livingRoomLightOffTime"
            )?.value || ""
        },

        fan: {
            on: document.getElementById(
                "fanOnTime"
            )?.value || "",

            off: document.getElementById(
                "fanOffTime"
            )?.value || ""
        }
    };
}

function saveDeviceTimers(event) {
    event.preventDefault();

    const timers = getTimerInputValues();

    // Every device must have two different times.
    for (const [deviceId, times] of Object.entries(timers)) {
        if (!times.on || !times.off) {
            showTimerMessage(
                "Please select both ON and OFF times for every device.",
                "error"
            );
            return;
        }

        if (times.on === times.off) {
            showTimerMessage(
                getDeviceName(deviceId) +
                " must have different ON and OFF times.",
                "error"
            );
            return;
        }
    }

    try {
        localStorage.setItem(
            DEVICE_TIMERS_KEY,
            JSON.stringify(timers)
        );

        updateTimerStatusText();

        addEvent(
            "Device timers saved",
            "Daily ON and OFF times were saved for the bedroom light, living room light and fan.",
            "Success",
            "◷"
        );

        renderEvents();

        showTimerMessage(
            "Timer settings saved successfully.",
            "success"
        );

        showToast("Device timer settings saved.");

        // Check whether a selected time matches the current time.
        checkDeviceTimers();

    } catch (error) {
        console.error("Could not save device timers:", error);

        showTimerMessage(
            "Could not save the timers in this browser.",
            "error"
        );
    }
}

function loadDeviceTimersIntoForm() {
    let timers;

    try {
        const saved = localStorage.getItem(DEVICE_TIMERS_KEY);

        if (!saved) return;

        timers = JSON.parse(saved);
    } catch (error) {
        console.error("Could not load device timers:", error);
        return;
    }

    if (!timers || typeof timers !== "object") return;

    const fieldMap = {
        bedroomLight: {
            on: "bedroomLightOnTime",
            off: "bedroomLightOffTime"
        },

        livingLight: {
            on: "livingRoomLightOnTime",
            off: "livingRoomLightOffTime"
        },

        fan: {
            on: "fanOnTime",
            off: "fanOffTime"
        }
    };

    for (const [deviceId, fields] of Object.entries(fieldMap)) {
        const deviceTimes = timers[deviceId];

        if (!deviceTimes) continue;

        const onInput = document.getElementById(fields.on);
        const offInput = document.getElementById(fields.off);

        if (onInput && typeof deviceTimes.on === "string") {
            onInput.value = deviceTimes.on;
        }

        if (offInput && typeof deviceTimes.off === "string") {
            offInput.value = deviceTimes.off;
        }
    }
}

function clearDeviceTimers() {
    try {
        localStorage.removeItem(DEVICE_TIMERS_KEY);

        // Remove previous execution records for these timers.
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);

            if (key && key.startsWith(TIMER_FIRED_PREFIX)) {
                localStorage.removeItem(key);
            }
        }
    } catch (error) {
        console.error("Could not clear device timers:", error);

        showTimerMessage(
            "Could not clear timer settings.",
            "error"
        );
        return;
    }

    const form = document.getElementById("deviceTimerForm");

    if (form) {
        form.reset();
    }

    updateTimerStatusText();

    showTimerMessage(
        "Timers cleared. Devices will no longer follow the saved schedule.",
        "success"
    );

    addEvent(
        "Device timers cleared",
        "Saved automatic ON and OFF times were removed.",
        "Success",
        "◷"
    );

    renderEvents();

    showToast("Automatic device timers cleared.");
}

function updateTimerStatusText() {
    const status = document.getElementById("timerStatusText");

    if (!status) return;

    try {
        const saved = localStorage.getItem(DEVICE_TIMERS_KEY);

        if (!saved) {
            status.textContent =
                "Timer settings have not been configured.";
            return;
        }

        const timers = JSON.parse(saved);

        status.textContent =
            "Daily timers are saved for the bedroom light, " +
            "living room light and fan. Keep this website open " +
            "for scheduled commands to run.";
    } catch (error) {
        status.textContent =
            "Timer settings could not be read.";
    }
}

function showTimerMessage(message, type) {
    const element = document.getElementById("timerMessage");

    if (!element) return;

    element.textContent = message;
    element.className = "message " + type;
}

function getDeviceName(deviceId) {
    const device = devices.find(item => item.id === deviceId);

    return device ? device.name : deviceId;
}

function getLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return year + "-" + month + "-" + day;
}

function getLocalTimeKey(date) {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return hours + ":" + minutes;
}

function checkDeviceTimers() {
    let timers;

    try {
        const saved = localStorage.getItem(DEVICE_TIMERS_KEY);

        if (!saved) return;

        timers = JSON.parse(saved);
    } catch (error) {
        console.error("Could not read device timers:", error);
        return;
    }

    if (!timers || typeof timers !== "object") return;

    const now = new Date();
    const today = getLocalDateKey(now);
    const currentTime = getLocalTimeKey(now);

    for (const deviceId of Object.keys(DEVICE_COMMANDS)) {
        const times = timers[deviceId];

        if (!times) continue;

        if (times.on === currentTime) {
            runScheduledDeviceCommand(
                deviceId,
                true,
                today
            );
        }

        if (times.off === currentTime) {
            runScheduledDeviceCommand(
                deviceId,
                false,
                today
            );
        }
    }
}

async function runScheduledDeviceCommand(deviceId, turnOn, dateKey) {
    const commandSet = DEVICE_COMMANDS[deviceId];

    if (!commandSet) return;

    const action = turnOn ? "on" : "off";

    const firedKey =
        TIMER_FIRED_PREFIX +
        dateKey + "_" +
        deviceId + "_" +
        action;

    // Do not send the same scheduled command more than once per day.
    try {
        if (localStorage.getItem(firedKey)) return;
    } catch (error) {
        console.error("Could not check timer execution record:", error);
        return;
    }

    // Prevent duplicate requests while a command is being sent.
    const progressKey = deviceId + "_" + action;

    if (timerCommandInProgress[progressKey]) return;

    timerCommandInProgress[progressKey] = true;

    // Mark this scheduled action before sending the request.
    // If it fails, remove the record so it can retry during this minute.
    try {
        localStorage.setItem(firedKey, "pending");
    } catch (error) {
        console.error("Could not record timer execution:", error);
        timerCommandInProgress[progressKey] = false;
        return;
    }

    const command = turnOn ? commandSet.on : commandSet.off;
    const device = devices.find(item => item.id === deviceId);

    try {
        showToast(
            "Timer: switching " + getDeviceName(deviceId) +
            (turnOn ? " on..." : " off...")
        );

        const response = await fetch(
            API_BASE + "/api/device-commands",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ command })
            }
        );

        const result = await readResponse(response);

        if (!response.ok) {
            throw new Error(
                result.message || "The server rejected the command."
            );
        }

        // Record that the command was successfully accepted.
        localStorage.setItem(firedKey, "done");

        if (device) {
            device.on = turnOn;
        }

        addEvent(
            "Automatic timer executed",
            getDeviceName(deviceId) +
            " was scheduled to switch " +
            (turnOn ? "on" : "off") +
            ". Command: " + command,
            "Success",
            device ? device.icon : "◷"
        );

        renderAllDevices();
        updateDashboard();
        renderEvents();

        showToast(
            getDeviceName(deviceId) +
            (turnOn
                ? " switched ON by timer."
                : " switched OFF by timer.")
        );

    } catch (error) {
        console.error(
            "Scheduled command failed for " + deviceId + ":",
            error
        );

        // Allow another attempt if the scheduled minute is still active.
        try {
            localStorage.removeItem(firedKey);
        } catch (storageError) {
            console.error(
                "Could not reset timer execution record:",
                storageError
            );
        }

        addEvent(
            "Automatic timer failed",
            "Could not send the scheduled command for " +
            getDeviceName(deviceId) + ".",
            "Warning",
            "!"
        );

        renderEvents();

        showToast(
            "Timer command failed for " + getDeviceName(deviceId) +
            ". Check the backend connection."
        );

    } finally {
        timerCommandInProgress[progressKey] = false;
    }
}

// =====================================================
// 13. DEVICE COUNTS
// =====================================================

function updateActiveDeviceCount() {
    setText("deviceCount", devices.length);

    setText(
        "activeCount",
        devices.filter(device => device.on).length
    );
}

// =====================================================
// 14. DASHBOARD
// =====================================================

function updateDashboard() {
    updateActiveDeviceCount();

    setText(
        "dashboardTemperature",
        formatNumber(currentTemperature, 1)
    );

    setText(
        "climateTemperature",
        formatNumber(currentTemperature, 1)
    );

    setText(
        "humidityValue",
        humidity === null ? "--" : humidity + "%"
    );

    setText("dashboardTarget", targetTemperature);

    setText(
        "securitySummary",
        doorLocked ? "Locked" : "Unlocked"
    );

    updateSensorDisplay();
    renderRecentEvents();
}

// =====================================================
// 15. CLIMATE CONTROL
// =====================================================

function updateClimateDisplay() {
    setText(
        "largeTemperature",
        formatNumber(currentTemperature, 1)
    );

    setText(
        "largeHumidity",
        humidity === null ? "--" : humidity
    );

    setText("targetDisplay", targetTemperature);
    setText("targetNumber", targetTemperature);
    setText("dashboardTarget", targetTemperature);
}

function updateTargetPreview() {
    const slider = document.getElementById("temperatureSlider");

    if (slider) {
        setText("targetNumber", slider.value);
    }
}

function saveTemperature() {
    const slider = document.getElementById("temperatureSlider");

    if (!slider) return;

    targetTemperature = Number(slider.value);

    updateClimateDisplay();
    updateDashboard();

    const message =
        document.getElementById("temperatureMessage");

    if (message) {
        message.textContent =
            "Target temperature saved to " +
            targetTemperature + "°C.";

        message.className = "message success";
    }

    addEvent(
        "Climate updated",
        "Target temperature set to " +
        targetTemperature + "°C.",
        "Success",
        "♨"
    );

    renderEvents();

    showToast(
        "Target temperature set to " +
        targetTemperature + "°C."
    );
}

// =====================================================
// 16. SENSOR DISPLAY INCLUDING PIR MOTION
// =====================================================

function updateSensorDisplay() {
    setText(
        "sensorTemperature",
        formatNumber(currentTemperature, 1)
    );

    setText(
        "sensorHumidity",
        humidity === null ? "--" : humidity
    );

    setText(
        "rainValue",
        rainValue === null ? "--" : rainValue
    );

    setText(
        "rainDetection",
        rainDetected === null
            ? "No data"
            : rainDetected
                ? "Rain detected"
                : "No rain detected"
    );

    setText(
        "rainStatus",
        rainDetected === null
            ? "Waiting..."
            : rainDetected
                ? "Rain detected"
                : "No rain"
    );

    setText(
        "distanceValue",
        formatNumber(distanceCm, 2)
    );

    setText(
        "distanceStatus",
        distanceCm === null
            ? "No data"
            : distanceCm < 10
                ? "Very close"
                : distanceCm < 30
                    ? "Object nearby"
                    : "Clear"
    );

    // PIR motion sensor
    setText("pirPin", PIR_GPIO_PIN);

    setText(
        "pirStatus",
        pirMotion === null
            ? "Waiting..."
            : pirMotion
                ? "Motion Detected"
                : "No Motion"
    );

    setText(
        "pirDetection",
        pirMotion === null
            ? "No data"
            : pirMotion
                ? "Motion detected"
                : "No motion detected"
    );

    setText(
        "pirValue",
        pirMotion === null
            ? "--"
            : pirMotion
                ? "HIGH"
                : "LOW"
    );

    setText(
        "lastSensorUpdate",
        lastSensorTimestamp
            ? new Date(lastSensorTimestamp).toLocaleString("en-ZA")
            : "Not received yet"
    );
}

// =====================================================
// 17. PIR VALUE CONVERSION
// =====================================================

function toBooleanOrNull(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
        return null;
    }

    if (typeof value === "string") {
        const normalised = value.trim().toLowerCase();

        if (
            [
                "true", "1", "high", "motion", "detected",
                "motion detected", "yes"
            ].includes(normalised)
        ) {
            return true;
        }

        if (
            [
                "false", "0", "low", "no motion", "clear",
                "not detected", "no"
            ].includes(normalised)
        ) {
            return false;
        }
    }

    return null;
}

function getPirValue(data) {
    const possibleFields = [
        "pir_motion",
        "motion_detected",
        "pir_value",
        "pir_status",
        "pir",
        "motion",
        "motion_detection",
        "pir_detected"
    ];

    for (const field of possibleFields) {
        if (
            Object.prototype.hasOwnProperty.call(data, field)
        ) {
            const value = toBooleanOrNull(data[field]);

            if (value !== null) {
                return value;
            }
        }
    }

    return null;
}

// =====================================================
// 18. LOAD SENSOR DATA FROM BACKEND
// =====================================================

async function loadLatestSensorReading() {
    const connectionStatus =
        document.getElementById("connectionStatus");

    const badge =
        document.getElementById("sensorConnectionBadge");

    try {
        const response = await fetch(
            API_BASE + "/api/sensors/latest",
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        const data = await response.json();

        if (
            !data ||
            typeof data !== "object" ||
            Array.isArray(data)
        ) {
            throw new Error("No sensor reading was returned.");
        }

        currentTemperature =
            toNumberOrNull(data.temperature);

        humidity =
            toNumberOrNull(data.humidity);

        rainValue =
            toNumberOrNull(data.rain_value);

        distanceCm =
            toNumberOrNull(data.distance_cm);

        pirMotion = getPirValue(data);

        if (typeof data.rain_detected === "boolean") {
            rainDetected = data.rain_detected;
        } else if (
            data.rain_detected === 0 ||
            data.rain_detected === 1
        ) {
            rainDetected = data.rain_detected === 1;
        } else if (
            typeof data.rain_detected === "string" &&
            ["true", "false"].includes(
                data.rain_detected.toLowerCase()
            )
        ) {
            rainDetected =
                data.rain_detected.toLowerCase() === "true";
        } else {
            rainDetected = null;
        }

        lastSensorTimestamp =
            data.recorded_at || data.timestamp || null;

        if (connectionStatus) {
            connectionStatus.textContent = "Backend connected";
        }

        if (badge) {
            badge.textContent = "LIVE SENSOR DATA";
        }

        setText("sensorUpdateStatus", "Data received");

        updateDashboard();
        updateClimateDisplay();

        console.log("Latest ESP32 sensor data:", data);

        if (pirMotion === true) {
            console.log("PIR sensor: Motion detected.");
        }

    } catch (error) {
        console.error("Could not load sensor data:", error);

        if (connectionStatus) {
            connectionStatus.textContent = "Connection problem";
        }

        if (badge) {
            badge.textContent = "SENSOR CONNECTION ISSUE";
        }

        setText("sensorUpdateStatus", "Unable to refresh");
    }
}

// =====================================================
// 19. LOAD RFID ACCESS EVENT
// =====================================================

async function loadLatestAccessEvent() {
    try {
        const response = await fetch(
            API_BASE + "/api/access-events/latest",
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        const data = await response.json();

        if (
            !data ||
            typeof data !== "object" ||
            Array.isArray(data)
        ) {
            return;
        }

        if (!data.card_uid || !data.event_type) {
            return;
        }

        lastCard = String(data.card_uid);

        const granted =
            data.access_granted === true ||
            data.access_granted === 1 ||
            String(data.access_granted).toLowerCase() === "true";

        lastAccessResult = granted
            ? "Access granted"
            : "Access denied";

        doorLocked = !granted;

        updateSecurityDisplay();
        updateDashboard();

    } catch (error) {
        console.warn(
            "Could not load latest RFID event:",
            error
        );
    }
}

// =====================================================
// 20. RFID DEMONSTRATION BUTTONS
// =====================================================

function simulateValidCard() {
    lastCard = "CARD-4821";
    lastAccessResult = "Access granted";
    doorLocked = false;

    addEvent(
        "RFID scan",
        "Demo authorised card " + lastCard +
        " granted access.",
        "Success",
        "⌑"
    );

    updateSecurityDisplay();
    updateDashboard();
    renderEvents();

    showToast("Demo access granted.");
}

function simulateInvalidCard() {
    lastCard = "CARD-9999";
    lastAccessResult = "Access denied";
    doorLocked = true;

    addEvent(
        "RFID scan",
        "Demo unknown card " + lastCard +
        " was denied.",
        "Warning",
        "!"
    );

    updateSecurityDisplay();
    updateDashboard();
    renderEvents();

    showToast("Demo access denied.");
}

function lockDoor() {
    doorLocked = true;
    lastAccessResult = "Door locked manually";

    addEvent(
        "Door locked",
        "Door was locked in the website demonstration.",
        "Success",
        "⌑"
    );

    updateSecurityDisplay();
    updateDashboard();
    renderEvents();

    showToast("Website door status set to locked.");
}

function updateSecurityDisplay() {
    setText("lastCard", lastCard);
    setText("lastAccessResult", lastAccessResult);

    const statusEl = document.getElementById("doorStatus");
    const infoEl = document.getElementById("doorStateInfo");

    if (!statusEl || !infoEl) return;

    const container = statusEl.closest(".door-status");

    if (doorLocked) {
        statusEl.textContent = "Door locked";
        infoEl.textContent = "Locked";

        if (container) {
            container.classList.remove("unlocked");
        }
    } else {
        statusEl.textContent = "Door unlocked";
        infoEl.textContent = "Unlocked";

        if (container) {
            container.classList.add("unlocked");
        }
    }
}

// =====================================================
// 21. EVENT HISTORY
// =====================================================

function addEvent(title, details, status, icon) {
    events.unshift({
        time: new Date().toLocaleTimeString("en-ZA", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }),
        title,
        details,
        status,
        icon
    });

    if (events.length > 40) {
        events.pop();
    }
}

function renderEvents() {
    const table = document.getElementById("historyTable");
    const empty = document.getElementById("emptyHistory");

    if (!table || !empty) return;

    table.innerHTML = "";

    if (events.length === 0) {
        empty.classList.remove("hidden");
        return;
    }

    empty.classList.add("hidden");

    events.forEach(event => {
        const row = document.createElement("tr");

        const time = document.createElement("td");
        time.textContent = event.time;

        const title = document.createElement("td");
        title.textContent = event.title;

        const details = document.createElement("td");
        details.textContent = event.details;

        const status = document.createElement("td");
        const badge = document.createElement("span");

        badge.className =
            "table-status" +
            (event.status === "Warning" ? " warning" : "");

        badge.textContent = event.status;
        status.appendChild(badge);

        row.append(time, title, details, status);
        table.appendChild(row);
    });
}

function renderRecentEvents() {
    const container = document.getElementById("dashboardEvents");

    if (!container) return;

    container.innerHTML = "";

    events.slice(0, 4).forEach(event => {
        const row = document.createElement("div");
        row.className = "event-row";

        const marker = document.createElement("div");
        marker.className = "event-marker";
        marker.textContent = event.icon || "•";

        const copy = document.createElement("div");
        copy.className = "event-copy";

        const title = document.createElement("h4");
        title.textContent = event.title;

        const details = document.createElement("p");
        details.textContent = event.details;

        copy.append(title, details);

        const time = document.createElement("span");
        time.className = "event-time";
        time.textContent = event.time;

        row.append(marker, copy, time);
        container.appendChild(row);
    });
}

function clearHistory() {
    events = [];

    renderEvents();
    renderRecentEvents();

    showToast("Event history cleared.");
}

// =====================================================
// 22. TOAST NOTIFICATIONS
// =====================================================

function showToast(message) {
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2600);
}

// =====================================================
// 23. HELPER FUNCTIONS
// =====================================================

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

async function readResponse(response) {
    try {
        return await response.json();
    } catch (error) {
        return {};
    }
}

function toNumberOrNull(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}

function formatNumber(value, decimals) {
    return value === null
        ? "--"
        : value.toFixed(decimals);
}

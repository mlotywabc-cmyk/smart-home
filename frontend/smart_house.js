
"use strict";

// =====================================================
// 1. SMART HOME BACKEND
// =====================================================

const API_BASE = "https://smart-home-b1p5.onrender.com";

// Demo login
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
let lastSensorTimestamp = null;

let targetTemperature = 23;
let doorLocked = true;
let lastCard = "None";
let lastAccessResult = "No scan yet";
let events = [];
let toastTimer;

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
    renderEvents();

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
        loginScreen.classList.add("hidden");
        app.classList.remove("hidden");

        loginMessage.textContent = "";

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
        loginMessage.textContent =
            "Incorrect username or password.";

        loginMessage.className = "message error";

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
    loginScreen.classList.remove("hidden");
    app.classList.add("hidden");

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

    const selectedPage = document.getElementById(pages[pageName]);

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

// Create device row on dashboard
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

// Create device card on Devices page
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
                body: JSON.stringify({
                    command: command
                })
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

// These command names MUST match the Arduino code.
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
        // Prevent repeated clicks while a command is being sent.
        if (button.disabled) return;

        const newState = !device.on;
        const commandSet = DEVICE_COMMANDS[device.id];

        // Physical lights and fan must receive backend commands.
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
                        body: JSON.stringify({
                            command: command
                        })
                    }
                );

                const result = await readResponse(response);

                if (!response.ok) {
                    throw new Error(
                        result.message ||
                        "The server rejected the command."
                    );
                }

                // Update the website after the backend accepts
                // the command. This does not confirm the physical
                // device has completed the action.
                device.on = newState;

                addEvent(
                    "Device command sent",
                    device.name + " was " +
                    (newState ? "switched on" : "switched off") +
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

        // Other switches without a configured hardware command
        // retain their original website-only behaviour.
        device.on = newState;

        addEvent(
            "Device updated",
            device.name + " was " +
            (device.on ? "switched on" : "switched off") + ".",
            "Success",
            device.icon
        );

        renderAllDevices();
        updateDashboard();
        renderEvents();

        showToast(
            device.name +
            (device.on ? " switched on." : " switched off.")
        );
    });

    return button;
}

// =====================================================
// 12. DEVICE COUNTS
// =====================================================

function updateActiveDeviceCount() {
    setText("deviceCount", devices.length);

    setText(
        "activeCount",
        devices.filter(device => device.on).length
    );
}

// =====================================================
// 13. DASHBOARD
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
// 14. CLIMATE CONTROL
// =====================================================

function updateClimateDisplay() {
    setText(
        "largeTemperature",
        formatNumber(currentTemperature, 1)
    );

    setText(
        "largeHumidity",
        humidity === null ? "--" : humidity + "%"
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
// 15. SENSOR DISPLAY
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

    setText(
        "lastSensorUpdate",
        lastSensorTimestamp
            ? new Date(lastSensorTimestamp).toLocaleString("en-ZA")
            : "Not received yet"
    );
}

// =====================================================
// 16. LOAD SENSOR DATA FROM RENDER
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

        currentTemperature = toNumberOrNull(data.temperature);
        humidity = toNumberOrNull(data.humidity);
        rainValue = toNumberOrNull(data.rain_value);
        distanceCm = toNumberOrNull(data.distance_cm);

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

        lastSensorTimestamp = data.recorded_at || null;

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
// 17. LOAD RFID ACCESS EVENT
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
// 18. RFID DEMONSTRATION BUTTONS
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
// 19. EVENT HISTORY
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
// 20. TOAST NOTIFICATIONS
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
// 21. HELPER FUNCTIONS
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

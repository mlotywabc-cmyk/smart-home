"use strict";

// Smart Home backend address
const API_BASE = "http://localhost:3000";

// Demo login details
const DEMO_USERNAME = "admin";
const DEMO_PASSWORD = "home123";

// Device data
const devices = [
    {
        id: "livingLight",
        name: "Living Room Light",
        room: "Living room",
        icon: "☀",
        on: true
    },
    {
        id: "bedroomLight",
        name: "Bedroom Light",
        room: "Bedroom",
        icon: "☼",
        on: false
    },
    {
        id: "fan",
        name: "Cooling Fan",
        room: "Living room",
        icon: "❄",
        on: true
    },
    {
        id: "securityLight",
        name: "Security Light",
        room: "Outside",
        icon: "⌑",
        on: false
    }
];

// State
let currentTemperature = 24.5;
let humidity = 55;
let targetTemperature = 23;
let doorLocked = true;
let lastCard = "None";
let lastAccessResult = "No scan yet";
let events = [];
let toastTimer;

// Cached DOM elements
const loginScreen = document.getElementById("loginScreen");
const app = document.getElementById("app");
const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
const toast = document.getElementById("toast");

// Start
document.addEventListener("DOMContentLoaded", initialiseWebsite);

function initialiseWebsite() {
    addEventListeners();

    updateClock();
    setInterval(updateClock, 1000);

    addEvent(
        "Website opened",
        "SmartHome demonstration started.",
        "Success",
        "⌂"
    );

    renderAllDevices();
    updateDashboard();
    updateClimateDisplay();
    renderEvents();

    // Load latest temperature + humidity from the backend
    loadLatestSensorReading();

    // Refresh sensor readings every 10 seconds
    setInterval(loadLatestSensorReading, 10000);
}

// Event listeners
function addEventListeners() {
    loginForm.addEventListener("submit", handleLogin);
    document.getElementById("logoutButton").addEventListener("click", logout);

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

    document.getElementById("temperatureSlider")
        .addEventListener("input", updateTargetPreview);

    document.getElementById("saveTemperature")
        .addEventListener("click", saveTemperature);

    document.getElementById("validRfidButton")
        .addEventListener("click", simulateValidCard);

    document.getElementById("invalidRfidButton")
        .addEventListener("click", simulateInvalidCard);

    document.getElementById("lockDoorButton")
        .addEventListener("click", lockDoor);

    document.getElementById("clearHistoryButton")
        .addEventListener("click", clearHistory);
}

// Login / logout
function handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (username === DEMO_USERNAME && password === DEMO_PASSWORD) {
        loginScreen.classList.add("hidden");
        app.classList.remove("hidden");

        loginMessage.textContent = "";
        document.getElementById("username").value = "";
        document.getElementById("password").value = "";

        addEvent("User login", "Administrator signed in.", "Success", "↪");

        updateDashboard();
        renderEvents();

        showToast("Welcome to your SmartHome dashboard.");
    } else {
        loginMessage.textContent = "Incorrect username or password.";
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

// Navigation
function showPage(pageName) {
    const pages = {
        dashboard: "dashboardPage",
        devices: "devicesPage",
        climate: "climatePage",
        security: "securityPage",
        history: "historyPage"
    };

    if (!pages[pageName]) {
        return;
    }

    Object.values(pages).forEach(id => {
        document.getElementById(id).classList.add("hidden");
    });

    document.getElementById(pages[pageName]).classList.remove("hidden");

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

    document.getElementById("pageTitle").textContent = titles[pageName];

    if (pageName === "history") {
        renderEvents();
    }
}

// Clock
function updateClock() {
    const now = new Date();

    document.getElementById("currentDate").textContent =
        now.toLocaleDateString("en-ZA", {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric"
        });

    document.getElementById("currentTime").textContent =
        now.toLocaleTimeString("en-ZA", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
}

// Devices
function renderAllDevices() {
    const allDevicesContainer = document.getElementById("allDevices");
    const dashboardDevices = document.getElementById("dashboardDevices");

    allDevicesContainer.innerHTML = "";
    dashboardDevices.innerHTML = "";

    devices.forEach(device => {
        allDevicesContainer.appendChild(createDeviceCard(device));
        dashboardDevices.appendChild(createDeviceRow(device));
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
    state.className = "device-state" + (device.on ? " on" : "");
    state.textContent = device.on ? "On" : "Off";

    const toggle = createToggle(device);

    row.append(icon, description, state, toggle);

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
    state.textContent = device.on ? "On" : "Off";

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
    statusText.textContent = device.on ? "Device is running" : "Device is off";

    const toggle = createToggle(device);

    bottom.append(statusText, toggle);
    card.append(top, name, room, bottom);

    return card;
}

function createToggle(device) {
    const button = document.createElement("button");

    button.className = "toggle" + (device.on ? " is-on" : "");
    button.type = "button";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-checked", String(device.on));
    button.setAttribute("aria-label", "Switch " + device.name);

    button.addEventListener("click", () => {
        device.on = !device.on;

        const action = device.on ? "switched on" : "switched off";

        addEvent(
            "Device updated",
            device.name + " was " + action + ".",
            "Success",
            device.icon
        );

        renderAllDevices();
        updateDashboard();
        renderEvents();

        showToast(device.name + " " + action + ".");
    });

    return button;
}

function updateActiveDeviceCount() {
    const activeCount = devices.filter(device => device.on).length;
    document.getElementById("deviceCount").textContent = devices.length;
    document.getElementById("activeCount").textContent = activeCount;
}

// Dashboard
function updateDashboard() {
    const activeCount = devices.filter(device => device.on).length;

    document.getElementById("deviceCount").textContent = devices.length;
    document.getElementById("activeCount").textContent = activeCount;

    document.getElementById("dashboardTemperature").textContent =
        currentTemperature.toFixed(1);

    document.getElementById("climateTemperature").textContent =
        currentTemperature.toFixed(1);

    document.getElementById("humidityValue").textContent = humidity + "%";
    document.getElementById("dashboardTarget").textContent = targetTemperature;

    document.getElementById("securitySummary").textContent =
        doorLocked ? "Secure" : "Unlocked";

    renderRecentEvents();
}

// Climate
function updateClimateDisplay() {
    document.getElementById("largeTemperature").textContent =
        currentTemperature.toFixed(1);

    document.getElementById("largeHumidity").textContent = humidity + "%";

    document.getElementById("targetDisplay").textContent = targetTemperature;
    document.getElementById("targetNumber").textContent = targetTemperature;
}

function updateTargetPreview() {
    const slider = document.getElementById("temperatureSlider");
    document.getElementById("targetNumber").textContent = slider.value;
}

function saveTemperature() {
    const slider = document.getElementById("temperatureSlider");
    targetTemperature = Number(slider.value);

    document.getElementById("targetDisplay").textContent = targetTemperature;
    document.getElementById("dashboardTarget").textContent = targetTemperature;

    const message = document.getElementById("temperatureMessage");
    message.textContent = "Target temperature saved to " + targetTemperature + "°C.";
    message.className = "message success";

    addEvent(
        "Climate updated",
        "Target temperature set to " + targetTemperature + "°C.",
        "Success",
        "♨"
    );

    renderEvents();
    showToast("Target temperature set to " + targetTemperature + "°C.");
}

// Security / RFID
function simulateValidCard() {
    lastCard = "CARD-4821";
    lastAccessResult = "Access granted";
    doorLocked = false;

    addEvent(
        "RFID scan",
        "Authorised card " + lastCard + " granted access.",
        "Success",
        "⌑"
    );

    updateSecurityDisplay();
    updateDashboard();
    renderEvents();

    showToast("Access granted. Door unlocked.");
}

function simulateInvalidCard() {
    lastCard = "CARD-9999";
    lastAccessResult = "Access denied";
    doorLocked = true;

    addEvent(
        "RFID scan",
        "Unknown card " + lastCard + " was denied.",
        "Warning",
        "!"
    );

    updateSecurityDisplay();
    updateDashboard();
    renderEvents();

    showToast("Access denied. Unknown card.");
}

function lockDoor() {
    doorLocked = true;
    lastAccessResult = "Door locked manually";

    addEvent(
        "Door locked",
        "Door was locked manually.",
        "Success",
        "⌑"
    );

    updateSecurityDisplay();
    updateDashboard();
    renderEvents();

    showToast("Door locked.");
}

function updateSecurityDisplay() {
    document.getElementById("lastCard").textContent = lastCard;
    document.getElementById("lastAccessResult").textContent = lastAccessResult;

    const statusEl = document.getElementById("doorStatus");
    const infoEl = document.getElementById("doorStateInfo");
    const dotEl = document.getElementById("doorStatusDot");
    const doorStatusContainer = statusEl.closest(".door-status");

    if (doorLocked) {
        statusEl.textContent = "Door locked";
        infoEl.textContent = "Locked";
        doorStatusContainer.classList.remove("unlocked");
    } else {
        statusEl.textContent = "Door unlocked";
        infoEl.textContent = "Unlocked";
        doorStatusContainer.classList.add("unlocked");
    }

    // dot is styled by CSS via .unlocked class, but keep reference tidy
    void dotEl;
}

// Events
function addEvent(title, details, status, icon) {
    events.unshift({
        time: new Date().toLocaleTimeString("en-ZA", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }),
        title: title,
        details: details,
        status: status,
        icon: icon
    });

    if (events.length > 40) {
        events.pop();
    }
}

function renderEvents() {
    const table = document.getElementById("historyTable");
    const empty = document.getElementById("emptyHistory");

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
        badge.className = "table-status" +
            (event.status === "Warning" ? " warning" : "");
        badge.textContent = event.status;
        status.appendChild(badge);

        row.append(time, title, details, status);
        table.appendChild(row);
    });
}

function renderRecentEvents() {
    const container = document.getElementById("dashboardEvents");
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

// Toast
function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2600);
}

// Backend: latest sensor reading
async function loadLatestSensorReading() {
    try {
        const response = await fetch(API_BASE + "/api/sensors/latest");

        if (!response.ok) {
            console.warn("Sensor endpoint returned", response.status);
            return;
        }

        const data = await response.json();

        if (typeof data.temperature === "number") {
            currentTemperature = data.temperature;
        }
        if (typeof data.humidity === "number") {
            humidity = data.humidity;
        }

        updateDashboard();
        updateClimateDisplay();
    } catch (error) {
        console.warn("Could not load sensor reading:", error.message);
    }
}
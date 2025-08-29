/* ====== CONFIG: set your deployed Apps Script web app URL here ====== */
const WEBAPP_URL = "https://script.google.com/macros/s/AKfycby53lLmhhhmeNRa-hzadJXyNaPyhAkntzjTs8hBmkzjXKOHggrwUyyeD1fIiFyC-W7r/exec"; // ← REPLACE
/* ================================================================== */

let currentUser = null;
let profile = { fullName: "", callsign: "" };
let rovingActive = false;
let journeys = []; // {timeInISO, timeOutISO, totalHours}
let candidate = null; // {timeInISO}
let html5QrcodeScanner = null;
let allowExtension = true;
let logoutTimerId = null;
let reminderTimerId = null;

/* UI refs */
const loginScreen = document.getElementById("login-screen");
const shiftScreen = document.getElementById("shift-screen");
const todayDateEl = document.getElementById("today-date");
const btnMorning = document.getElementById("btn-morning");
const btnAfternoon = document.getElementById("btn-afternoon");
const shiftSettings = document.getElementById("shift-settings");
const shiftStartEl = document.getElementById("shift-start");
const shiftEndEl = document.getElementById("shift-end");
const btnStartRoving = document.getElementById("btn-start-roving");
const rovingArea = document.getElementById("roving-area");
const rovingMeta = document.getElementById("roving-meta");
const journeyInfo = document.getElementById("journey-info");
const btnTimeIn = document.getElementById("btn-timein");
const btnTimeOut = document.getElementById("btn-timeout");
const btnAdd = document.getElementById("btn-add");
const rovingList = document.getElementById("roving-list");
const statusMsg = document.getElementById("status-msg");
const profileMini = document.getElementById("profile-mini");
const btnLogout = document.getElementById("btn-logout");
const logoutModal = document.getElementById("logout-modal");
const logoutCancel = document.getElementById("logout-cancel");
const logoutOk = document.getElementById("logout-ok");
const qrOverlay = document.getElementById("qr-overlay");
const qrCancel = document.getElementById("btn-qr-cancel");
const usernameEl = document.getElementById("username");
const passwordEl = document.getElementById("password");
const loginBtn = document.getElementById("btn-login");
const loginError = document.getElementById("login-error");
const reminderAudio = document.getElementById("reminder-audio");

/* events */
loginBtn.addEventListener('click', doLogin);
btnMorning.addEventListener('click', () => selectShift('Morning'));
btnAfternoon.addEventListener('click', () => selectShift('Afternoon'));
shiftStartEl.addEventListener('input', checkEnableStart);
shiftEndEl.addEventListener('input', checkEnableStart);
btnStartRoving.addEventListener('click', startRoving);
btnTimeIn.addEventListener('click', timeInFlow);
btnTimeOut.addEventListener('click', timeOutFlow);
btnAdd.addEventListener('click', () => { journeyInfo.textContent = "Press Time In to start next roving."; btnAdd.classList.add('hidden'); });
btnLogout.addEventListener('click', () => logoutModal.classList.remove('hidden'));
logoutCancel.addEventListener('click', () => logoutModal.classList.add('hidden'));
logoutOk.addEventListener('click', () => { logoutModal.classList.add('hidden'); doLogout(); });
qrCancel.addEventListener('click', cancelQr);

/* LOGIN */
async function doLogin() {
  loginError.textContent = "";
  const username = usernameEl.value.trim();
  const password = passwordEl.value.trim();
  if (!username || !password) { loginError.textContent = "Enter username & password"; return; }

  try {
    const res = await fetch(WEBAPP_URL, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ action: "login", username, password })
    });
    const data = await res.json();
    if (data.success) {
      currentUser = username;
      profile.fullName = data.fullName || username;
      profile.callsign = data.callsign || "";
      onLoggedIn();
    } else {
      loginError.textContent = "Invalid username or password";
    }
  } catch (err) {
    console.error(err);
    loginError.textContent = "Server connection failed";
  }
}

function onLoggedIn() {
  loginScreen.classList.add('hidden');
  shiftScreen.classList.remove('hidden');
  profileMini.textContent = profile.fullName + (profile.callsign ? ` (${profile.callsign})` : "");
  const today = new Date();
  todayDateEl.textContent = today.toLocaleDateString();
  shiftSettings.classList.add('hidden');
  btnStartRoving.disabled = true;
}

/* SHIFT */
let selectedShift = null;
function selectShift(shift) {
  selectedShift = shift;
  btnMorning.classList.toggle('active', shift === 'Morning');
  btnAfternoon.classList.toggle('active', shift === 'Afternoon');
  shiftSettings.classList.remove('hidden');
  checkEnableStart();
}
function checkEnableStart() {
  if (!selectedShift) { btnStartRoving.disabled = true; return; }
  const s = shiftStartEl.value;
  const e = shiftEndEl.value;
  btnStartRoving.disabled = !(s && e && (e > s));
}

/* START ROVING */
function startRoving() {
  if (!selectedShift) return alert("Select shift.");
  const date = new Date().toISOString().slice(0,10);
  const start = shiftStartEl.value;
  const end = shiftEndEl.value;
  if (!start || !end || end <= start) return alert("Invalid start/end times.");

  rovingActive = true;
  journeys = [];
  candidate = null;
  allowExtension = true;
  rovingArea.classList.remove('hidden');
  rovingMeta.textContent = `${date} • ${selectedShift} • ${start} → ${end}`;
  renderRovingList();
  scheduleReminderAndAutoLogout(date, start, end);
}

/* Reminder & Auto logout */
function scheduleReminderAndAutoLogout(date, startTime, endTime) {
  if (logoutTimerId) clearTimeout(logoutTimerId);
  if (reminderTimerId) clearTimeout(reminderTimerId);

  const endDT = new Date(`${date}T${endTime}`);
  const remindDT = new Date(endDT.getTime() - (10*60*1000));
  const now = new Date();

  if (remindDT > now) {
    reminderTimerId = setTimeout(() => {
      if (!rovingActive) return;
      try { navigator.vibrate && navigator.vibrate([200,100,200]); } catch(e){}
      try { reminderAudio.play(); } catch(e){}
      if (allowExtension) {
        const extend = confirm("Shift ending soon — require additional time? (can extend once)");
        if (extend) {
          const newEnd = prompt("Enter new shift end time (HH:MM) e.g. 18:30");
          if (newEnd && /^\d{2}:\d{2}$/.test(newEnd)) {
            const newEndDT = new Date(`${date}T${newEnd}`);
            if (newEndDT > endDT) {
              allowExtension = false;
              scheduleAutoLogout(newEndDT);
              alert("Shift extended until " + newEnd);
            } else alert("New end must be later than previous end.");
          }
        }
      }
    }, remindDT - now);
  }
  scheduleAutoLogout(endDT);
}
function scheduleAutoLogout(dt) {
  if (logoutTimerId) clearTimeout(logoutTimerId);
  const now = new Date();
  const ms = dt - now;
  if (ms <= 0) { doLogout(); return; }
  logoutTimerId = setTimeout(() => { if (rovingActive) { alert("Shift ended. You will be logged out."); doLogout(); } }, ms + 2000);
}

/* QR helpers */
function openQr() { qrOverlay.classList.remove('hidden'); }
function closeQr() { qrOverlay.classList.add('hidden'); }
async function startQrScan() {
  openQr();
  if (html5QrcodeScanner) return;
  html5QrcodeScanner = new Html5Qrcode("qr-reader");
  return new Promise((resolve, reject) => {
    html5QrcodeScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 },
      decoded => { resolve(decoded); stopQrScan(); },
      err => {}
    ).catch(err => { reject(err); closeQr(); });
  });
}
function stopQrScan() {
  if (!html5QrcodeScanner) { closeQr(); return; }
  html5QrcodeScanner.stop().then(() => { html5QrcodeScanner.clear(); html5QrcodeScanner = null; closeQr(); }).catch(e => { html5QrcodeScanner = null; closeQr(); });
}
function cancelQr() { if (html5QrcodeScanner) stopQrScan(); else closeQr(); }

/* Time-In */
async function timeInFlow() {
  if (!rovingActive) return alert("Start roving first.");
  try {
    btnTimeIn.disabled = true;
    const decoded = await startQrScan();
    if (!decoded) { btnTimeIn.disabled = false; return; }
    const timeIn = new Date().toISOString();
    candidate = { timeIn };
    journeyInfo.innerHTML = `<strong>Time In:</strong> ${new Date(timeIn).toLocaleTimeString()}`;
    btnTimeOut.disabled = false;
    btnAdd.classList.add('hidden');
  } catch (err) {
    console.error(err);
    alert("Camera/scanning failed.");
    btnTimeIn.disabled = false;
  }
}

/* Time-Out */
async function timeOutFlow() {
  if (!candidate) return alert("Press Time In first.");
  try {
    btnTimeOut.disabled = true;
    const decoded = await startQrScan();
    if (!decoded) { btnTimeOut.disabled = false; return; }
    const timeOut = new Date().toISOString();
    const totalHours = calcHours(candidate.timeIn, timeOut);
    const row = { Username: currentUser, TimeIn: candidate.timeIn, TimeOut: timeOut, TotalHours: totalHours, CreatedAt: new Date().toISOString() };
    journeys.push(row);
    renderRovingList();
    candidate = null;
    journeyInfo.innerHTML = `Saved: ${new Date(row.TimeIn).toLocaleTimeString()} → ${new Date(row.TimeOut).toLocaleTimeString()} (${row.TotalHours} hrs)`;
    btnTimeIn.disabled = false;
    btnTimeOut.disabled = true;
    btnAdd.classList.remove('hidden');
    // auto-save to backend (server will create/find per-shift Spreadsheet and append)
    await saveSimpleRowToServer(row);
  } catch (err) {
    console.error(err);
    alert("Camera/scanning failed.");
    btnTimeOut.disabled = false;
  }
}

function calcHours(inISO, outISO) {
  const a = new Date(inISO), b = new Date(outISO);
  const hrs = Math.round(((b - a)/(1000*60*60)) * 100) / 100;
  return hrs;
}

function renderRovingList() {
  rovingList.innerHTML = "";
  journeys.forEach(j => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${currentUser}</strong> • ${new Date(j.TimeIn).toLocaleTimeString()} - ${new Date(j.TimeOut).toLocaleTimeString()} <br/><small>Hours: ${j.TotalHours}</small>`;
    rovingList.appendChild(li);
  });
}

/* Save only username, timein, timeout, totalhours to per-shift spreadsheet */
async function saveSimpleRowToServer(row) {
  // include date and shift info so backend creates/opens the correct spreadsheet
  const payload = {
    action: "saveSimple",
    row: row,
    Date: new Date().toISOString().slice(0,10),
    Shift: selectedShift
  };
  try {
    await fetch(WEBAPP_URL, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
    statusMsg.textContent = "Saved ✔";
  } catch (err) {
    console.error(err);
    statusMsg.textContent = "Save failed — will retry next scan.";
  }
}

/* Logout / doLogout */
function doLogout() {
  if (logoutTimerId) clearTimeout(logoutTimerId);
  if (reminderTimerId) clearTimeout(reminderTimerId);
  if (html5QrcodeScanner) { html5QrcodeScanner.stop().catch(()=>{}); html5QrcodeScanner = null; }
  currentUser = null;
  profile = { fullName: "", callsign: "" };
  rovingActive = false;
  journeys = [];
  candidate = null;
  // UI reset
  usernameEl.value = "";
  passwordEl.value = "";
  loginError.textContent = "";
  shiftScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  rovingArea.classList.add('hidden');
  statusMsg.textContent = "";
  alert("Signed out.");
}

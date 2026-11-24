"use strict";

const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");

function revealTerminalText(element, delay = 0) {
  if (motionPreference.matches) return;
  const steps = element.textContent.length;
  element.animate([
    { clipPath: "inset(0 100% 0 0)" },
    { clipPath: "inset(0 0% 0 0)" }
  ], { duration: Math.min(steps * 32, 560), delay, easing: "steps(" + steps + ", end)", fill: "backwards" });
}

const shiftTitle = document.querySelector(".shift-title");
function scrambleShiftTitle() {
  if (motionPreference.matches) return;
  const title = shiftTitle.textContent;
  const glyphs = "#%*+/<>=";
  const start = performance.now();
  function frame() {
    const resolved = Math.floor((performance.now() - start) / 45);
    if (resolved >= title.length || motionPreference.matches) {
      shiftTitle.textContent = title;
      return;
    }
    shiftTitle.textContent = Array.from(title, (letter, i) =>
      i < resolved || letter === " " ? letter : glyphs[Math.floor(Math.random() * glyphs.length)]
    ).join("");
    setTimeout(frame, 45);
  }
  frame();
}
const titleObserver = new IntersectionObserver(entries => {
  if (entries.some(entry => entry.isIntersecting)) {
    scrambleShiftTitle();
    titleObserver.disconnect();
  }
});
titleObserver.observe(shiftTitle);

function showConnection() {
  const terminal = document.querySelector(".connection");
  const address = document.querySelector("#client-ip");
  const status = document.querySelector("#access-state");
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  let run = 0;
  let ip;
  let feedbackTimer;
  const feedback = terminal.querySelector(".ip-feedback");
  function placeFeedback(x, y) {
    feedback.style.left = Math.max(4, Math.min(x + 10, document.documentElement.clientWidth - feedback.offsetWidth - 4)) + "px";
    feedback.style.top = (y + 14 + feedback.offsetHeight <= innerHeight ? y + 14 : Math.max(4, y - feedback.offsetHeight - 8)) + "px";
  }
  let followPointer = false;
  document.addEventListener("pointermove", event => {
    if (followPointer && feedback.textContent) placeFeedback(event.clientX, event.clientY);
  }, { passive: true });
  address.addEventListener("click", async event => {
    const bounds = address.getBoundingClientRect();
    const x = event.detail ? event.clientX : bounds.left;
    const y = event.detail ? event.clientY : bounds.bottom;
    const current = run;
    let message = "✓ COPIED";
    try {
      await navigator.clipboard.writeText(ip);
    } catch {
      message = "COPY UNAVAILABLE";
    }
    if (current !== run) return;
    feedback.textContent = message;
    followPointer = event.detail > 0;
    placeFeedback(x, y);
    revealTerminalText(feedback);
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { feedback.textContent = ""; }, 1250);
  });

  function stage(phase, message) {
    address.hidden = !(ip && ["address", "allowed", "guest"].includes(phase));
    terminal.dataset.phase = phase;
    status.textContent = message;
    if (message) revealTerminalText(status);
  }

  async function lookup() {
    try {
      const response = await fetch("https://api64.ipify.org?format=json", {
        credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return null;
      const { ip } = await response.json();
      if (typeof ip !== "string") return null;
      if (ip.includes(":") && /^[0-9a-f:.]{2,45}$/i.test(ip)) {
        new URL("http://[" + ip + "]/");
        return ip;
      }
      return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split(".").every(n => +n <= 255) ? ip : null;
    } catch {
      return null;
    }
  }

  async function connect() {
    const current = ++run;
    terminal.getAnimations().forEach(animation => animation.cancel());
    const line = terminal.querySelector(".connection-line");
    line.getAnimations().forEach(animation => animation.cancel());
    ip = null;
    feedback.textContent = "";
    if (!navigator.onLine) {
      stage("offline", "offline mode");
      return;
    }
    stage("request", "requesting client IP...");
    const [result] = await Promise.all([lookup(), wait(1100)]);
    if (current !== run) return;
    ip = result;
    if (ip) {
      address.textContent = "IP: " + ip;
      stage("address", "");
      revealTerminalText(address);
      await wait(1150);
      if (current !== run) return;
      // Keep the address in place while its approval label is revealed.
      stage("allowed", "IP ALLOWED");
    } else {
      stage("masked", "IP MASKED");
    }
    await wait(1250);
    if (current !== run) return;
    stage("checking", "SSH checking...");
    await wait(1100);
    if (current !== run) return;
    stage("pass", "SSH PASS");
    await wait(950);
    if (current !== run) return;
    const animateGuest = !motionPreference.matches;
    const startWidth = terminal.getBoundingClientRect().width;
    if (animateGuest) {
      const fade = line.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-out", fill: "forwards" });
      await fade.finished.catch(() => {});
      if (current !== run) return;
      fade.cancel();
    }
    if (ip) address.textContent = "guest ip: " + ip;
    stage("guest", ip ? "" : "guest ip: masked");
    if (animateGuest) {
      const endWidth = terminal.getBoundingClientRect().width;
      terminal.animate([{ width: startWidth + "px" }, { width: endWidth + "px" }], {
        duration: 310, easing: "ease-in-out"
      });
      line.animate([{ opacity: 0 }, { opacity: 1 }], {
        delay: 310, duration: 160, easing: "ease-out", fill: "backwards"
      });
    }
  }
  window.addEventListener("online", connect);
  window.addEventListener("offline", connect);
  connect();
}
showConnection();
function ageOn(date) {
  const beforeBirthday = date.getMonth() === 0
    || (date.getMonth() === 1 && date.getDate() < 9);
  return date.getFullYear() - 1995 - Number(beforeBirthday);
}

const age = ageOn(new Date());
for (const label of document.querySelectorAll("#age, #expanded-age")) label.textContent = age;

const clockFace = document.querySelector("#clock-face");
const display = clockFace.getContext("2d");
const birth = Date.parse("1995-02-09T00:00:00+03:00");
const segments = [
  [7, 1, 50, 14], [52, 9, 14, 40], [52, 57, 14, 40],
  [7, 92, 50, 14], [-1, 57, 14, 40], [-1, 9, 14, 40], [7, 46, 50, 14]
];
const digitSegments = ["012345", "12", "01643", "01623", "5612", "05623",
  "056432", "012", "0123456", "012356"];

function drawClock() {
  const seconds = Math.floor((Date.now() - birth) / 1000);
  const digits = String(seconds % 1000).padStart(3, "0");
  display.fillStyle = "#100d10";
  display.fillRect(0, 0, clockFace.width, clockFace.height);
  display.save();
  display.translate(16, 14);
  display.fillStyle = "#eb172f";
  display.shadowColor = "#f61831";
  display.shadowBlur = 16;
  for (const digit of digits) {
    for (const segment of digitSegments[Number(digit)]) {
      display.fillRect(...segments[Number(segment)]);
    }
    display.translate(83, 0);
  }
  display.restore();
}

if (display) {
  drawClock();
  window.setInterval(drawClock, 2230);
}

const profileAnchor = document.querySelector(".profile-anchor");
const profileTrigger = document.querySelector(".profile-trigger");
const profileCard = document.querySelector("#profile-card");
const profileClose = document.querySelector(".card-close");
const tenureNumber = profileCard.querySelector(".tenure-number");
function yearOfERPWork(date) {
  return Math.max(0, date.getFullYear() - 2022 + Number(date.getMonth() >= 6));
}
const tenure = yearOfERPWork(new Date());
const numberWords = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const tenureWord = numberWords[tenure] || String(tenure);
for (const label of document.querySelectorAll("[data-tenure]")) label.textContent = tenureWord;
tenureNumber.style.width = tenureWord.length + "ch";
tenureNumber.textContent = tenureWord;

let tenureTimer;

function setProfileOpen(open) {
  if (profileCard.hidden === !open) return;
  profileCard.hidden = !open;
  document.body.classList.toggle("profile-open", open);
  clearTimeout(tenureTimer);
  tenureNumber.textContent = tenureWord;
  if (open) {
    function toggleTenure() {
      if (motionPreference.matches) { tenureNumber.textContent = tenureWord; return; }
      tenureNumber.textContent = tenureNumber.textContent === tenureWord ? String(tenure) : tenureWord;
      tenureNumber.animate([
        { transform: "translateX(-1px)", textShadow: "2px 0 #5090cb" },
        { transform: "translateX(1px)", textShadow: "-2px 0 #c94456" },
        { transform: "none", textShadow: "none" }
      ], 140);
      tenureTimer = setTimeout(toggleTenure, tenureNumber.textContent === String(tenure) ? 500 : 3000);
    }
    tenureTimer = setTimeout(toggleTenure, 3000);
  }
  profileTrigger.setAttribute("aria-expanded", String(open));
}

profileTrigger.addEventListener("click", () => {
  setProfileOpen(true);
  profileClose.focus({ preventScroll: true });
});
function closeProfile() {
  setProfileOpen(false);
  profileTrigger.focus({ preventScroll: true });
}
profileClose.addEventListener("click", closeProfile);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileCard.hidden) closeProfile();
});
document.addEventListener("pointerdown", (event) => {
  if (!profileAnchor.contains(event.target)) setProfileOpen(false);
});
profileAnchor.addEventListener("focusout", (event) => {
  if (!profileAnchor.contains(event.relatedTarget)) setProfileOpen(false);
});

for (const button of document.querySelectorAll(".copy-contact")) {
  let resetTimer;
  button.addEventListener("click", async () => {
    const status = document.querySelector("#copy-result");
    try {
      await navigator.clipboard.writeText(button.dataset.value);
      status.textContent = "Copied " + button.dataset.value;
      button.classList.add("copied");
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => button.classList.remove("copied"), 1000);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(button.nextElementSibling);
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = "Clipboard unavailable. Copy the selected contact manually.";
    }
  });
}

const dashboardTip = document.querySelector("#dashboard-tip");
function showDashboardTip(block, x, y) {
  const progress = document.querySelector(".plan-track progress");
  const target = Math.round(progress.max * .92);
  const gap = target - progress.value;
  const label = "Plan by now: " + target + " operations (92%). " + (gap === 0 ? "On plan." : Math.abs(gap) + " operations " + (gap > 0 ? "behind" : "ahead of") + " plan.");
  placeDashboardTip(label,x,y);
}
function placeDashboardTip(label,x,y) {
  dashboardTip.textContent = label;
  dashboardTip.hidden = false;
  const bounds = dashboardTip.getBoundingClientRect();
  dashboardTip.style.left = Math.max(8, Math.min(x + 14, innerWidth - bounds.width - 8)) + "px";
  dashboardTip.style.top = (y + 18 + bounds.height <= innerHeight - 8 ? y + 18 : Math.max(8, y - bounds.height - 10)) + "px";
}
function hideDashboardTip() { dashboardTip.hidden = true; }
for (const block of document.querySelectorAll("[data-tip]")) {
  block.setAttribute("aria-describedby", dashboardTip.id);
  block.addEventListener("pointermove", event => {
    if (event.pointerType !== "touch") showDashboardTip(block, event.clientX, event.clientY);
  });
  block.addEventListener("focus", () => {
    const rect = block.getBoundingClientRect();
    showDashboardTip(block, rect.left, rect.top);
  });
  block.addEventListener("pointerleave", hideDashboardTip);
  block.addEventListener("blur", hideDashboardTip);
}
document.addEventListener("keydown", event => {
  if (event.key === "Escape") hideDashboardTip();
});
window.addEventListener("scroll", hideDashboardTip, true);


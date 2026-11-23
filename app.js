"use strict";

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
  window.setInterval(drawClock, 2000);
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
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
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
  const target = Math.round(Number(document.querySelector("#shift-total").textContent) * .92);
  const gap = target - Number(document.querySelector("#output-count").textContent);
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


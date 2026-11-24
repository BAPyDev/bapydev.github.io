"use strict";

const stages = [
  { id: "start", label: "Start", icon: "M7 4l11 8-11 8z", inputs: [], done: [] },
  { id: "supply", label: "Parts supply", icon: "M3 7l9-4 9 4-9 5z M3 7v10l9 5 9-5V7 M12 12v10", inputs: [], done: [] },
  { id: "blanks", label: "Blank preparation", icon: "M2 8l10-5 10 5-10 5z M2 12l10 5 10-5 M2 16l10 5 10-5", inputs: [], done: [] },
  { id: "assembly", label: "Assembly", icon: "M3 8h8v8H3z M13 4h8v8h-8z M12 17h9v4h-9z", inputs: ["supply","blanks"], done: [] },
  { id: "pack", label: "Packaging", icon: "M3 6h18v14H3z M3 10h18 M10 6v5h4V6", inputs: ["assembly"], done: [] }
];
const milestones = ["Approval", "Parts delivery", "Production launch", "Inspection"];
const orderStatuses = ["Awaiting approval", "Approved", "Parts received", "In production", "Awaiting inspection", "Ready"];
const orders = [
  { id: 248, size: 8, completed: 3, deliveryLate: true },
  { id: 249, size: 42, completed: 5 },
  { id: 250, size: 12, completed: 5 }
];


for (const order of orders) {
  order.numbers = Array.from({length: order.size}, (_, i) => i + 1);
  order.route = new Map(stages.map(stage => [stage.id, {...stage, done: order.completed === 5 && stage.id !== "start" ? [...order.numbers] : order.completed === 3 ? [...stage.done] : []}]));
}
let selectedOrder = orders[0];
let byId = selectedOrder.route;

const routePicker = document.querySelector("#route-order");
function chooseOrder(order) {
  hideDashboardTip();
  flow.querySelectorAll(".route-crate").forEach(crate => crate.remove());
  const available = orders.filter(o => o.completed >= 3);
  selectedOrder = available.includes(order) ? order : available[0];
  routePicker.replaceChildren(...available.map(o => new Option("WO-0" + o.id, o.id)));
  flow.replaceChildren();
  routePicker.disabled = !selectedOrder;
  if (!selectedOrder) { feedback.textContent = "No orders released to production."; renderBatch(); return; }
  byId = selectedOrder.route;
  routePicker.value = String(selectedOrder.id);
  buildRoute();
  feedback.textContent = "";
  renderBatch();
}
routePicker.onchange = () => chooseOrder(orders.find(order => String(order.id) === routePicker.value));

const flow = document.querySelector(".flow");
const feedback = document.querySelector(".route-message");
document.addEventListener("pointerdown", event => {
  if (!event.target.closest(".unit-group")) flow.querySelectorAll(".unit-group[open]").forEach(group => { group.open = false; });
});
function limit(stage) {
  return Math.min(selectedOrder.size, ...stage.inputs.map(id => Math.max(0, ...byId.get(id).done)));
}

function connector(paths, sources = []) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox","0 0 100 30");
  svg.setAttribute("preserveAspectRatio","none");
  svg.setAttribute("aria-hidden","true");
  svg.classList.add("route-wire");
  for (const [index, shape] of paths.entries()) {
    const path = document.createElementNS(svg.namespaceURI,"path");
    path.setAttribute("d",shape);
    if (sources[index]) path.dataset.from = sources[index];
    svg.append(path);
  }
  flow.append(svg);
}

function station(stage) {
  const box = document.createElement("section");
  box.className = "station " + stage.id;
  box.innerHTML = '<h4><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + stage.icon + '"/></svg>' + stage.label + '</h4><div class="unit-rail"></div>';
  const rail = box.querySelector(".unit-rail");
  if (stage.id === "start") { rail.remove(); flow.append(box); return; }
  rail.setAttribute("aria-label",stage.label + " units");
  let container = rail;
  const grouped = selectedOrder.size > 8;
  const groupSize = selectedOrder.size > 20 ? 10 : 5;
  rail.classList.toggle("grouped", grouped);
  for (let n=1; n<=selectedOrder.size; n++) {
    if (grouped && (n-1) % groupSize === 0) {
      const end = Math.min(n + groupSize - 1, selectedOrder.size);
      const group = document.createElement("details");
      group.className = "unit-group";
      group.name = "production-unit-groups";
      group.dataset.first = n;
      group.dataset.last = end;
      const summary = document.createElement("summary");
      summary.innerHTML = '<span>' + n + '&ndash;' + end + '</span><small></small>';
      container = document.createElement("div");
      container.className = "group-units";
      group.append(summary, container);
      rail.append(group);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(n).padStart(2,"0");
    button.insertAdjacentHTML("beforeend", '<svg class="unit-check" viewBox="0 0 12 12" aria-hidden="true"><path pathLength="1" d="M2 6l2.5 2.5L10 3"/></svg>');
    button.dataset.unit = n;
    button.setAttribute("aria-label",stage.label + ", unit " + n);
    button.onclick = () => toggleUnit(byId.get(stage.id),n);
    container.append(button);
  }
  flow.append(box);
}
function focusNextUnit() {
  const next = flow.querySelector('[data-unit][aria-pressed="false"]:not(.locked)');
  if (!next) return;
  const group = next.closest(".unit-group");
  if (group) group.open = true;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "center", behavior: motionPreference.matches ? "instant" : "smooth" });
  next.animate([
    { outline: "2px solid #a6caff", backgroundColor: "#354b66", offset: 0 },
    { outline: "2px solid #a6caff", backgroundColor: "#354b66", offset: .75 },
    { outline: "2px solid transparent", backgroundColor: "transparent" }
  ], 1600);
}

function buildRoute() {
station(stages[0]);
connector(["M50 0V12H25V30","M50 0V12H75V30"]);
station(stages[1]);
station(stages[2]);
connector(["M25 0V16H50V30","M75 0V16H50V30"], ["supply","blanks"]);
station(stages[3]);
connector(["M50 0V30"], ["assembly"]);
station(stages[4]);
connector(["M50 0V30"], ["pack"]);
const inspection = document.createElement("a");
inspection.className = "inspection-destination";
inspection.href = "#order-" + selectedOrder.id;
inspection.textContent = "Inspection ↗";
inspection.addEventListener("click", event => {
  if (selectedOrder.completed === 3) {
    event.preventDefault();
    focusNextUnit();
  }
});
flow.append(inspection);
}

function sendCrate(id, reverse = false, delay = 0) {
  const path = flow.querySelector('[data-from="' + id + '"]');
  if (!path || motionPreference.matches) return;
  const svg = path.ownerSVGElement;
  const crate = document.createElementNS(svg.namespaceURI, "rect");
  const width = 9 * 100 / svg.getBoundingClientRect().width;
  if (!Number.isFinite(width)) return;
  crate.setAttribute("width",width);
  crate.setAttribute("height","9");
  crate.setAttribute("class","route-crate");
  svg.append(crate);
  const length = path.getTotalLength();
  const start = performance.now() + delay;
  crate.style.visibility = "hidden";
  function move(now) {
    if (!crate.isConnected) return;
    if (now < start) { requestAnimationFrame(move); return; }
    crate.style.visibility = "visible";
    const t = Math.min(1,(now-start)/720);
    const point = path.getPointAtLength((reverse ? 1 - t : t)*length);
    crate.setAttribute("x",point.x-width/2);
    crate.setAttribute("y",point.y-4.5);
    if (t < 1 && crate.isConnected) requestAnimationFrame(move);
    else crate.remove();
  }
  requestAnimationFrame(move);
}

function sendCrates(id, count, reverse = false, delay = 0) {
  if (!count || motionPreference.matches) return;
  const spacing = Math.min(105, 900 / count);
  for (let i = 0; i < count; i++) sendCrate(id, reverse, delay + i * spacing);
}

function toggleUnit(stage,n) {
  const blockers = stage.inputs.map(id => byId.get(id)).filter(input => Math.max(0,...input.done) < n);
  if (blockers.length) {
    feedback.textContent = "Unit " + n + " needs " + blockers.map(s => s.label).join(" and ") + ".";
    for (const input of blockers) {
      const target = flow.querySelector("." + input.id + ' [data-unit="' + n + '"]');
      const group = target.closest(".unit-group");
      if (group) group.open = true;
      target.getAnimations().forEach(animation => animation.cancel());
      target.animate(motionPreference.matches ? [{outline:"2px solid #ff7881"},{outline:"2px solid transparent"}] :
        [{transform:"translateY(0)"},{transform:"translateY(-5px)",background:"#803742"},{transform:"translateY(0)"}],450);
    }
    return;
  }
  const completing = !stage.done.includes(n);
  const before = stage.done.length;
  stage.done = selectedOrder.numbers.slice(0, completing ? n : n - 1);
  const changed = Math.abs(stage.done.length - before);
  if (completing) sendCrates(stage.id, changed);
  let reset = 0;
  const affected = new Set([stage.id]);
  const returns = [];
  for (const next of byId.values()) {
    const allowed = limit(next);
    const valid = next.done.filter(unit => unit <= allowed);
    reset += next.done.length - valid.length;
    if (valid.length < next.done.length) {
      for (const input of next.inputs) {
        if (affected.has(input) && input !== stage.id) returns.push({id:input, count:next.done.length - valid.length});
      }
      affected.add(next.id);
    }
    next.done = valid;
  }
  if (!completing) {
    returns.reverse().forEach((edge, index) => sendCrates(edge.id, edge.count, true, index * 720));
    sendCrates(stage.id, changed, true, returns.length * 720);
  }
  feedback.textContent = stage.label + " / " + n + (stage.done.includes(n) ? " complete." : " reopened.") +
    (reset ? " Reopened downstream units: " + reset + "." : "");
  renderBatch();
  if (completing && !motionPreference.matches) {
    for (let unit = before + 1; unit <= n; unit++) {
      const check = flow.querySelector("." + stage.id + ' [data-unit="' + unit + '"] .unit-check path');
      check.animate([{strokeDashoffset: "1"}, {strokeDashoffset: "0"}], {
        duration: 230, delay: Math.min(unit - before - 1, 7) * 24, easing: "ease-out", fill: "backwards"
      });
    }
  }
  if (stage.id === "pack" && completing && stage.done.length === selectedOrder.size) {
    feedback.textContent = "Batch packed · ";
    const inspect = document.createElement("a");
    inspect.href = "#order-" + selectedOrder.id;
    inspect.textContent = "Open inspection for WO-0" + selectedOrder.id;
    feedback.append(inspect);
    if (!motionPreference.matches) {
      flow.querySelector(".station.pack").animate([
        {borderColor: "#303b49"}, {borderColor: "#97deba", backgroundColor: "#204638", offset: .3},
        {borderColor: "#303b49", backgroundColor: "#111720"}
      ], {duration: 800, easing: "ease-out"});
    }
  }

}

function completion(order) {
  const work = [...order.route.values()].filter(stage => stage.id !== "start");
  const done = work.reduce((sum, stage) => sum + stage.done.length, 0);
  const total = order.size * work.length;
  return {done, total, percent: Math.round(100 * done / total)};
}

function dashboardCounter(id, digits = 1) {
  const element = document.getElementById(id);
  let displayed = Number(element.textContent);
  let target = displayed;
  let timer;

  function step() {
    if (displayed === target) return;
    const previous = displayed;
    displayed = motionPreference.matches ? target : displayed + Math.sign(target - displayed);
    const text = String(displayed).padStart(digits, "0");
    if (digits === 2 && !motionPreference.matches) {
      element.dataset.previous = String(previous).padStart(digits, "0");
      const next = document.createElement("span");
      next.textContent = text;
      element.replaceChildren(next);
      element.classList.add("rolling");
      next.addEventListener("animationend", () => element.classList.remove("rolling"), { once: true });
    } else {
      element.textContent = text;
    }
    if (displayed !== target) timer = setTimeout(step, 75);
  }

  return value => {
    if (value === target) return;
    clearTimeout(timer);
    target = value;
    step();
  };
}

const setShiftPercent = dashboardCounter("percent");
const setOutputCount = dashboardCounter("output-count");
const setShiftTotal = dashboardCounter("shift-total");
const setActiveOrders = dashboardCounter("active-orders", 2);
const setExceptions = dashboardCounter("exceptions", 2);
function renderBatch() {
  for (const stage of selectedOrder ? byId.values() : []) {
    if (stage.id === "start") continue;
    const rail = flow.querySelector("." + stage.id + " .unit-rail");
    const available = limit(stage);
    for (const group of rail.querySelectorAll(".unit-group")) {
      const count = +group.dataset.last - +group.dataset.first + 1;
      const done = stage.done.filter(n => n >= +group.dataset.first && n <= +group.dataset.last).length;
      group.querySelector("small").textContent = done + "/" + count;
      group.querySelector("summary").setAttribute("aria-label", "Units " + group.dataset.first + " to " + group.dataset.last + ", " + done + " of " + count + " ready");
      group.classList.toggle("all-ready", done === count);
    }
    for (const button of rail.querySelectorAll("[data-unit]")) {
      const n = Number(button.dataset.unit);
      const position = stage.done.indexOf(n);

      button.setAttribute("aria-pressed", String(position >= 0));
      button.classList.toggle("locked",n > available);
    }
  }
  if (selectedOrder) {
    const finished = completion(selectedOrder).percent === 100 && [...byId.values()].every(stage => stage.id === "start" || stage.done.length === selectedOrder.size);
    selectedOrder.completed = finished ? Math.max(4, selectedOrder.completed) : 3;
  }
  orders.forEach(order => order.refresh());
  const orderLink = document.querySelector("#route-order-link");
  orderLink.href = selectedOrder ? "#order-" + selectedOrder.id : "#orders";
  orderLink.textContent = selectedOrder ? "View WO-0" + selectedOrder.id : "View work orders";
  orderLink.onclick = () => { if (selectedOrder) document.getElementById("order-" + selectedOrder.id).open = true; };
  const exceptions = orders.filter(order => order.deliveryLate).length;
  setExceptions(exceptions);
  document.querySelector("#exceptions").parentElement.classList.toggle("exception",exceptions > 0);
  const counts = orders.map(completion);
  const total = counts.reduce((sum, order) => sum + order.total, 0);
  const done = counts.reduce((sum, order) => sum + order.done, 0);
  setOutputCount(done);
  setShiftTotal(total);
  const bar = document.querySelector(".plan-track progress");
  bar.max = total;
  bar.value = done;
  setShiftPercent(Math.floor(100*done/total));

}

function createOrder(order) {
  const details = document.createElement("details");
  details.className = "work-order";
  details.id = "order-" + order.id;
  details.open = order.completed < 5;
  const summary = document.createElement("summary");
  const number = document.createElement("strong");
  number.textContent = "WO-" + String(order.id).padStart(4, "0");
  const operation = document.createElement("span");
  operation.textContent = order.size + " units";
  const status = document.createElement("span");
  status.className = "order-state";
  status.setAttribute("aria-live", "polite");
  summary.append(number, operation, status);
  const list = document.createElement("ol");
  list.className = "milestones";
  const running = document.createElement("a");
  running.href = "#line";
  running.onclick = () => chooseOrder(order);
  running.className = "production-running";
  running.textContent = "Production in progress";
  details.append(summary, list, running);
  if (order.deliveryLate) {
    const notice = document.createElement("div");
    notice.className = "delivery-notice";
    const content = document.createElement("div");
    content.className = "delivery-content";
    const message = document.createElement("span");
    message.textContent = "Bearing delivery delayed for this batch.";
    const label = document.createElement("strong");
    label.textContent = "EXCEPTION";
    message.prepend(label);
    const receive = document.createElement("button");
    receive.type = "button";
    receive.textContent = "Confirm receipt";
    receive.onclick = async () => {
      order.deliveryLate = false;
      const height = notice.offsetHeight;
      notice.style.height = height + "px";
      content.textContent = "Exception 01 · Resolved ✓";
      content.classList.add("resolved");
      details.querySelector("summary").focus({ preventScroll: true });
      renderBatch();
      await new Promise(resolve => setTimeout(resolve, 1400));
      if (!motionPreference.matches) {
        await notice.animate([{ height: height + "px", opacity: 1 }, { height: "0px", opacity: 0 }],
          { duration: 300, easing: "ease-in-out", fill: "forwards" }).finished;
      }
      notice.remove();
    };
    content.append(message, receive);
    notice.append(content);
    details.append(notice);
  }
  for (const [index, label] of milestones.entries()) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const mark = document.createElement("span");
    mark.className = "milestone-mark";
    mark.setAttribute("aria-hidden", "true");
    button.append(mark, label);
    item.append(button);
    list.append(item);
    button.onclick = () => {
      if (index === 3 && order.completed >= 4) {
        order.completed = order.completed === 5 ? 4 : 5;
        order.refresh();
        return;
      }
      if (index >= 3 && order.completed === 3) {
        chooseOrder(order);
        focusNextUnit();
        return;
      }
      if (index > order.completed) {
        const needed = list.children[order.completed].firstElementChild;
        needed.focus({ preventScroll: true });
        needed.getAnimations().forEach(animation => animation.cancel());
        needed.animate(motionPreference.matches ? [{opacity:.55},{opacity:1}] :
          [{transform:"translateY(0)"},{transform:"translateY(-5px)"},{transform:"translateY(0)"}], 320);
        return;
      }
      order.completed = index === order.completed ? index + 1 : index;
      if (order.completed < 3) for (const stage of order.route.values()) stage.done = [];
      chooseOrder(order.completed >= 3 ? order : selectedOrder);
      update();
    };
  }
  function update() {
    const progress = completion(order);
    running.textContent = "Production in progress · " + progress.percent + "% (" + progress.done + "/" + progress.total + " operations)";
    running.hidden = order.completed !== 3;
    details.classList.toggle("order-ready", order.completed === 5);
    status.textContent = orderStatuses[order.completed] + (order.deliveryLate ? " / Delivery delayed" : "");
    Array.from(list.children).forEach((item, index) => {
      const done = index >= 3 ? order.completed === 5 : index < order.completed;
      item.classList.toggle("done", done);
      const button = item.firstElementChild;
      button.setAttribute("aria-pressed", String(done));
      button.setAttribute("aria-disabled", String(index < 3 && index > order.completed));
      button.firstElementChild.textContent = done ? "✔" : "";
    });
    setActiveOrders(orders.filter(o => o.completed < 5).length);
  }
  order.refresh = update;
  update();
  document.querySelector("#work-orders").append(details);
}
orders.forEach(createOrder);
chooseOrder(selectedOrder);

const sectionLinks = [...document.querySelectorAll(".views a")];
function highlightSection() {
  const cutoff = document.querySelector(".views").offsetHeight + 20;
  const current = sectionLinks.slice(1).filter(link => document.querySelector(link.hash).getBoundingClientRect().top <= cutoff).at(-1) || sectionLinks[0];
  for (const link of sectionLinks) {
    if (link === current) link.setAttribute("aria-current","location");
    else link.removeAttribute("aria-current");
  }
}
function openLinkedOrder(hash) {
  const details = document.getElementById(hash.slice(1));
  if (details?.matches("details.work-order")) details.open = true;
}
document.addEventListener("click", event => {
  const link = event.target.closest('a[href^="#order-"]');
  if (link && !event.defaultPrevented) openLinkedOrder(link.hash);
});
window.addEventListener("hashchange", () => openLinkedOrder(location.hash));
window.addEventListener("scroll",highlightSection,{passive:true});
openLinkedOrder(location.hash);
highlightSection();

function hintUnit(event) {
  const button = event.target.closest("[data-unit]");
  if (!button || event.pointerType === "touch") return hideDashboardTip();
  const n = Number(button.dataset.unit);
  const label = button.classList.contains("locked") ? "Show required previous step" :
    button.getAttribute("aria-pressed") === "true" ? "Reopen from unit " + n : "Mark ready through unit " + n;
  placeDashboardTip(label,event.clientX,event.clientY);
}
flow.addEventListener("pointermove",hintUnit);
flow.addEventListener("pointerleave",hideDashboardTip);
flow.addEventListener("click",event => {
  if (event.detail && event.target.closest("[data-unit]")) hintUnit(event);
});

const overview = document.querySelector("#overview");
const metricRow = overview.querySelector(".metrics");
const sidebar = document.querySelector("#shift-sidebar");
const desktop = matchMedia("(min-width: 701px)");
let pastOverview = false;
function positionShiftOverview() {
  const inSidebar = desktop.matches && pastOverview;
  if (inSidebar === (metricRow.parentElement === sidebar)) return;
  if (inSidebar) {
    setProfileOpen(false);
    hideDashboardTip();
    sidebar.hidden = false;
    profileAnchor.hidden = true;
    overview.style.height = overview.offsetHeight + "px";
    sidebar.append(metricRow);
  } else {
    overview.append(metricRow);
    overview.style.height = "";
    sidebar.hidden = true;
    profileAnchor.hidden = false;
  }
}
new IntersectionObserver(([entry]) => {
  pastOverview = entry.boundingClientRect.top < 0 && !entry.isIntersecting;
  positionShiftOverview();
}).observe(document.querySelector("#shift-sentinel"));
desktop.addEventListener("change", positionShiftOverview);

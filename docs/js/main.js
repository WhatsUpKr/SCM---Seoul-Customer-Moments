// main.js: state, the animation loop and the wiring between the map and the panels.

import { clamp, prepare, assign, sceneOf } from "./model.js";
import { t, setLang, getLang, applyStatic } from "./i18n.js";
import { createCity, NOON } from "./city.js";
import { $, resetCache, buildWeek, tick, renderScene, renderCard, sizeGrid, drawGrid, wireGrid, renderTable, renderQuestion, renderStatic } from "./panels.js";
import { initLab, renderLab } from "./lab.js";
import { initLive, renderLive } from "./live.js";

const SPEEDS = [1, 2, 4], DAY_MS = 10000;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const view = { scene: 0, t: reduce ? .52 : .1, playing: !reduce, speed: 0, speedX: 1, lens: "dash", filter: null, sel: null, hover: null, mode: "msg", ended: false, live: false };
let world, city, sv, last = 0, clockMs = 0, dirty = true;

function refresh() { sv = sceneOf(world, view); renderScene(world, view, sv); dirty = true; }
function toStage() { $("stage").scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" }); }
function rebuild() { city.refresh(); buildWeek(world); renderTable(world); }

const actions = {
  now: () => clockMs,
  go(scene, tt) { view.scene = clamp(scene, 0, world.scenes.length - 1); view.t = clamp(tt, 0, .999); view.ended = false; refresh(); },
  select(i, reveal) {
    view.sel = i; resetCache(); renderCard(world, view, sv); drawGrid(world, view); dirty = true;
    if (reveal && i != null) $("who").scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  },
  watchSaturday() { if (!world.hasOutcomes) return; Object.assign(view, { live: false, mode: "msg", lens: "dash", filter: null, playing: !reduce }); actions.go(world.nDays, reduce ? .5 : .12); toStage(); },
  startTest(set) { assign(world, set); rebuild(); Object.assign(view, { live: false, mode: "msg", lens: "dash", filter: null, playing: !reduce }); actions.go(0, reduce ? .52 : .06); renderLab(); toStage(); },
  endTest() { assign(world, null); rebuild(); refresh(); renderLab(); },
  startLive() { Object.assign(view, { live: true, playing: false, sel: null, filter: null, lens: "dash" }); refresh(); toStage(); },
  endLive() { view.live = false; world.live = null; refresh(); renderLive(); },
  liveUpdate() { if (view.live) refresh(); },
};

function frame(now) {
  const dt = Math.min(now - last, 80); last = now;
  const moving = view.playing || view.live;
  if (moving) clockMs += dt;
  if (view.playing && !view.live) {
    const rate = sv.kind === "shop" ? 1.5 : view.t > NOON + .04 && view.t < NOON + .34 ? .38 : 1.75;   // linger on the afternoon, when thoughts appear
    view.t += dt / DAY_MS * SPEEDS[view.speed] * rate;
    if (view.t >= 1) {
      if (view.scene < world.scenes.length - 1) actions.go(view.scene + 1, 0);
      else { Object.assign(view, { playing: false, t: .58, ended: true }); refresh(); }
    }
  }
  if (moving || dirty) { dirty = false; city.place(view, sv, clockMs); city.draw(view, sv, clockMs); tick(world, view, sv, city, clockMs); }   // nothing moves, nothing is redrawn
  requestAnimationFrame(frame);
}

function applyLang(l) {
  setLang(l); document.documentElement.lang = getLang();
  try { localStorage.setItem("scm-lang", getLang()); } catch { /* storage can be unavailable: the choice then lasts for this visit */ }
  applyStatic(document); renderStatic(world); buildWeek(world); city.paintStatic(); renderQuestion(world, actions); renderLab(); renderLive(); sizeGrid(world, view); refresh();
}

function wire() {
  const cv = $("city");
  $("lang").onclick = () => applyLang(getLang() === "ko" ? "en" : "ko");
  $("play").onclick = () => { if (view.ended) { view.playing = true; actions.go(0, .06); } else { view.playing = !view.playing; refresh(); } };
  $("speed").onclick = () => { view.speed = (view.speed + 1) % SPEEDS.length; view.speedX = SPEEDS[view.speed]; refresh(); };
  $("lens").onclick = e => { const b = e.target.closest("button"); if (b) { view.lens = b.dataset.l; view.filter = null; refresh(); } };
  $("legend").onclick = e => { const b = e.target.closest("button"); if (b) { view.filter = view.filter === b.dataset.k ? null : b.dataset.k; refresh(); } };
  $("worlds").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    view.mode = b.dataset.w; view.filter = null;
    if (view.t > .5 || view.ended) Object.assign(view, { t: reduce ? .5 : .12, ended: false, playing: !reduce });   // replay the shopping trips in the other world
    refresh();
  };
  $("banner").onclick = e => { const b = e.target.closest("button"); if (b) actions[b.dataset.act](); };
  $("thoughts").onclick = e => { const li = e.target.closest("li[data-i]"); if (li) actions.select(+li.dataset.i, true); };
  $("bubble").onclick = e => (e.target.id === "bubbleClose" ? actions.select(null) : actions.select(+$("bubble").dataset.i, true));
  $("who").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.d != null) { const d = +b.dataset.d; actions.go(d, world.scenes[d].type === "shop" ? .45 : NOON + .2); }
    else if (b.dataset.nav === "0") actions.select(null);
    else if (b.dataset.nav) actions.select((view.sel + +b.dataset.nav + world.people.length) % world.people.length);
  };
  $("sort").onchange = () => sizeGrid(world, view);
  wireGrid(world, view, actions);
  cv.onclick = e => { const p = city.pick(e.clientX, e.clientY); actions.select(p ? p.i : null, false); };
  cv.onpointermove = e => { if (e.pointerType === "touch") return; const p = city.pick(e.clientX, e.clientY), h = p ? p.i : null; if (h !== view.hover) { view.hover = h; dirty = true; } };
  cv.onpointerleave = () => { if (view.hover != null) { view.hover = null; dirty = true; } };
  // the week strip is a slider: position is time
  const wk = $("week"); let drag = false, was = false;
  const seek = e => { const b = wk.getBoundingClientRect(), f = clamp((e.clientX - b.left - 8) / (b.width - 16), 0, .9999) * world.scenes.length; actions.go(Math.floor(f), f % 1); };
  wk.onpointerdown = e => { if (view.live) return; drag = true; was = view.playing; view.playing = false; wk.setPointerCapture(e.pointerId); seek(e); };
  wk.onpointermove = e => { if (drag) seek(e); };
  wk.onpointerup = wk.onpointercancel = () => { if (drag) { drag = false; view.playing = was; refresh(); } };
  wk.onkeydown = e => {
    const step = { ArrowRight: .1, ArrowLeft: -.1, PageDown: 1, PageUp: -1 }[e.key]; if (step == null || view.live) return;
    e.preventDefault(); const f = clamp(view.scene + view.t + step, 0, world.scenes.length - .001); actions.go(Math.floor(f), f % 1);
  };
  document.addEventListener("keydown", e => {
    if (e.key === " " && !/^(BUTTON|INPUT|SELECT|TEXTAREA|A|CANVAS|SUMMARY)$/.test(document.activeElement.tagName) && document.activeElement.id !== "week") { e.preventDefault(); $("play").click(); }
    if (e.key === "Escape" && view.sel != null) actions.select(null);
  });
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { city.layout(world); sizeGrid(world, view); refresh(); }, 150); });
  const themed = () => { drawGrid(world, view); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", themed);
  new MutationObserver(themed).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function start(data, saved) {
  world = prepare(data); city = createCity($("city"), $("stage"));
  let stored = null; try { stored = localStorage.getItem("scm-lang"); } catch { /* no storage */ }
  setLang(saved.lang || stored || ((navigator.language || "").toLowerCase().startsWith("ko") ? "ko" : "en"));
  document.documentElement.lang = getLang();
  if (Number.isInteger(saved.scene)) Object.assign(view, { scene: clamp(saved.scene, 0, world.scenes.length - 1), t: clamp(+saved.t || 0, 0, .999), lens: saved.lens || "dash", mode: saved.mode || "msg" });
  city.layout(world); sv = sceneOf(world, view);
  applyStatic(document); renderStatic(world); buildWeek(world); wire(); sizeGrid(world, view); renderQuestion(world, actions); initLab(world, actions); refresh();
  initLive(world, actions);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { city.paintStatic(); dirty = true; });
  const hot = window.claude && window.claude.hot;       // keep a viewer's place when the artifact is republished
  if (hot && hot.snapshot) hot.snapshot(() => ({ scene: view.scene, t: view.t, lens: view.lens, mode: view.mode, lang: getLang() }));
  requestAnimationFrame(n => { last = n; frame(n); });
}

const inline = $("scm-data").textContent.trim();
(inline ? Promise.resolve(JSON.parse(inline)) : fetch("data.json").then(r => r.json()))
  .then(data => { const hot = window.claude && window.claude.hot; if (hot && hot.ready) hot.ready(s => start(data, s || {})); else start(data, (hot && hot.data) || {}); })
  .catch(err => { $("msg").innerHTML = `<h2>${t("loadFail")}</h2><p class="small">${t("loadHelp")}</p>`; console.error(err); });

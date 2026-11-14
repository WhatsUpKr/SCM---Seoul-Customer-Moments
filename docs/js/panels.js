// panels.js: everything around the map. Week strip, legend, figures, narrator, the resident's phone, thoughts, week grid, Saturday question.

import { t, day, channel, district, data as val, num, getLang } from "./i18n.js";
import { clamp, stateOf, dashKey, dayCounts, shopCounts, legendOf, categoryOf, shops, measure, liveCounts } from "./model.js";
import { COL, NOON, PULSE, LIVE_T, moodColor, trustColor } from "./city.js";

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clock = t => { const h = 7 + t * 15; return String(Math.floor(h)).padStart(2, "0") + ":" + String(Math.floor(h % 1 * 6) * 10).padStart(2, "0"); };
const ROLE = { click: "var(--s-click)", open: "var(--s-open)", none: "var(--s-none)", exit: "var(--s-exit)", truth: "var(--s-truth)", idle: "var(--s-idle)",
  trust0: trustColor(.1), trust1: trustColor(.5), trust2: trustColor(.9), mood0: moodColor(.15), mood1: moodColor(.5), mood2: moodColor(.9) };
/** A legend swatch shaped like the mark it stands for. */
export const dot = role => (ROLE[role] ? `<i class="dot" style="background:${ROLE[role]}"></i>` : `<i class="dot ${role}"></i>`);
const stateDot = k => dot(k === "error" ? "err" : k === "pending" ? "idle" : k);
export const whoLine = p => t("who", { num: String(p.i + 1).padStart(2, "0"), district: district(p.a.district), age: val(p.a.age_band) });
/** What happened, in words. An exit the dice decided against the resident's own answer says so. */
const whatOf = (s, live) => t("what." + (s.k !== "exit" ? s.k : live ? "wantout" : s.r && s.r.action !== "unsubscribe" ? "exitDice" : "exit"));

let cache = {};
export const resetCache = () => { cache = {}; };
function setHTML(id, html) { if (cache[id] !== html) { cache[id] = html; $(id).innerHTML = html; } }
function setText(id, s) { if (cache[id] !== s) { cache[id] = s; $(id).textContent = s; } }

/* ---------- a small tooltip shared by the grid and the charts ---------- */
export const tip = {
  show(text, x, y) { const el = $("tip"); el.textContent = text; el.hidden = false; const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = clamp(x - w / 2, 6, innerWidth - w - 6) + "px"; el.style.top = (y - h - 12 < 6 ? y + 16 : y - h - 12) + "px"; },
  hide() { $("tip").hidden = true; },
};

/* ---------- week strip: one thin bar per day, what the dashboard records ---------- */
export function buildWeek(world) {
  const wk = $("week"); wk.querySelectorAll(".day").forEach(el => el.remove());
  const n = world.people.length, cols = world.scenes.map((sc, i) => {
    let parts, title;
    if (sc.type === "shop") { const c = shopCounts(world, "msg"); parts = [["click", c.credit], ["truth", c.shop]]; title = `${t("lg.credit")} ${c.credit} · ${t("lg.shop")} ${c.shop} · ${t("lg.stay")} ${c.stay}`; }
    else { const c = dayCounts(world, sc.d), none = c.none + c.fedup + c.error; parts = [["click", c.click], ["open", c.open], ["none", none], ["exit", c.exit]];
      title = `${t("lg.click")} ${c.click} · ${t("lg.open")} ${c.open} · ${t("lg.none")} ${none} · ${t("lg.exit")} ${c.exit} · ${t("lg.gone")} ${c.gone + c.holdout}`; }
    const used = parts.reduce((s, x) => s + x[1], 0);
    return `<div class="day" data-i="${i}" title="${esc(title)}"><span class="d">${day(i)}<span class="ch">${sc.type === "shop" ? channel("shop") : esc(channel(world.messages[sc.d].channel))}</span></span>` +
      `<span class="bar">${parts.filter(x => x[1]).map(([k, v]) => `<i style="flex:${v};background:${ROLE[k]}"></i>`).join("")}${n - used ? `<i class="rest" style="flex:${n - used}"></i>` : ""}</span></div>`;
  });
  wk.insertAdjacentHTML("afterbegin", cols.join("")); wk.setAttribute("aria-valuemax", world.scenes.length - 1);
}

/* ---------- everything that follows the clock ---------- */
export function tick(world, view, sv, city, clockMs) {
  const live = sv.kind === "live", shop = sv.kind === "shop", tt = live ? LIVE_T : view.t, people = world.people, act = people.filter(p => !p.silent), d = sv.d;
  const m = live ? world.live.message : world.messages[d], ch = channel(m.channel), nS = world.scenes.length;
  setText("hudDay", live ? t("hudLive") : day(view.scene) + " " + clock(tt));
  setText("hudNote", live ? ch : shop ? t(view.mode === "msg" ? "hudShop" : "hudShopSilent") : t(tt < NOON ? "hudBefore" : "hudAfter", { ch }));
  $("playhead").style.left = `calc(8px + (100% - 16px) * ${(view.scene + view.t) / nS})`;
  if (cache.vnow !== view.scene) { cache.vnow = view.scene; $("week").setAttribute("aria-valuenow", view.scene); $("week").setAttribute("aria-valuetext", t("dayLong")[view.scene % 7]); }
  const rev = k => act.filter(p => p.g.rev && stateOf(world, sv, p).k === k).length;
  let tiles, narr;
  if (live) {
    const c = liveCounts(world);
    tiles = [[`${c.done}<small>/${c.total}</small>`, t("tile.answered")], [c.open + c.click, t("tile.opened")], [c.click, t("tile.clicked")], [c.exit, t("tile.wantout")]];
    narr = t("narr.live", { done: c.done, n: c.total });
  } else if (shop) {
    const M = measure(world), bought = people.filter(p => shops(p, view.mode)).length, last = dayCounts(world, world.nDays - 1);
    tiles = view.mode === "msg"
      ? [[bought, t("tile.shoppers")], [M.click_attributed, t("tile.credited")], [act.filter(p => p.buy[0]).length, t("tile.anyway")], [M.truth_net, t("tile.caused")]]
      : [[bought, t("tile.shoppers")], [0, t("tile.sent")], [0, t("tile.noclicks")], [last.messaged, t("tile.reachable", { a: last.messaged - last.left })]];
    narr = view.mode === "msg" ? t("narr.shopMsg", { b: bought, c: M.click_attributed }) : t("narr.shopSilent", { b: bought });
  } else {
    const c = dayCounts(world, d), opened = rev("open") + rev("click"), clicked = rev("click"), left = c.gone + rev("exit");
    tiles = [[`${c.reach}<small>/${c.messaged}</small>`, t("tile.reach")], [opened, t("tile.opened")], [clicked, t("tile.clicked")], [left, t("tile.left")]];
    narr = tt < .1 ? t("narr.dawn", { reach: c.reach, n: c.messaged }) : tt < NOON ? t("narr.out", { ch }) : tt < NOON + PULSE ? t("narr.pulse", { ch })
      : tt < .68 ? t("narr.after", { opened: c.open + c.click, clicked: c.click, left: c.exit, wanted: c.fedup }) : t("narr.evening", { gone: c.left, n: c.messaged });
  }
  if (world.experiment && !live) narr = t("narr.test", { s: world.experiment.size }) + narr;
  setHTML("tiles", tiles.map(([v, l]) => `<div class="tile"><strong>${v}</strong><span>${esc(l)}</span></div>`).join(""));
  setText("narr", narr);
  // thoughts
  let feed;
  if (shop) feed = `<li class="small still">${esc(t("thoughtsShop"))}</li>`;
  else {
    const seen = act.filter(p => p.g.rev && (stateOf(world, sv, p).r || {}).diary && stateOf(world, sv, p).k !== "gone")
      .sort((a, b) => (live ? stateOf(world, sv, b).at - stateOf(world, sv, a).at : b.g.hitT - a.g.hitT)).slice(0, 5);
    feed = seen.length ? seen.map(p => { const s = stateOf(world, sv, p); return `<li data-i="${p.i}"><div class="lh">${stateDot(s.k)}<b>${esc(whoLine(p))}</b><span>${esc(whatOf(s, live))}</span></div><q>${esc(s.r.diary)}</q></li>`; }).join("")
      : `<li class="small still">${esc(t("thoughtsEmpty"))}</li>`;
  }
  setHTML("thoughts", feed);
  bubble(world, view, sv, city, clockMs);
}

function bubble(world, view, sv, city, clockMs) {
  const el = $("bubble"), live = sv.kind === "live"; let p = view.sel == null ? null : world.people[view.sel], text = "", auto = false;
  if (p) {
    const s = stateOf(world, sv, p);
    text = sv.kind === "shop" ? t(shops(p, view.mode) ? "bub.shops" : "bub.stays") : s.k === "holdout" ? t("bub.holdout") : s.k === "gone" ? t("bub.gone")
      : s.k === "pending" ? t("bub.pending") : !p.g.rev ? t("bub.notYet") : s.r && s.r.diary ? "“" + s.r.diary + "”" : whatOf(s, live) + ".";
  } else {
    p = city.spotlight(view, sv, clockMs);
    if (p) { let dz = stateOf(world, sv, p).r.diary; if (dz.length > 96) dz = dz.slice(0, dz.lastIndexOf(" ", 92)) + "…"; text = "“" + dz + "”"; auto = true; }
  }
  if (!p) { if (!el.hidden) { el.hidden = true; cache.bub = ""; } return; }
  const key = p.i + text + getLang();
  if (cache.bub !== key) {
    cache.bub = key; const k = sv.kind === "shop" ? null : stateOf(world, sv, p).k;
    $("bubbleHead").innerHTML = (k && (p.g.rev || k === "gone" || k === "holdout") ? stateDot(dashKey(k)) : "") + `<b>${esc(whoLine(p))}</b>`;
    $("bubbleText").textContent = text; $("bubbleClose").hidden = auto; el.dataset.i = p.i; el.hidden = false;
  }
  const a = city.anchor(p), sw = $("stage").clientWidth, bw = el.offsetWidth, bh = el.offsetHeight, left = clamp(a.x - bw / 2, 8, sw - bw - 8), above = a.y - a.r * 3.4 - bh > 34;
  el.style.left = left + "px"; el.style.top = (above ? a.y - a.r * 3.4 - bh - 6 : a.y + a.r + 12) + "px"; el.classList.toggle("below", !above); el.style.setProperty("--ax", clamp(a.x - left, 14, bw - 14) + "px");
}

/* ---------- everything that changes with the scene, the lens, the language or the selection ---------- */
export function renderScene(world, view, sv) {
  const live = sv.kind === "live", shop = sv.kind === "shop", m = live ? world.live.message : world.messages[sv.d];
  const note = (title, meta, text, gloss) => `<h2>${esc(title)}</h2><div class="note"><div class="appicon" aria-hidden="true" lang="ko">하</div><div><p class="meta">${esc(meta)}</p><p class="txt"${live ? "" : ' lang="ko"'}>${esc(text)}</p>${gloss ? `<p class="small">${esc(gloss)}</p>` : ""}</div></div>`;
  $("msg").innerHTML = live ? note(t("liveMsgTitle"), t("msgMeta", { ch: channel(m.channel) }), m.text)
    : shop ? `<h2>${esc(t("satTitle"))}</h2><p>${esc(t("satBody", { m: world.nDays }))}</p><p class="small">${esc(t("satNote"))}</p>`
      : note(t("msgTitle", { day: t("dayLong")[view.scene % 7] }), t("msgMeta", { ch: channel(m.channel) }), m.text, getLang() === "ko" ? "" : m.en);
  $("worlds").hidden = !shop;
  document.querySelectorAll("#worlds button").forEach(b => b.setAttribute("aria-pressed", b.dataset.w === view.mode));
  const banner = $("banner"); banner.hidden = !(live || world.experiment);
  if (!banner.hidden) banner.innerHTML = `<span>${esc(live ? t("hudLive") : t("testOn", { s: world.experiment.size }))}</span><button type="button" data-act="${live ? "endLive" : "endTest"}">${esc(live ? t("live.back") : t("testEnd"))}</button>`;
  $("week").classList.toggle("off", live);
  document.querySelectorAll("#week .day").forEach((el, i) => el.setAttribute("aria-current", !live && i === view.scene));
  document.querySelectorAll("#lens button").forEach(b => { b.setAttribute("aria-pressed", b.dataset.l === view.lens); b.textContent = t("lens." + b.dataset.l); });
  $("lensnote").textContent = view.lens === "dash" ? (live ? t("note.live") : shop ? t(view.mode === "msg" ? "note.shopMsg" : "note.shopSilent") : t("note.dash")) : t("note." + view.lens);
  const list = legendOf(sv).map(([k, role]) => [k, role, world.people.filter(p => categoryOf(world, sv, p) === k).length]).filter(c => c[2] || !["holdout", "gone", "nomood", "pending"].includes(c[0]));
  if (view.filter && !list.some(c => c[0] === view.filter)) view.filter = null;
  const label = k => t("lg." + (k === "shop" && view.mode === "silent" ? "shopSilent" : k === "exit" && live ? "wantout" : k));
  $("legend").innerHTML = list.map(([k, role, n]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="${view.filter === k}">${dot(role)}${esc(label(k))} <span class="n">${n}</span></button>`).join("");
  $("play").textContent = t(view.playing ? "pause" : view.ended ? "replay" : "play"); $("play").disabled = live;
  $("speed").textContent = t("speed", { x: view.speedX });
  renderCard(world, view, sv); drawGrid(world, view);
  cache.tiles = cache.thoughts = cache.bub = cache.narr = null;
}

export function renderCard(world, view, sv) {
  const el = $("who"), p = view.sel == null ? null : world.people[view.sel];
  if (!p) { el.innerHTML = `<h2>${esc(t("whoEmptyTitle"))}</h2><p class="small">${esc(t("whoEmpty"))}</p>`; return; }
  const a = p.a, live = sv.kind === "live", shopIdx = world.hasOutcomes ? world.nDays : -1;
  const item = (cur, attr, icon, meta, text, k, r) => `<li class="${cur ? "now" : ""}"><button type="button" ${attr}><span class="appicon sm" aria-hidden="true" lang="ko">${icon}</span><span class="nb"><span class="meta">${esc(meta)}</span><span class="txt">${esc(text)}</span></span></button>` +
    (k ? `<div class="react">${stateDot(k)}<span>${esc(whatOf({ k, r }, live))}</span>${r && typeof r.annoyance === "number" ? `<span class="num">${esc(t("annoyance", { v: r.annoyance }))}</span>` : ""}</div>` : "") +
    (r && r.diary && k !== "gone" && k !== "error" ? `<q>${esc(r.diary)}</q>` : "") + `</li>`;
  let rows;
  if (live) { const s = stateOf(world, sv, p), m = world.live.message; rows = item(true, "disabled", "하", t("msgMeta", { ch: channel(m.channel) }), m.text, s.k, s.r); }
  else {
    rows = world.messages.map((m, i) => item(sv.kind === "day" && i === sv.d, `data-d="${i}"`, "하", `${t("msgMeta", { ch: channel(m.channel) })} · ${day(i)}`, m.text, p.S[i].k, p.S[i].r)).join("");
    if (shopIdx >= 0) { const b1 = p.buy[p.silent ? 0 : 1], b0 = p.buy[0];
      rows += item(sv.kind === "shop", `data-d="${shopIdx}"`, day(shopIdx), t("dayLong")[shopIdx % 7], t(b1 ? "satShops" : "satNot") + (p.silent ? "" : " " + t(b0 === b1 ? (b0 ? "silentSameYes" : "silentSameNo") : (b0 ? "silentDiffYes" : "silentDiffNo")))); }
  }
  const meter = (label, v) => `<div class="meter"><span>${esc(label)}</span><span class="track"><i style="width:${Math.round(v * 100)}%"></i></span><span class="v">${v.toFixed(2)}</span></div>`;
  el.innerHTML = `<div class="head"><div><h2>${esc(t("whoHead", { num: String(p.i + 1).padStart(2, "0"), district: district(a.district) + (getLang() === "ko" ? "" : " " + a.district) }))}</h2>` +
    `<p class="small">${esc(t("whoSub", { age: val(a.age_band), household: val(a.household), moment: val(a.life_moment) }))}</p></div>` +
    `<div class="nav"><button type="button" data-nav="-1" aria-label="${esc(t("prev"))}">‹</button><button type="button" data-nav="1" aria-label="${esc(t("next"))}">›</button><button type="button" data-nav="0" aria-label="${esc(t("close"))}">×</button></div></div>` +
    `<h3>${esc(t("phoneTitle"))}</h3><ol class="phone">${rows}</ol>` +
    `<div class="hidden"><h3>${esc(t("hiddenTitle"))}</h3>${meter(t("trust"), a.relationship_capital)}${meter(t("fatigue"), a.message_fatigue)}${meter(t("price"), a.price_sensitivity)}` +
    `<p class="plan">${dot(a.would_buy_anyway ? "truth" : "none")} ${esc(t(a.would_buy_anyway ? "planYes" : "planNo"))}</p></div>`;
}

/* ---------- week grid: every resident, every day ---------- */
const RH = 22; let order = [], cur = null;
export function sizeGrid(world, view) {
  const key = $("sort").value, di = n => world.districts.indexOf(n), cv = $("grid"), nS = world.scenes.length;
  order = [...world.people].sort((a, b) => key === "trust" ? b.a.relationship_capital - a.a.relationship_capital : key === "fatigue" ? b.a.message_fatigue - a.a.message_fatigue
    : key === "plan" ? (b.a.would_buy_anyway - a.a.would_buy_anyway) || (b.a.relationship_capital - a.a.relationship_capital) : (di(a.a.district) - di(b.a.district)) || a.i - b.i);
  cv.style.height = nS * RH + "px"; $("gridRows").style.gridTemplateRows = `repeat(${nS}, ${RH}px)`;
  const dpr = Math.min(devicePixelRatio || 1, 2); cv.width = Math.max(cv.clientWidth, 200) * dpr; cv.height = nS * RH * dpr; drawGrid(world, view);
}
export function drawGrid(world, view) {
  if (!order.length) return;
  const cv = $("grid"), g = cv.getContext("2d"), dpr = cv.width / Math.max(cv.clientWidth, 200), w = cv.width / dpr, nS = world.scenes.length, cw = w / order.length, gap = cw > 6 ? 2 : cw > 3 ? 1 : 0;
  const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim(), C = { click: v("--s-click"), open: v("--s-open"), none: v("--s-none"), exit: v("--s-exit"), truth: v("--s-truth"), soft: v("--soft"), ink: v("--ink") };
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, nS * RH);
  order.forEach((p, c) => world.scenes.forEach((sc, d) => {
    const x = c * cw + gap / 2, y = d * RH + 3, cwd = Math.max(cw - gap, 1), h = RH - 6;
    const k = sc.type === "shop" ? (p.buy[p.silent ? 0 : 1] ? "truth" : "rest") : p.S[sc.d].k;
    g.fillStyle = k === "fedup" || k === "error" ? C.none : C[k] || C.soft; g.globalAlpha = k === "error" ? .45 : 1; g.fillRect(x, y, cwd, h); g.globalAlpha = 1;
    if (k === "fedup") { g.fillStyle = C.exit; g.fillRect(x, y, cwd, h * .38); }      // grey body: what the dashboard sees. Red cap: the hidden wish to leave.
  }));
  document.querySelectorAll("#gridRows span").forEach((el, d) => el.classList.toggle("now", !view.live && d === view.scene));
  const mark = (c, d, lw) => { g.strokeStyle = C.ink; g.lineWidth = lw; d == null ? g.strokeRect(c * cw + .5, 1, Math.max(cw - 1, 2), nS * RH - 2) : g.strokeRect(c * cw + 1, d * RH + 1.5, Math.max(cw - 2, 2), RH - 3); };
  if (view.sel != null) mark(order.indexOf(world.people[view.sel]), null, 2);
  if (cur) mark(cur.c, cur.d, 2);
}
export function wireGrid(world, view, actions) {
  const cv = $("grid"), nS = () => world.scenes.length;
  const cell = e => { const b = cv.getBoundingClientRect(); return { c: clamp(Math.floor((e.clientX - b.left) / b.width * order.length), 0, order.length - 1), d: clamp(Math.floor((e.clientY - b.top) / b.height * nS()), 0, nS() - 1) }; };
  const text = ({ c, d }) => { const p = order[c], sc = world.scenes[d]; return t("tip", { who: whoLine(p), day: day(d), what: sc.type === "shop" ? t(p.buy[p.silent ? 0 : 1] ? "satShops" : "satNot") : whatOf(p.S[sc.d], false) }); };
  const open = ({ c, d }) => { actions.go(d, world.scenes[d].type === "shop" ? .45 : NOON + .2); actions.select(order[c].i, false); };
  cv.onpointermove = e => { if (e.pointerType === "touch") return; tip.show(text(cell(e)), e.clientX, e.clientY); };
  cv.onpointerleave = () => tip.hide();
  cv.onclick = e => open(cell(e));
  cv.onfocus = () => { cur = cur || { c: view.sel != null ? Math.max(order.indexOf(world.people[view.sel]), 0) : 0, d: Math.min(view.scene, nS() - 1) }; drawGrid(world, view); };
  cv.onblur = () => { cur = null; tip.hide(); drawGrid(world, view); };
  cv.onkeydown = e => {
    const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (mv && cur) { e.preventDefault(); cur = { c: clamp(cur.c + mv[0], 0, order.length - 1), d: clamp(cur.d + mv[1], 0, nS() - 1) }; drawGrid(world, view);
      const b = cv.getBoundingClientRect(); tip.show(text(cur), b.left + (cur.c + .5) * b.width / order.length, b.top + cur.d * RH); }
    else if ((e.key === "Enter" || e.key === " ") && cur) { e.preventDefault(); open(cur); }
  };
}
export function renderTable(world) {
  const rows = world.messages.map((m, d) => { const c = dayCounts(world, d); return `<tr><th scope="row">${day(d)}</th><td>${esc(channel(m.channel))}</td><td>${c.reach}</td><td>${c.open}</td><td>${c.click}</td><td>${c.exit}</td><td>${c.fedup}</td></tr>`; }).join("");
  $("weekTable").innerHTML = `<thead><tr>${["day", "channel", "reach", "open", "click", "exit", "fedup"].map(k => `<th scope="col">${esc(t("th." + k))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody>`;
}

/* ---------- the Saturday question: guess, then reveal ---------- */
let guessed;
export function renderQuestion(world, actions) {
  const m = world.data.measure, el = $("saturday"); if (!m) { el.hidden = true; return; }
  el.hidden = false;
  const credited = m.click_attributed, cb = world.people.filter(p => !p.a.holdout && p.rec.some(r => r && r.action === "open_and_click") && p.buy[1]), anyway = cb.filter(p => p.buy[0]).length;
  const open = guessed !== undefined || credited === 0, max = Math.max(credited, m.truth_caused, m.truth_destroyed, Math.abs(m.holdout_estimate || 0), 1);
  const bar = (label, v, role, shown) => `<div class="hbar"><span>${esc(label)}</span><span class="track">${shown && v ? `<i style="width:${Math.abs(v) / max * 100}%;background:${ROLE[role]}"></i>` : ""}</span><span class="v">${shown ? num(v) : "?"}</span></div>`;
  el.innerHTML = `<h2>${esc(t("q.title"))}</h2><div class="guess">` +
    (open ? "" : `<p>${esc(t("q.ask", { c: credited }))}</p><div class="slider"><input type="range" id="guess" min="0" max="${credited}" value="${Math.round(credited / 2)}" step="1" aria-label="${esc(t("q.sliderAria"))}"><output id="guessOut" for="guess">${Math.round(credited / 2)}</output></div>` +
      `<button type="button" class="btn primary" id="reveal">${esc(t("q.reveal"))}</button>`) +
    `<div class="bars">${bar(t("q.credited"), credited, "click", true)}${bar(t("q.caused"), m.truth_caused, "truth", open)}${bar(t("q.destroyed"), m.truth_destroyed, "exit", open)}` +
    (m.holdout_estimate != null ? bar(t("q.holdout"), m.holdout_estimate, "idle", open) : "") + `</div>` +
    (open ? `<p class="verdict">${esc(t("q.verdict", { g: guessed, t: m.truth_caused }))}</p>` + (world.hasOutcomes && cb.length ? `<p>${esc(t("q.explain", { a: anyway, n: cb.length }))}</p>` : "") +
      `<div class="btnrow">${world.hasOutcomes ? `<button type="button" class="btn" id="watchSat">${esc(t("q.watch"))}</button>` : ""}<a class="btn" href="#silence-test">${esc(t("q.next"))}</a></div>` : "") +
    `<p class="small">${esc((m.holdout_estimate == null ? t("q.noHoldout") : "") + t("q.caveat", { n: m.messaged_agents }))}</p></div>`;
  const gi = $("guess");
  if (gi) { gi.oninput = () => { $("guessOut").textContent = gi.value; }; $("reveal").onclick = () => { guessed = +gi.value; renderQuestion(world, actions); }; }
  if ($("watchSat")) $("watchSat").onclick = actions.watchSaturday;
}

/* ---------- words that only change with the language or the run ---------- */
export function renderStatic(world) {
  const D = world.data, n = world.people.length, held = world.people.filter(p => p.a.holdout).length;
  $("title").textContent = t("title", { n, m: world.nDays });
  $("runpill").hidden = !D.run; if (D.run) $("runpill").textContent = D.run.tag === "live" ? t("runLive", { n, s: held }) : t("runDry");
  $("lang").textContent = t("langButton"); $("lang").setAttribute("lang", getLang() === "ko" ? "en" : "ko");
  const li = a => a.map(s => `<li>${esc(s)}</li>`).join("");
  $("rules").innerHTML = li(t("rules")); $("limits").innerHTML = li(t("limits"));
  const ck = D.checks && D.checks.verdict;
  $("checksTitle").textContent = ck ? t("checksTitle", { p: D.checks.passed, n: ck.length }) : t("checksTitle", { p: 0, n: 0 });
  $("checks").innerHTML = ck ? ck.map(c => `<li><span class="mark ${c.pass ? "ok" : "ko"}" aria-hidden="true">${c.pass ? "✓" : "✕"}</span><span><b>${esc(t(c.pass ? "pass" : "fail"))}.</b> ${esc(val(c.check))}</span></li>`).join("") : `<li class="small">${esc(t("checksNone"))}</li>`;
  $("diaryNote").textContent = t("diaryNote"); $("diaryNote").hidden = !t("diaryNote");
  document.querySelectorAll("#sort option").forEach(o => { o.textContent = t("sort." + o.value); });
  $("gridLegend").innerHTML = ["click", "open", "none", "fedup", "exit", "gone", "truth"].map(k => `<span class="key">${dot(k === "gone" ? "rest" : k)}${esc(t("gl." + k))}</span>`).join("");
  $("gridRows").innerHTML = world.scenes.map((sc, d) => `<span>${day(d)}</span>`).join("");
  renderTable(world);
}

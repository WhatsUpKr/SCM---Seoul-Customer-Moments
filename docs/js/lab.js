// lab.js: the silence test. The visitor draws a random silent group, replays the week with it,
// then repeats the draw many times to see what the method can and cannot tell with this many residents.

import { t, num, signed } from "./i18n.js";
import { clamp, rng, measureOf, drawSilent, silenceTrials } from "./model.js";
import { $, esc, tip } from "./panels.js";

const N_TRIALS = 300, NS = "http://www.w3.org/2000/svg";
let world, actions, share = .3, current = null, trials = null, rand = Math.random, seed = 0;

const pool = () => world.people.filter(p => !p.a.holdout);
const sizeOf = () => { const n = pool().length; return { n, k: clamp(Math.round(share * n), 1, n - 1) }; };
const same = (a, b) => a && b && a.size === b.size && [...a].every(x => b.has(x));

export function initLab(w, a) {
  world = w; actions = a; rand = rng("lab" + Date.now()); seed = Math.floor(rand() * 1e6);
  $("share").oninput = e => { share = +e.target.value / 100; current = null; trials = null; renderLab(); };
  $("labDraw").onclick = () => { current = drawSilent(world, share, rand); renderLab(); };
  $("labRepeat").onclick = () => { if (!current) current = drawSilent(world, share, rand); trials = silenceTrials(world, share, N_TRIALS, ++seed); renderLab(); };
  $("labReplay").onclick = () => (world.experiment && same(world.experiment, current) ? actions.endTest() : actions.startTest(current));
  renderLab();
}

export function renderLab() {
  if (!world) return;
  const { n, k } = sizeOf();
  $("shareLabel").textContent = t("lab.share", { p: Math.round(share * 100), k, n });
  $("labDraw").textContent = t(current ? "lab.again" : "lab.draw"); $("labRepeat").textContent = t("lab.repeat", { n: N_TRIALS });
  const one = $("labOne"), on = world.experiment && same(world.experiment, current);
  $("labReplay").hidden = !current; $("labReplay").textContent = t(on ? "lab.end" : "lab.replay");
  if (!current) one.innerHTML = `<p class="small">${esc(t("lab.hint"))}</p>`;
  else {
    const m = measureOf(world.people, p => !!p.a.holdout || current.has(p.id));
    const row = (label, b, tot, role) => `<div class="hbar"><span>${esc(label)}</span><span class="track">${b ? `<i style="width:${b / tot * 100}%;background:var(--s-${role})"></i>` : ""}</span><span class="v wide">${esc(t("lab.row", { b, n: tot, r: tot ? Math.round(b / tot * 100) : 0 }))}</span></div>`;
    one.innerHTML = `<div class="bars">${row(t("lab.messaged"), m.purchases_messaged, m.messaged, "none")}${row(t("lab.silent"), m.purchases_silent, m.silent, "none")}</div>` +
      `<div class="tiles three"><div class="tile"><strong>${signed(m.estimate)}</strong><span>${esc(t("lab.says"))}</span></div>` +
      `<div class="tile"><strong>${num(m.click_attributed)}</strong><span>${esc(t("lab.dash"))}</span></div>` +
      `<div class="tile"><strong>${num(m.truth_net)}</strong><span>${esc(t("lab.truth"))}</span></div></div><p class="small">${esc(t("lab.unit"))}</p>`;
  }
  const fig = $("labChart"); fig.hidden = !trials;
  if (trials) { chart(fig.querySelector("svg"), current ? measureOf(world.people, p => !!p.a.holdout || current.has(p.id)).estimate : null);
    $("labChartTitle").textContent = t("lab.chartTitle", { n: trials.n });
    $("labSummary").innerHTML = [t("lab.s1", { lo: signed(trials.p5), hi: signed(trials.p95), mean: signed(trials.mean), truth: num(trials.truthMean) }),
      t("lab.s2", { click: num(trials.clickMean), pct: Math.round(trials.closer * 100) }), t("lab.s3", { n })].map(s => `<p>${esc(s)}</p>`).join(""); }
}

/* Histogram of the answers. One neutral series; the truth and click attribution are reference lines with direct labels. */
function chart(svg, mine) {
  const W = 520, H = 236, ml = 34, mr = 14, mt = 34, mb = 44, pw = W - ml - mr, ph = H - mt - mb;
  const el = (name, attrs, text) => { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; svg.appendChild(e); return e; };
  svg.replaceChildren(); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  // bars: exact answers when there are few distinct ones, otherwise bins
  const r1 = x => Math.round(x * 10) / 10, counts = new Map();
  for (const e of trials.est) counts.set(r1(e), (counts.get(r1(e)) || 0) + 1);
  let bars = [...counts].map(([v, c]) => ({ v, c })).sort((a, b) => a.v - b.v), step = Infinity;
  if (bars.length > 28) { const lo = bars[0].v, wd = Math.max(1, Math.ceil((bars[bars.length - 1].v - lo) / 24)), m = new Map();
    for (const b of bars) { const v = lo + Math.floor((b.v - lo) / wd) * wd + wd / 2; m.set(v, (m.get(v) || 0) + b.c); } bars = [...m].map(([v, c]) => ({ v, c })).sort((a, b) => a.v - b.v); }
  for (let i = 1; i < bars.length; i++) step = Math.min(step, bars[i].v - bars[i - 1].v);
  const lo = Math.min(bars[0].v, trials.truthMean, 0), hi = Math.max(bars[bars.length - 1].v, trials.clickMean, trials.truthMean), padX = (hi - lo) * .07 + .6;
  const x = v => ml + (v - (lo - padX)) / (hi - lo + padX * 2) * pw, maxC = Math.max(...bars.map(b => b.c));
  const nice = v => { const p = 10 ** Math.floor(Math.log10(v)), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
  const ys = nice(maxC / 3), top = Math.ceil(maxC / ys) * ys, y = c => mt + ph - c / top * ph;
  for (let c = 0; c <= top; c += ys) { el("line", { x1: ml, x2: W - mr, y1: y(c), y2: y(c), class: c ? "grid" : "axis" }); el("text", { x: ml - 6, y: y(c) + 4, "text-anchor": "end", class: "tick" }, c); }
  const bw = clamp(isFinite(step) ? step / (hi - lo + padX * 2) * pw - 2 : 24, 3, 24), mineV = mine == null ? null : bars.reduce((a, b) => (Math.abs(b.v - mine) < Math.abs(a.v - mine) ? b : a)).v;
  for (const b of bars) {
    const bx = x(b.v) - bw / 2, by = y(b.c), r = Math.min(4, bw / 2, (mt + ph - by) / 2), label = t("lab.tip", { c: b.c, n: trials.n, v: signed(b.v) });
    const bar = el("path", { d: `M${bx},${mt + ph}V${by + r}q0,${-r} ${r},${-r}h${bw - 2 * r}q${r},0 ${r},${r}V${mt + ph}Z`, class: "bar" + (b.v === mineV ? " mine" : ""), tabindex: 0, role: "img", "aria-label": label });
    const show = () => { const bb = bar.getBoundingClientRect(); tip.show(label, bb.left + bb.width / 2, bb.top); };
    bar.addEventListener("pointerenter", show); bar.addEventListener("focus", show); bar.addEventListener("pointerleave", tip.hide); bar.addEventListener("blur", tip.hide);
  }
  const xs = nice((hi - lo) / 6);
  for (let v = Math.ceil((lo - padX) / xs) * xs; v <= hi + padX; v += xs) el("text", { x: x(v), y: mt + ph + 16, "text-anchor": "middle", class: "tick" }, signed(v, 0));
  el("text", { x: ml + pw / 2, y: H - 6, "text-anchor": "middle", class: "tick" }, t("lab.axis"));
  // reference lines, labelled directly: text in ink, a short stroke of the line's colour as its key
  const refs = [[trials.truthMean, "truth", t("lab.mTruth", { v: num(trials.truthMean) })], [trials.clickMean, "click", t("lab.mClick", { v: num(trials.clickMean) })]];
  const close = Math.abs(x(refs[0][0]) - x(refs[1][0])) < 120;
  refs.forEach(([v, role, label], i) => {
    const px = x(v), ly = close && i ? 26 : 12, end = px > W - 130;
    el("line", { x1: px, x2: px, y1: ly + 5, y2: mt + ph, class: "ref", stroke: `var(--s-${role})` });
    el("line", { x1: end ? px - 16 : px + 6, x2: end ? px - 6 : px + 16, y1: ly - 3, y2: ly - 3, class: "ref", stroke: `var(--s-${role})` });
    el("text", { x: end ? px - 20 : px + 20, y: ly, "text-anchor": end ? "end" : "start", class: "lab" }, label);
  });
}

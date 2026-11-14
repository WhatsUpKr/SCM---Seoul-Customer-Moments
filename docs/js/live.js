// live.js: send your own message to the neighbourhood. Only in the Claude artifact version of the page:
// each resident is one request to Claude on the viewer's own account, asked for on a click, never in a loop.

import { t, channel, day, num } from "./i18n.js";
import { rng, livePrompt, parseLive, liveCounts, dayCounts } from "./model.js";
import { $, esc } from "./panels.js";

const MAX = 30, HIDE = ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"];
let world, actions, sample = null, ctl = null, running = false, off = false, chan = "push", error = "";

export async function initLive(w, a) {
  world = w; actions = a;
  if (!window.claude || typeof window.claude.use !== "function") return;      // GitHub Pages and plain copies: the section stays hidden
  try { sample = await window.claude.use("sample"); } catch { sample = null; }
  if (!sample) return;
  $("live-test").hidden = false;
  $("liveChannel").onclick = e => { const b = e.target.closest("button"); if (b && !running) { chan = b.dataset.c; renderLive(); } };
  $("livePresets").onclick = e => { const b = e.target.closest("button"); if (b && !running) { $("liveText").value = t("live.presets")[+b.dataset.i][1]; error = ""; renderLive(); } };
  $("liveSend").onclick = send;
  $("liveStop").onclick = () => ctl && ctl.abort();
  $("liveBack").onclick = () => actions.endLive();
  renderLive();
}

export function renderLive() {
  if (!sample || !world) return;
  const n = Math.min(MAX, world.people.filter(p => !p.a.holdout).length);
  document.querySelectorAll("#liveChannel button").forEach(b => { b.textContent = channel(b.dataset.c); b.setAttribute("aria-pressed", b.dataset.c === chan); b.disabled = running; });
  $("livePresets").innerHTML = t("live.presets").map((p, i) => `<button type="button" class="chip" data-i="${i}">${esc(p[0])}</button>`).join("");
  $("liveSend").textContent = t("live.send", { n }); $("liveSend").disabled = running || off; $("liveText").disabled = running || off;
  $("liveStop").hidden = !running; $("liveBack").hidden = running || !world.live;
  let out = "";
  if (world.live) {
    const c = liveCounts(world), rest = c.total - c.done;
    out += `<p class="num">${esc(t("live.progress", { done: c.done, n: c.total }))}</p><span class="bar big">` +
      [["click", c.click], ["open", c.open], ["none", c.none + c.error], ["exit", c.exit]].filter(x => x[1]).map(([k, v]) => `<i style="flex:${v};background:var(--s-${k})"></i>`).join("") + (rest ? `<i class="rest" style="flex:${rest}"></i>` : "") + `</span>`;
    if (c.done) out += `<p>${esc(t("live.result", { o: c.open + c.click, c: c.click, i: c.none, u: c.exit, a: c.avg == null ? null : num(c.avg) }))}</p>`;
    if (!running && c.done) { const d0 = dayCounts(world, 0), sc = world.people.map(p => p.rec[0] && p.rec[0].annoyance).filter(v => typeof v === "number");
      out += `<p class="small">${esc(t("live.baseline", { ch: channel(world.messages[0].channel), day: t("dayLong")[0], o: d0.open + d0.click, c: d0.click, a: sc.length ? num(sc.reduce((s, v) => s + v, 0) / sc.length) : "–" }))}</p>`; }
  }
  if (error) out += `<p class="warn" role="alert">${esc(t("live.err." + error))}</p>`;
  $("liveOut").innerHTML = out;
}

async function send() {
  const text = $("liveText").value.trim();
  if (!text) { error = "empty"; return renderLive(); }
  const r = rng("live" + Date.now()), pool = world.people.filter(p => !p.a.holdout);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const ids = pool.slice(0, MAX).sort((a, b) => a.g.d - b.g.d);          // nearest to the market first, so the answers spread outward
  world.live = { message: { channel: chan, text: text.slice(0, 300) }, results: {}, ids: new Set(ids.map(p => p.i)), sentAt: actions.now(), last: null };
  running = true; error = ""; ctl = new AbortController();
  actions.startLive(); renderLive();
  let next = 0, fails = 0, stop = false;
  const one = async p => {
    try {
      world.live.results[p.i] = { ...parseLive(await sample.json(livePrompt(p.a, world.live.message), { modelTier: "quick", signal: ctl.signal })), at: actions.now() };
      fails = 0;
    } catch (e) {
      const code = e && e.code;
      if (code === "cancelled") { stop = true; return; }
      if (HIDE.includes(code) || code === "rate_limited" || code === "session_expired" || code === "refused") {
        stop = true; error = HIDE.includes(code) ? "denied" : code === "rate_limited" ? "rate" : code === "session_expired" ? "session" : "refused"; return;
      }
      world.live.results[p.i] = { k: "error", at: actions.now() };       // unreadable or interrupted answer: keep going, never retry
      if (++fails >= 3) { stop = true; error = "generic"; return; }
    }
    world.live.last = { i: p.i, at: actions.now() };
    renderLive(); actions.liveUpdate();
  };
  const worker = async () => { while (!stop && next < ids.length) await one(ids[next++]); };
  await one(ids[next++]);                    // alone first: this request carries Claude's consent prompt
  if (!stop) await Promise.all([worker(), worker()]);   // then two at a time, the most the platform runs at once for a viewer
  if (stop && ctl) ctl.abort();
  running = false; ctl = null;
  if (error === "denied") { off = true; actions.endLive(); }
  renderLive(); actions.liveUpdate();
}

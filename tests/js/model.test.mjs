// Rules of the replay page that must never break. Run: node --test tests/js/model.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as m from "../../docs/js/model.js";
import { STRINGS } from "../../docs/js/i18n.js";

const data = JSON.parse(readFileSync(new URL("../../docs/data.json", import.meta.url), "utf8"));
const fresh = () => m.prepare(structuredClone(data));

test("the page counts what the Python report counts", () => {
  const r = m.measure(fresh()), py = data.measure;
  assert.equal(r.messaged, py.messaged_agents);
  assert.equal(r.purchases_messaged, py.purchases_messaged);
  assert.equal(r.click_attributed, py.click_attributed);
  assert.equal(r.truth_caused, py.truth_caused);
  assert.equal(r.truth_destroyed, py.truth_destroyed);
});

test("after an unsubscribe nothing is sent any more", () => {
  for (const p of fresh().people) {
    const i = p.S.findIndex(s => s.k === "exit");
    if (i >= 0) assert.ok(p.S.slice(i + 1).every(s => s.k === "gone"), p.id);
  }
});

test("every day accounts for every resident", () => {
  const w = fresh();
  for (let d = 0; d < w.nDays; d++) {
    const c = m.dayCounts(w, d);
    assert.equal(c.click + c.open + c.none + c.fedup + c.error + c.exit + c.gone + c.holdout, w.people.length);
    assert.equal(c.reach, c.messaged - c.gone);
  }
});

test("silencing some residents changes nobody else", () => {
  const w = fresh(), before = w.people.map(p => p.S.map(s => s.k).join());
  const set = m.drawSilent(w, .3, m.rng("t"));
  m.assign(w, set);
  for (const p of w.people) {
    if (set.has(p.id)) { assert.ok(p.S.every(s => s.k === "holdout")); assert.equal(p.clicked, false); }
    else assert.equal(p.S.map(s => s.k).join(), before[p.i]);
  }
  m.assign(w, null);
  assert.deepEqual(w.people.map(p => p.S.map(s => s.k).join()), before);
});

test("a silent resident shops as in a silent week, and takes no click credit", () => {
  const w = fresh(), set = m.drawSilent(w, .5, m.rng("u"));
  m.assign(w, set);
  const r = m.measure(w);
  assert.equal(r.silent, set.size);
  assert.equal(r.purchases_silent, w.people.filter(p => set.has(p.id)).reduce((s, p) => s + p.buy[0], 0));
  assert.ok(r.click_attributed <= data.measure.click_attributed);
  assert.equal(r.estimate, (r.purchases_messaged / r.messaged - r.purchases_silent / r.silent) * r.messaged);
});

test("repeated silence tests are reproducible and centred on the truth", () => {
  const w = fresh(), a = m.silenceTrials(w, .3, 2000, 7), b = m.silenceTrials(w, .3, 2000, 7);
  assert.deepEqual(a.est, b.est);
  assert.ok(Math.abs(a.mean - a.truthMean) < 1, `mean ${a.mean} vs truth ${a.truthMean}`);
  assert.equal(a.bins.reduce((s, x) => s + x.c, 0), 2000);
  assert.ok(a.p5 <= a.mean && a.mean <= a.p95);
});

test("every resident falls in a legend entry, in every view", () => {
  const w = fresh();
  for (const lens of ["dash", "mood", "trust", "plan"]) for (const mode of ["msg", "silent"]) for (let scene = 0; scene < w.scenes.length; scene++) {
    const sv = m.sceneOf(w, { scene, lens, mode, live: false }), keys = m.legendOf(sv).map(x => x[0]);
    for (const p of w.people) assert.ok(keys.includes(m.categoryOf(w, sv, p)), `${lens} ${mode} ${scene} ${m.categoryOf(w, sv, p)}`);
  }
});

test("a live answer is checked before it is shown", () => {
  assert.equal(m.parseLive(null).k, "error");
  assert.equal(m.parseLive({ action: "dance" }).k, "error");
  assert.deepEqual(m.parseLive({ action: "unsubscribe", annoyance: 42, diary: "x".repeat(999) }), { k: "exit", r: { action: "unsubscribe", annoyance: 10, diary: "x".repeat(240) } });
  assert.equal(m.parseLive({ action: "open_only", annoyance: "3", diary: 5 }).r.annoyance, 3);
  const prompt = m.livePrompt(data.agents[0], { channel: "push", text: "hello" });
  assert.ok(prompt.includes(data.agents[0].district) && prompt.includes("<message>\nhello\n</message>") && !prompt.includes("undefined"));
});

test("the normal curve is the normal curve", () => {
  assert.ok(Math.abs(m.normCdf(0) - .5) < 1e-6);
  assert.ok(Math.abs(m.normCdf(1.6449) - .95) < 1e-4);
  assert.ok(Math.abs(m.normCdf(-1.6449) - .05) < 1e-4);
  assert.ok(Math.abs(m.normCdf(1.96) - .975) < 1e-4);
});

test("the sample-size formula agrees with the page's own random draws", () => {
  const w = fresh(), i = m.insights(w), share = .3;
  const plan = m.holdoutPlan({ n: i.n, share, base: i.base, lift: 0 }), trials = m.silenceTrials(w, share, 4000, 11);
  const formula = plan.margin * plan.nM, drawn = (trials.p95 - trials.p5) / 2;      // half-width of the middle 90%, in purchases
  assert.ok(Math.abs(formula - drawn) / drawn < .15, `formula ${formula} vs draws ${drawn}`);
});

test("a silence test gets sharper with more customers and never free", () => {
  const at = n => m.holdoutPlan({ n, share: .1, base: .2, lift: .02 });
  assert.ok(at(1000).margin > at(10000).margin && at(10000).margin > at(100000).margin);
  assert.ok(at(1000).power < at(10000).power && at(10000).power < at(100000).power);
  assert.ok(Math.abs(at(at(1000).need).power - .8) < .02, `power at the stated need: ${at(at(1000).need).power}`);
  assert.equal(at(10000).nS, 1000);
  assert.ok(Math.abs(at(10000).cost - 20) < 1e-9 && Math.abs(at(10000).gained - 180) < 1e-9);
  assert.equal(m.holdoutPlan({ n: 1000, share: .1, base: .2, lift: 0 }).need, null);
});

test("the three takeaways are counted on the recorded run", () => {
  const w = fresh(), i = m.insights(w), py = data.measure;
  assert.equal(i.credited, py.click_attributed);
  assert.ok(i.anyway <= i.credited && i.quietWant <= i.quiet && i.noPlanClicked <= i.noPlan);
  let quiet = 0, want = 0;                                                     // recount from the page's own states: the grid's grey cells and red caps
  for (const p of w.people) for (const s of p.S) { if (s.k === "none" || s.k === "fedup") quiet++; if (s.k === "fedup") want++; }
  assert.equal(i.quiet, quiet); assert.equal(i.quietWant, want);
  m.assign(w, new Set([w.people[0].id]));                                      // a visitor's silent group must not change the takeaways
  assert.deepEqual(m.insights(w), i);
  const h = m.hiddenStory(w);
  if (h) assert.equal(w.people[h.i].rec.filter(r => r && r.action === "unsubscribe" && !r.exited).length >= h.k, true);
});

test("English and Korean have the same keys", () => {
  const keys = (o, pre = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keys(v, pre + k + ".") : [pre + k]));
  assert.deepEqual(keys(STRINGS.ko).sort(), keys(STRINGS.en).sort());
});

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

test("English and Korean have the same keys", () => {
  const keys = (o, pre = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keys(v, pre + k + ".") : [pre + k]));
  assert.deepEqual(keys(STRINGS.ko).sort(), keys(STRINGS.en).sort());
});

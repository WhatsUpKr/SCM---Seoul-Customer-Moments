// city.js: the map. Lays the neighbourhood out, paints the scenery once, then draws residents every frame.
// The map is always drawn in daylight colours with its own day and night; only the page around it follows the theme.

import { clamp, lerp, seg, ease, rng, stateOf, dashKey, moodValue, shops, categoryOf, pickFeatured } from "./model.js";
import { t as tr, district as districtName, getLang } from "./i18n.js";

export const NOON = 1 / 3;      // 12:00 on a day that runs 07:00 to 22:00
export const PULSE = .14;       // how long the message takes to reach the farthest resident
export const LIVE_T = .46;      // time of day shown during a live test
const TAU = Math.PI * 2;

// Meaning colours. Validated with the dataviz palette checker (colour-blind separation, contrast).
export const COL = { click: "#12936f", open: "#66bda6", none: "#8f9c9a", exit: "#d9482f", truth: "#6250d6", brand: "#2f7fd0", idle: "#33454e" };
const mix = (a, b, k) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], k))).join(",")})`;
const ramp = (stops, v) => { v = clamp(v, 0, 1) * (stops.length - 1); const i = Math.min(Math.floor(v), stops.length - 2); return mix(stops[i], stops[i + 1], v - i); };
export const moodColor = v => ramp([[232, 154, 136], [217, 72, 47], [143, 36, 21]], v);     // one hue, light to dark
export const trustColor = v => ramp([[134, 182, 239], [57, 135, 229], [16, 66, 129]], v);
const ROOFS = ["#5aa57c", "#68b08a", "#4f9a78", "#74b592", "#c5ccce", "#b7c0c3", "#c79076"];   // Seoul's green waterproofed rooftops, mostly

export function createCity(cv, stage) {
  const g = cv.getContext("2d"), bg = document.createElement("canvas");
  if (!g.roundRect) CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
  let world, W = 1000, H = 600, dpr = 1, R = 9, L = null, B = [], feat = [], maxD = 1;

  /* ---------- layout: the Han across the middle, three blocks per bank, the market on an island ---------- */
  function layout(w) {
    world = w;
    const wide = stage.clientWidth >= 620;
    W = wide ? 1000 : 600; H = wide ? 626 : 772; dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const names = world.districts, across = Math.ceil(names.length / 2) || 1, pad = 12, top = wide ? 26 : 50, road = wide ? 30 : 22, band = wide ? 124 : 132;   // top: room for the clock
    const bw = (W - pad * 2 - road * (across - 1)) / across, bh = (H - pad * 2 - top - band) / 2, bandY = pad + top + bh, mid = bandY + band / 2;
    const n = world.people.length;
    R = (wide ? 9 : 11) * (n > 150 ? .6 : n > 60 ? .8 : 1);
    L = { wide, pad, road, band, bandY, mid, wh: band * .17, pOff: band / 2 - 22, fs: wide ? 1 : 1.42, mx: W / 2, my: mid, deck: Math.min(172, bw - 4), roads: [], blocks: [], lamps: [] };
    for (let j = 1; j < across; j++) L.roads.push(pad + j * (bw + road) - road / 2);
    B = [];
    names.forEach((name, i) => {
      const side = i < across ? 0 : 1, j = i % across, b = { name, side, j, x: pad + j * (bw + road), y: side ? bandY + band : pad + top, w: bw, h: bh };
      L.blocks.push(b);
      const res = world.people.filter(p => p.a.district === name), r = rng("block" + name);
      const ix = b.x + 7, iy = b.y + 22 * L.fs, iw = b.w - 14, ih = b.h - 22 * L.fs - 4;
      const gc = Math.max(1, Math.floor(iw / (wide ? 70 : 76))), gr = Math.max(1, Math.floor(ih / (wide ? 60 : 70))), cw = iw / gc, ch = ih / gr;
      const cells = Array.from({ length: gc * gr }, (_, k) => k);
      for (let k = cells.length - 1; k > 0; k--) { const q = Math.floor(r() * (k + 1)); [cells[k], cells[q]] = [cells[q], cells[k]]; }
      const blds = cells.map(k => {
        const cx = ix + (k % gc) * cw, cy = iy + Math.floor(k / gc) * ch, fw = cw * (.74 + r() * .12), fh = ch * (.42 + r() * .08), e = ch * (.2 + r() * .08);
        const x = cx + (cw - fw) / 2, y = cy + ch * .03 + (ch * .5 - fh);
        return { x, y, w: fw, h: fh, e, doorX: x + fw / 2, doorY: y + fh + e, alleyY: cy + ch * .92, res: [], roof: r(), tank: r() < .45, lit: r() < .55, order: cy, win: [] };
      });
      res.forEach((p, k) => { const bl = blds[k % blds.length]; bl.res.push(p); p.g = { bld: bl, block: b }; });
      B.push(...blds);
    });
    B.sort((a, b) => a.order - b.order);
    maxD = 1;
    for (const p of world.people) {
      const gm = p.g, r = rng("p" + p.id), b = gm.block, bl = gm.bld, s = b.side ? 1 : -1, slot = bl.res.indexOf(p), k = bl.res.length;
      const dx = bl.doorX + (k > 1 ? (slot / (k - 1) - .5) * bl.w * .6 : 0);
      const cands = []; if (b.j > 0) cands.push(b.x - L.road / 2); if (b.j < across - 1) cands.push(b.x + b.w + L.road / 2); if (!cands.length) cands.push(b.x + b.w + 4);
      const crowd = n > 60, rc = cands.reduce((m, c) => (Math.abs(c - dx) < Math.abs(m - dx) ? c : m));
      const rx = rc + (dx < rc ? -1 : 1) * L.road * (crowd ? .2 + r() * .55 : .34);   // walk on the pavement, not the roadway; a big population spreads wider
      const py = L.mid + s * (L.pOff + (r() - .5) * 8), mxj = L.mx + (r() - .5) * (L.deck - 44);
      gm.pts = [[dx, bl.doorY + 2], [dx, bl.alleyY], [rx, bl.alleyY], [rx, py], [mxj, py], [mxj, L.mid + s * 35]];
      gm.len = [0];
      for (let q = 1; q < gm.pts.length; q++) gm.len.push(gm.len[q - 1] + Math.hypot(gm.pts[q][0] - gm.pts[q - 1][0], gm.pts[q][1] - gm.pts[q - 1][1]));
      gm.fDay = r() < (crowd ? .55 : .3) ? .06 + r() * .16 : .3 + r() * .52;        // where the resident spends the day, as a share of the way to the market
      gm.t0 = .03 + r() * .1; gm.t1 = .64 + r() * .08; gm.ts = .2 + r() * .3; gm.ph = r() * TAU; gm.ox = (r() - .5) * (crowd ? 12 : 5); gm.oy = (r() - .5) * (crowd ? 9 : 4);
      const [sx, sy] = along(gm, gm.fDay); gm.d = Math.hypot(sx - L.mx, sy - L.my); maxD = Math.max(maxD, gm.d);
      gm.x = gm.pts[0][0]; gm.y = gm.pts[0][1]; gm.home = true;
    }
    for (const p of world.people) p.g.hitT = NOON + PULSE * p.g.d / maxD;   // the moment the noon message reaches this resident
    refresh(); paintStatic();
  }
  function refresh() { feat = world.messages.map((m, d) => pickFeatured(world, d).sort((a, b) => a.g.hitT - b.g.hitT)); }
  function along(gm, f) {
    const d = clamp(f, 0, 1) * gm.len[gm.len.length - 1]; let k = 1;
    while (k < gm.len.length - 1 && gm.len[k] < d) k++;
    const a = gm.pts[k - 1], b = gm.pts[k], q = (d - gm.len[k - 1]) / Math.max(gm.len[k] - gm.len[k - 1], 1e-6);
    return [lerp(a[0], b[0], q), lerp(a[1], b[1], q)];
  }

  /* ---------- scenery, painted once per layout ---------- */
  function paintStatic() {
    if (!L) return;
    bg.width = W * dpr; bg.height = H * dpr;
    const c = bg.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rr = (x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
    const sans = '"IBM Plex Sans KR","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif';
    c.fillStyle = "#cdd5d1"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#bdd3a8"; c.fillRect(0, L.bandY + 3, W, L.band - 6);
    c.fillStyle = "#8cc0d8"; c.fillRect(0, L.mid - L.wh, W, L.wh * 2);
    c.fillStyle = "#efe8d4"; for (const s of [-1, 1]) c.fillRect(0, L.mid + s * L.pOff - 6, W, 12);
    for (const x of L.roads) {
      c.fillStyle = "#cdd5d1"; c.fillRect(x - L.road / 2, L.bandY, L.road, L.band);
      c.fillStyle = "#a9b4b1"; c.fillRect(x - L.road / 2, L.mid - L.wh - 2, 2, L.wh * 2 + 4); c.fillRect(x + L.road / 2 - 2, L.mid - L.wh - 2, 2, L.wh * 2 + 4);
      c.strokeStyle = "rgba(255,255,255,.8)"; c.lineWidth = 1.5; c.setLineDash([9, 9]); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); c.setLineDash([]);
    }
    c.font = `italic 500 ${11 * L.fs}px ${sans}`; c.fillStyle = "rgba(255,255,255,.9)"; c.textBaseline = "middle"; c.fillText("한강", 10, L.mid);
    for (const b of L.blocks) {
      c.fillStyle = "#e7ebe2"; rr(b.x, b.y, b.w, b.h, 10); c.fill();
      c.textBaseline = "top"; c.fillStyle = "#3d4c52"; c.font = `600 ${11.5 * L.fs}px ${sans}`;
      const ko = districtName(b.name); c.fillText(ko, b.x + 9, b.y + 6 * L.fs);
      if (ko !== b.name && getLang() !== "ko") { const w = c.measureText(ko).width; c.fillStyle = "#6d7b7e"; c.font = `400 ${10.5 * L.fs}px ${sans}`; c.fillText(b.name, b.x + 15 + w, b.y + 7 * L.fs); }
    }
    for (const b of B) {
      c.fillStyle = "rgba(20,35,42,.13)"; c.fillRect(b.x + 5, b.y + 6, b.w, b.h + b.e);
      c.fillStyle = "#e9e3d4"; c.fillRect(b.x, b.y + b.h, b.w, b.e); c.fillStyle = "rgba(20,35,42,.08)"; c.fillRect(b.x, b.y + b.h, b.w, 2);
      c.fillStyle = ROOFS[Math.floor(b.roof * ROOFS.length)]; c.fillRect(b.x, b.y, b.w, b.h);
      c.strokeStyle = "rgba(255,255,255,.5)"; c.lineWidth = 1.5; c.strokeRect(b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 5);
      if (b.tank) { c.fillStyle = "#e9c64f"; c.beginPath(); c.arc(b.x + b.w * .76, b.y + b.h * .36, Math.min(5.5, b.h * .2), 0, TAU); c.fill(); c.strokeStyle = "rgba(0,0,0,.18)"; c.lineWidth = 1; c.stroke(); }
      b.win = []; const n = clamp(b.res.length || 2, 2, 4), ww = Math.min(8, b.w / (n * 2.2)), wh = b.e * .46;
      for (let k = 0; k < n; k++) { const wx = b.x + b.w * (k + .5) / n - ww / 2, wy = b.y + b.h + b.e * .2; b.win.push([wx, wy, ww, wh]); c.fillStyle = "#8496a3"; c.fillRect(wx, wy, ww, wh); }
      c.fillStyle = "#7a5a43"; c.fillRect(b.doorX - 2.5, b.y + b.h + b.e - Math.min(9, b.e * .6), 5, Math.min(9, b.e * .6));
    }
    const rt = rng("trees"); L.lamps = [];
    for (const s of [-1, 1]) for (let x = 18; x < W - 8; x += 44 + rt() * 10) {
      if (L.roads.some(rx => Math.abs(rx - x) < L.road / 2 + 8) || Math.abs(x - L.mx) < L.deck / 2 + 10) continue;
      const y = L.mid + s * (L.band / 2 - 9), rad = 7 + rt() * 3;
      c.fillStyle = "rgba(20,35,42,.14)"; c.beginPath(); c.ellipse(x + 3, y + 4, rad, rad * .7, 0, 0, TAU); c.fill();
      c.fillStyle = rt() < .7 ? (rt() < .5 ? "#e4b739" : "#d7a22a") : "#74a86d"; c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill();   // ginkgo yellow
      c.fillStyle = "rgba(255,255,255,.22)"; c.beginPath(); c.arc(x - rad * .3, y - rad * .3, rad * .45, 0, TAU); c.fill();
      if (rt() < .5) L.lamps.push([x + 20, L.mid + s * (L.pOff - 9)]);
    }
    const mx = L.mx, my = L.my, dw = L.deck, dh = L.band - 10, fw = Math.min(104, dw - 50), fh = 30, e = 18, fx = mx - fw / 2, fy = my - 22;
    c.fillStyle = "rgba(20,35,42,.12)"; rr(mx - dw / 2 + 4, my - dh / 2 + 5, dw, dh, 14); c.fill();
    c.fillStyle = "#ece6d6"; rr(mx - dw / 2, my - dh / 2, dw, dh, 14); c.fill();
    c.fillStyle = "rgba(20,35,42,.16)"; c.fillRect(fx + 6, fy + 7, fw, fh + e);
    c.fillStyle = "#f6f3ea"; c.fillRect(fx, fy + fh, fw, e);
    for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? "#fff" : COL.brand; c.fillRect(fx + k * fw / 8, fy + fh, fw / 8, e * .42); }
    c.fillStyle = "#3b4c55"; c.fillRect(mx - 9, fy + fh + e * .5, 18, e * .5);
    c.fillStyle = COL.brand; c.fillRect(fx, fy, fw, fh); c.strokeStyle = "rgba(255,255,255,.55)"; c.lineWidth = 1.5; c.strokeRect(fx + 2.5, fy + 2.5, fw - 5, fh - 5);
    c.fillStyle = "#fff"; c.font = '700 15px "Hahmlet","Noto Serif KR",serif'; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("하늘마켓", mx, fy + fh / 2 + 1); c.textAlign = "left";
    L.sign = [mx, fy - 4];
  }

  /* ---------- where everyone is at time t ---------- */
  function place(view, sv, clockMs) {
    const t = sv.kind === "live" ? LIVE_T : view.t, shop = sv.kind === "shop", w = view.playing || view.live ? clockMs / 1000 : 0;
    for (const p of world.people) {
      const gm = p.g, go = ease(seg(t, gm.t0, gm.t0 + .1)), back = ease(seg(t, gm.t1, gm.t1 + .12)), buyer = shop && shops(p, view.mode);
      let f = gm.fDay * go * (1 - back), trip = 0;
      if (buyer) { trip = ease(seg(t, gm.ts, gm.ts + .09)) - ease(seg(t, gm.ts + .15, gm.ts + .24)); f = lerp(f, 1, trip) * (1 - back); }
      const [x, y] = along(gm, f), still = go === 1 && back === 0 && (trip === 0 || trip === 1);
      gm.x = x + gm.ox + (still ? Math.sin(w * 1.3 + gm.ph) * 2.2 : 0);
      gm.y = y + gm.oy + (still ? Math.cos(w * 1.1 + gm.ph) * 1.4 : Math.sin(t * 400 + gm.ph) * .9);
      gm.home = f < .004; gm.atMarket = trip > .93; gm.basket = buyer && !gm.home && t > gm.ts + .08;
      gm.rev = sv.kind === "live" ? !!(world.live && world.live.results[p.i]) : sv.kind === "day" && t >= gm.hitT;
    }
  }

  /** How a resident is drawn under the current lens. */
  function look(view, sv, p, t) {
    const a = p.a, gm = p.g;
    if (view.lens === "trust") return { fill: trustColor(a.relationship_capital) };
    if (view.lens === "plan") return { fill: a.would_buy_anyway ? COL.truth : COL.none };
    const s = stateOf(world, sv, p);
    if (view.lens === "mood") {
      if (sv.kind !== "shop" && s.k === "holdout") return { hollow: 1 };
      if (sv.kind === "day" && (s.k === "gone" || (s.k === "exit" && t > gm.hitT + .12))) return { ghost: 1 };
      const v = sv.kind === "live" ? (s.r ? s.r.annoyance : null) : moodValue(p, sv.d, sv.kind === "shop" || gm.rev);
      return { fill: v == null ? COL.idle : moodColor(v / 10), wait: s.k === "pending" };
    }
    if (sv.kind === "shop") {
      const b = shops(p, view.mode), credited = b && view.mode === "msg" && !p.silent && p.clicked;
      return { fill: !b ? COL.none : credited ? COL.click : COL.truth, mark: credited ? "check" : null };
    }
    if (s.k === "holdout") return { hollow: 1 };
    if (s.k === "gone") return { ghost: 1 };
    if (s.k === "pending") return { fill: COL.idle, wait: 1 };
    if (!gm.rev) return { fill: COL.idle };
    if (s.k === "exit") return sv.kind === "day" && t > gm.hitT + .12 ? { ghost: 1 } : { fill: COL.exit, mark: "cross" };
    const k = dashKey(s.k);
    return { fill: COL[k], mark: k === "click" ? "check" : k === "open" ? "ring" : null };
  }

  function body(x, y, r) { g.beginPath(); g.arc(x, y - r * 1.02, r * .6, 0, TAU); g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
  function pawn(p, lk, dim, w) {
    const r = R, x = p.g.x, y = p.g.y - r * .75;
    g.globalAlpha = dim ? .14 : 1;
    g.fillStyle = "rgba(10,20,30,.22)"; g.beginPath(); g.ellipse(x, p.g.y + r * .1, r * .95, r * .38, 0, 0, TAU); g.fill();
    if (lk.ghost || lk.hollow) {
      body(x, y, r); g.fillStyle = lk.hollow ? "rgba(255,255,255,.88)" : "rgba(255,255,255,.4)"; g.fill();
      g.strokeStyle = lk.hollow ? COL.idle : "#6a7877"; g.lineWidth = 1.6; g.setLineDash(lk.ghost ? [3, 2.6] : []); g.stroke(); g.setLineDash([]);
    } else {
      g.fillStyle = "#fff"; body(x, y, r + 1.8); g.fill(); g.fillStyle = lk.fill; body(x, y, r); g.fill();   // white ring keeps overlapping residents apart
      if (lk.wait) { g.fillStyle = "#fff"; for (let k = 0; k < 3; k++) { g.globalAlpha = (dim ? .14 : 1) * (.35 + .65 * Math.max(0, Math.sin(w * 4 - k * .9))); g.beginPath(); g.arc(x + (k - 1) * r * .42, y, r * .14, 0, TAU); g.fill(); } g.globalAlpha = dim ? .14 : 1; }
    }
    if (lk.mark && r >= 7) {                                      // shape repeats what colour says
      g.strokeStyle = "#fff"; g.lineWidth = Math.max(1.6, r * .2); g.lineCap = "round"; g.lineJoin = "round"; const d = r * .42; g.beginPath();
      if (lk.mark === "cross") { g.moveTo(x - d, y - d); g.lineTo(x + d, y + d); g.moveTo(x + d, y - d); g.lineTo(x - d, y + d); }
      else if (lk.mark === "check") { g.moveTo(x - d, y); g.lineTo(x - d * .2, y + d * .75); g.lineTo(x + d, y - d * .7); }
      else g.arc(x, y, d * .8, 0, TAU);
      g.stroke(); g.lineCap = "butt"; g.lineJoin = "miter";
    }
    if (p.g.basket) { g.fillStyle = "#fff"; g.fillRect(x + r * .55, y + r * .05, r * .95, r * .8); g.fillStyle = COL.brand; g.fillRect(x + r * .7, y + r * .2, r * .65, r * .5); }
    g.globalAlpha = 1;
  }
  function note(x, y, ch, k) {           // the notification landing on a phone: push, email or KakaoTalk
    const s = R * .95, up = (1 - k) * 0 - k * s * .9; g.globalAlpha = 1 - k * k;
    g.fillStyle = ch === "kakao" ? "#f2c400" : ch === "email" ? "#fff" : COL.brand; g.strokeStyle = "#13232a"; g.lineWidth = 1.2;
    g.beginPath(); g.roundRect(x - s * .7, y - s * 1.1 + up, s * 1.4, s, 3); g.fill(); g.stroke();
    g.strokeStyle = ch === "email" ? "#13232a" : "#fff"; g.lineWidth = 1.4; g.beginPath();
    if (ch === "email") { g.moveTo(x - s * .7, y - s * 1.1 + up); g.lineTo(x, y - s * .55 + up); g.lineTo(x + s * .7, y - s * 1.1 + up); }
    else { g.moveTo(x - s * .35, y - s * .6 + up); g.lineTo(x + s * .35, y - s * .6 + up); }
    g.stroke(); g.globalAlpha = 1;
  }

  function draw(view, sv, clockMs) {
    const live = sv.kind === "live", shop = sv.kind === "shop", t = live ? LIVE_T : view.t, w = clockMs / 1000;
    const dark = live ? 0 : clamp(1 - seg(t, .02, .12) + seg(t, .76, .9), 0, 1), people = world.people;
    g.drawImage(bg, 0, 0, W, H);
    g.strokeStyle = "rgba(255,255,255,.45)"; g.lineWidth = 1.5; g.setLineDash([12, 20]);
    for (const o of [-.45, .4]) { g.lineDashOffset = -w * 16 * (o < 0 ? 1 : .7); g.beginPath(); g.moveTo(0, L.mid + L.wh * o); g.lineTo(W, L.mid + L.wh * o); g.stroke(); }
    g.setLineDash([]); g.lineDashOffset = 0;
    L.roads.forEach((x, k) => {                                   // one city bus per avenue: blue trunk line, green branch line
      const len = 26, span = H + len * 2, y = ((w * 34 + k * span * .47) % span) - len, yy = k % 2 ? H - y : y, bw = L.road * .4;
      g.fillStyle = "rgba(20,35,42,.18)"; g.fillRect(x - bw / 2 + 2, yy - len / 2 + 3, bw, len);
      g.fillStyle = k % 2 ? "#3aa35b" : "#2f6fd0"; g.beginPath(); g.roundRect(x - bw / 2, yy - len / 2, bw, len, 3); g.fill();
      g.fillStyle = "rgba(255,255,255,.75)"; g.fillRect(x - bw / 2 + 2, yy - len / 2 + 3, bw - 4, 4); g.fillRect(x - bw / 2 + 2, yy + len / 2 - 6, bw - 4, 3);
    });
    const warm = live ? 0 : Math.max((1 - seg(t, .08, .2)) * .14, seg(t, .58, .74) * (1 - seg(t, .78, .9)) * .2) * (1 - dark);
    if (warm > 0) { g.fillStyle = `rgba(255,150,90,${warm})`; g.fillRect(0, 0, W, H); }
    if (dark > 0) {
      g.fillStyle = `rgba(14,24,48,${.6 * dark})`; g.fillRect(0, 0, W, H); g.globalAlpha = dark;
      for (const b of B) { const n = b.res.length ? b.res.filter(p => p.g.home).length : (b.lit ? 2 : 0); b.win.forEach((q, k) => { if (k < n) { g.fillStyle = "#ffd66b"; g.fillRect(q[0], q[1], q[2], q[3]); } }); }
      for (const [x, y] of L.lamps) { g.fillStyle = "rgba(255,221,130,.28)"; g.beginPath(); g.arc(x, y, 15, 0, TAU); g.fill(); g.fillStyle = "#ffe9a8"; g.beginPath(); g.arc(x, y, 2.4, 0, TAU); g.fill(); }
      g.globalAlpha = 1;
    }
    // the message leaving the market
    const q = live ? (world.live ? clamp((clockMs - world.live.sentAt) / 1800, 0, 1.3) : 2) : seg(t, NOON, NOON + PULSE) + seg(t, NOON + PULSE, NOON + PULSE + .05) * .3;
    if (q > 0 && q < 1.3 && !shop) {
      g.strokeStyle = COL.brand; const rad = Math.min(q, 1) * maxD, fade = 1 - seg(q, .75, 1.3);
      for (const k of [0, 30, 60]) if (rad - k > 0) { g.globalAlpha = fade * (1 - k / 90); g.lineWidth = 3.5 - k / 30; g.beginPath(); g.arc(L.mx, L.my, rad - k, 0, TAU); g.stroke(); }
      g.globalAlpha = 1;
    }
    const dimmed = p => view.filter && categoryOf(world, sv, p) !== view.filter, sp = view.sel == null ? null : people[view.sel];
    // a thread from each click to the shop
    if (!shop && view.lens === "dash") for (const p of people) {
      const gm = p.g, s = stateOf(world, sv, p); if (!gm.rev || s.k !== "click" || gm.home || dimmed(p)) continue;
      const k = live ? clamp((clockMs - s.at) / 900, 0, 1) : seg(t, gm.hitT + .008, gm.hitT + .075), fade = live ? 1 : 1 - seg(t, .6, .66); if (fade <= 0) continue;
      const x0 = gm.x, y0 = gm.y - R * 2.2, [x1, y1] = L.sign, cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - 26 - Math.abs(x1 - x0) * .12;
      const bx = u => (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * cx + u * u * x1, by = u => (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * cy + u * u * y1;
      g.strokeStyle = COL.click; g.lineWidth = 1.6; g.globalAlpha = (k < 1 ? .9 : .28) * fade; g.beginPath(); g.moveTo(x0, y0);
      for (let i = 1; i <= 14; i++) g.lineTo(bx(i / 14 * k), by(i / 14 * k)); g.stroke();
      if (k < 1) { g.globalAlpha = 1; g.fillStyle = COL.click; g.beginPath(); g.arc(bx(k), by(k), 3.2, 0, TAU); g.fill(); }
      g.globalAlpha = 1;
    }
    if (sp) { g.strokeStyle = "#13232a"; g.globalAlpha = .55; g.lineWidth = 2; g.setLineDash([2, 6]); g.lineCap = "round"; g.beginPath(); sp.g.pts.forEach((pt, k) => (k ? g.lineTo(pt[0], pt[1]) : g.moveTo(pt[0], pt[1]))); g.stroke(); g.setLineDash([]); g.lineCap = "butt"; g.globalAlpha = 1; }
    // residents, back to front
    const ch = live ? (world.live ? world.live.message.channel : "push") : sv.kind === "day" ? world.messages[sv.d].channel : "";
    for (const p of people.filter(p => !p.g.home || p === sp).sort((a, b) => a.g.y - b.g.y)) {
      const gm = p.g, dim = dimmed(p) && p !== sp, s = stateOf(world, sv, p); pawn(p, look(view, sv, p, t), dim, w);
      if (dim || !gm.rev || s.k === "gone" || s.k === "holdout") continue;
      const k = live ? clamp((clockMs - s.at) / 800, 0, 1) : seg(t, gm.hitT, gm.hitT + .055);
      if (k < 1) { g.strokeStyle = `rgba(47,127,208,${1 - k})`; g.lineWidth = 2; g.beginPath(); g.arc(gm.x, gm.y - R * .9, R + 5 + k * 12, 0, TAU); g.stroke(); note(gm.x, gm.y - R * 2.1, ch, k); }
    }
    const ring = (p, c, lw) => { g.strokeStyle = "#fff"; g.lineWidth = lw + 2.5; g.beginPath(); g.arc(p.g.x, p.g.y - R * 1.05, R * 2, 0, TAU); g.stroke(); g.strokeStyle = c; g.lineWidth = lw; g.beginPath(); g.arc(p.g.x, p.g.y - R * 1.05, R * 2, 0, TAU); g.stroke(); };
    if (view.hover != null && view.hover !== view.sel) ring(people[view.hover], "#55656a", 1.5);
    if (sp) ring(sp, "#13232a", 2.5);
    // counter above the shop
    let label = "";
    if (shop) { if (t > .2) label = tr("mapShoppers", { n: people.filter(p => p.g.atMarket || (shops(p, view.mode) && t > p.g.ts + .2)).length }); }
    else if ((live || t >= NOON) && view.lens === "dash") label = tr("mapClicks", { n: people.filter(p => p.g.rev && stateOf(world, sv, p).k === "click").length });
    if (label) {
      g.font = `600 ${12 * L.fs}px "IBM Plex Sans KR",system-ui,sans-serif`; const lw = g.measureText(label).width + 16, lh = 20 * L.fs, x = L.mx - lw / 2, y = L.sign[1] - lh - 2;
      g.fillStyle = "#13232a"; g.beginPath(); g.roundRect(x, y, lw, lh, lh / 2); g.fill(); g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, L.mx, y + lh / 2 + .5); g.textAlign = "left";
    }
  }

  /** Resident nearest to a pointer position, or null. */
  function pick(clientX, clientY) {
    const b = cv.getBoundingClientRect(), x = (clientX - b.left) * W / b.width, y = (clientY - b.top) * H / b.height;
    let best = null, bd = 38;
    for (const p of world.people) { const d = Math.hypot(p.g.x - x, p.g.y - R - y); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  /** A resident's position in stage pixels, for the speech bubble. */
  function anchor(p) { const sw = stage.clientWidth, sh = stage.clientHeight; return { x: p.g.x * sw / W, y: p.g.y * sh / H, r: R * sw / W }; }
  /** The resident whose thought is shown on the map right now when nobody is selected. */
  function spotlight(view, sv, clockMs) {
    if (view.lens !== "dash" || view.filter) return null;
    if (sv.kind === "live") { const l = world.live && world.live.last; return l && clockMs - l.at < 3200 && world.live.results[l.i].r ? world.people[l.i] : null; }
    if (sv.kind !== "day") return null;
    const k = Math.floor((view.t - NOON - .075) / .085), p = view.t >= NOON + .075 && feat[sv.d] ? feat[sv.d][k] : null;
    return p && p.g.rev ? p : null;
  }
  return { layout, refresh, paintStatic, place, draw, pick, anchor, spotlight };
}

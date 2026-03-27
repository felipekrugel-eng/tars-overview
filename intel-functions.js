// INTEL PANEL - MARKET SIZING & COMPETITIVE LANDSCAPE FUNCTIONS

// ========== MARKET SIZING FUNCTIONS ==========

function intelSizingTab(id, el) {
  const sizing = document.getElementById('intel-sizing');
  sizing.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  sizing.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('p' + id).classList.add('active');
}

function intelCompTab(id, el) {
  const comp = document.getElementById('intel-comp');
  comp.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  comp.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('comp-p' + id).classList.add('active');
}

function showIntelTab(tabName) {
  // Hide tile selector when a sub-panel is shown
  var tileSelector = document.getElementById('intel-tile-selector');
  if (tileSelector) tileSelector.style.display = 'none';

  document.querySelectorAll('.intel-subpanel').forEach(function(p) { p.style.display = 'none'; });
  var panel = document.getElementById('intel-' + tabName);
  if (panel) panel.style.display = 'block';

  // Highlight active tile
  document.querySelectorAll('.intel-tile').forEach(function(t) { t.classList.remove('active-tile'); });
  var tile = document.querySelector('.intel-tile[data-tab="' + tabName + '"]');
  if (tile) tile.classList.add('active-tile');

  // Init sizing on first show
  if (tabName === 'sizing' && typeof intelUa === 'function') intelUa();
}

function showIntelTiles() {
  document.querySelectorAll('.intel-subpanel').forEach(function(p) { p.style.display = 'none'; });
  var tileSelector = document.getElementById('intel-tile-selector');
  if (tileSelector) tileSelector.style.display = '';
  document.querySelectorAll('.intel-tile').forEach(function(t) { t.classList.remove('active-tile'); });
}

function intelGp2() {
  return {
    gr: +document.getElementById('gR').value / 100,
    tr: +document.getElementById('tR').value / 100,
    sc: +document.getElementById('sC').value,
    pr: +document.getElementById('pR').value / 100
  };
}

function intelGetInf(ri) {
  return intelSC === 'c' ? 0 : ri * INTEL_DATA.INF_SCALE;
}

let intelSC = 'c';
let intelOC = {};
let intelCsrt = { c: 7, d: -1 };

function intelCalc(r, p) {
  const [nm, ct, lo, ti, mi, sm, me, ri, dp, ps, src, fl] = r;
  const inf = intelGetInf(ri);
  const g = INTEL_DATA.GP[ti];
  const tg = mi * g.m + sm * g.s + me * g.d + inf * g.i;
  const tt = tg * dp, tr = tg * p.gr + tt * p.tr;
  const sq = INTEL_DATA.SQ[ti], sa = INTEL_DATA.SA[ti];
  const cf = Math.min(p.sc / 1000, 1.5);
  const qs = Math.min(1, sq[1] * cf), qd = Math.min(1, sq[2] * cf);
  const am = Math.min(sa[0], p.sc), as2 = Math.min(sa[1], p.sc), ad = Math.min(sa[2], p.sc);
  const sg = mi * am + sm * qs * as2 + me * qd * ad + inf * Math.min(g.i, p.sc);
  const st = sg * dp, sr = sg * p.gr + st * p.tr;
  const ss = mi + sm * qs + me * qd + inf;
  return {
    nm, ct, lo, ti, mi, sm, me, inf, ri, dp, ps, src, fl,
    fml: mi + sm + me, all: mi + sm + me + inf, tg, tt, tr, sg, st, sr, ss,
    og: lo ? sg : 0, ot: lo ? st : 0, or_: lo ? sr : 0, os: lo ? ss : 0
  };
}

function intelCalcScenario(sc_, p) {
  const prev = intelSC;
  intelSC = sc_;
  const rows = INTEL_DATA.RAW.map(r => intelCalc(r, p));
  intelSC = prev;
  return rows.reduce((a, b) => ({
    all: a.all + b.all, fml: a.fml + b.fml, tg: a.tg + b.tg, tt: a.tt + b.tt,
    tr: a.tr + b.tr, sg: a.sg + b.sg, st: a.st + b.st, sr: a.sr + b.sr,
    ss: a.ss + b.ss, or_: a.or_ + b.or_
  }), { all: 0, fml: 0, tg: 0, tt: 0, tr: 0, sg: 0, st: 0, sr: 0, ss: 0, or_: 0 });
}

function intelFB(v) {
  if (isNaN(v) || v === null) return '—';
  if (Math.abs(v) >= 1000) return '$' + (v / 1000).toFixed(1) + 'T';
  if (Math.abs(v) >= 1) return '$' + v.toFixed(1) + 'B';
  if (Math.abs(v) >= .001) return '$' + (v * 1000).toFixed(0) + 'M';
  return '$' + (v * 1e6).toFixed(0) + 'K';
}

function intelFM(v) {
  if (v === 0) return '0';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'B';
  if (v >= 1) return v.toFixed(1) + 'M';
  if (v >= .001) return (v * 1000).toFixed(1) + 'K';
  return v.toFixed(3) + 'M';
}

function intelPctS(v) {
  return (v * 100).toFixed(0) + '%';
}

function intelPB(s) {
  if (s === 'S') return '<span class="ps ps-S">Stripe</span>';
  if (s === 'P') return '<span class="ps ps-P">Partner</span>';
  if (s === 'B') return '<span class="ps ps-B">Stripe+Teya</span>';
  return '<span class="ps ps-N">N/A</span>';
}

function intelTB(t) {
  return '<span class="ti ti-' + t + '">' + t + '</span>';
}

function intelSetSc(s) {
  intelSC = s;
  const sizing = document.getElementById('intel-sizing');
  const btnC = sizing.querySelector('#btn-c');
  const btnE = sizing.querySelector('#btn-e');
  const scNote = sizing.querySelector('#sc-note');

  if (btnC) btnC.className = 'sc-btn ' + (s === 'c' ? 'on-c' : 'off');
  if (btnE) btnE.className = 'sc-btn ' + (s === 'e' ? 'on-e' : 'off');

  const notes = {
    c: '360M registered SMBs · official national counts',
    e: '445M total · formal (360M) + scaled informal (85M) · IFC MSME Finance Gap 2024'
  };
  if (scNote) scNote.textContent = notes[s];

  intelUa();
}

function intelUa() {
  const sizing = document.getElementById('intel-sizing');
  if (!sizing) return;

  const p = intelGp2();
  const gRv = sizing.querySelector('#gRv');
  const tRv = sizing.querySelector('#tRv');
  const sCv = sizing.querySelector('#sCv');
  const pRv = sizing.querySelector('#pRv');
  const scL = sizing.querySelector('#sc-l');
  const lpL = sizing.querySelector('#lp-l');

  if (gRv) gRv.textContent = (p.gr * 100).toFixed(2) + '%';
  if (tRv) tRv.textContent = (p.tr * 100).toFixed(2) + '%';
  if (sCv) sCv.textContent = p.sc >= 1000 ? '$' + (p.sc / 1000).toFixed(1) + 'M' : '$' + p.sc + 'K';
  if (pRv) pRv.textContent = (p.pr * 100).toFixed(1) + '%';
  if (scL) scL.textContent = p.sc >= 1000 ? '$' + (p.sc / 1000).toFixed(1) + 'M' : '$' + p.sc + 'K';
  if (lpL) lpL.textContent = (p.pr * 100).toFixed(1) + '%';

  sizing.querySelectorAll('[id^="th-inf"], [id^="dh-inf"], [id^="cyh-inf"]').forEach(el => {
    el.style.opacity = intelSC === 'e' ? '1' : '0.35';
  });

  const rows = INTEL_DATA.RAW.map(r => intelCalc(r, p));
  const T = rows.reduce((a, b) => ({
    all: a.all + b.all, fml: a.fml + b.fml, inf: a.inf + (b.inf || 0),
    tg: a.tg + b.tg, tt: a.tt + b.tt, tr: a.tr + b.tr,
    sg: a.sg + b.sg, st: a.st + b.st, sr: a.sr + b.sr, ss: a.ss + b.ss,
    og: a.og + b.og, ot: a.ot + b.ot, or_: a.or_ + b.or_, os: a.os + b.os
  }), { all: 0, fml: 0, inf: 0, tg: 0, tt: 0, tr: 0, sg: 0, st: 0, sr: 0, ss: 0, og: 0, ot: 0, or_: 0, os: 0 });

  const lr = T.or_ * p.pr, lg = T.og * p.gr * p.pr, lt = T.ot * p.tr * p.pr;

  const tS = sizing.querySelector('#t-s');
  const tG = sizing.querySelector('#t-g');
  const tT = sizing.querySelector('#t-t');
  const tR = sizing.querySelector('#t-r');
  const sS = sizing.querySelector('#s-s');
  const sG = sizing.querySelector('#s-g');
  const sT = sizing.querySelector('#s-t');
  const sR = sizing.querySelector('#s-r');
  const oS = sizing.querySelector('#o-s');
  const oG = sizing.querySelector('#o-g');
  const oT = sizing.querySelector('#o-t');
  const oR = sizing.querySelector('#o-r');
  const lR = sizing.querySelector('#l-r');
  const lG = sizing.querySelector('#l-g');
  const lT = sizing.querySelector('#l-t');

  if (tS) tS.textContent = intelFM(T.all);
  if (tG) tG.textContent = intelFB(T.tg);
  if (tT) tT.textContent = intelFB(T.tt);
  if (tR) tR.textContent = intelFB(T.tr);
  if (sS) sS.textContent = intelFM(T.ss);
  if (sG) sG.textContent = intelFB(T.sg);
  if (sT) sT.textContent = intelFB(T.st);
  if (sR) sR.textContent = intelFB(T.sr);
  if (oS) oS.textContent = intelFM(T.os);
  if (oG) oG.textContent = intelFB(T.og);
  if (oT) oT.textContent = intelFB(T.ot);
  if (oR) oR.textContent = intelFB(T.or_);
  if (lR) lR.textContent = intelFB(lr);
  if (lG) lG.textContent = intelFB(lg);
  if (lT) lT.textContent = intelFB(lt);

  intelRoOv(rows, T);
  intelRoDr(rows, T);
  intelRoCy(rows, p, T);
  intelRoComp(p);
}

function intelRoOv(rows, T) {
  const sizing = document.getElementById('intel-sizing');
  if (!sizing) return;

  const C = {};
  rows.forEach(r => {
    const c = r.ct;
    if (!C[c]) C[c] = { ff: 0, fi: 0, tg: 0, tt: 0, tr: 0, sr: 0, or_: 0 };
    C[c].ff += r.fml;
    C[c].fi += r.inf;
    C[c].tg += r.tg;
    C[c].tt += r.tt;
    C[c].tr += r.tr;
    C[c].sr += r.sr;
    C[c].or_ += r.or_;
  });

  const ovTb = sizing.querySelector('#ov-tb');
  if (ovTb) {
    ovTb.innerHTML = INTEL_DATA.CORD.filter(c => C[c]).map(c => {
      const d = C[c];
      return `<tr><td><strong>${c}</strong></td><td class="num">${intelFM(d.ff)}</td><td class="num">${intelSC === 'e' ? intelFM(d.fi) : '—'}</td><td class="num">${intelFB(d.tg)}</td><td class="num">${intelFB(d.tt)}</td><td class="num" style="color:var(--tc);font-weight:700">${intelFB(d.tr)}</td><td class="num" style="color:var(--sc);font-weight:700">${intelFB(d.sr)}</td><td class="num" style="color:var(--oc);font-weight:700">${intelFB(d.or_)}</td></tr>`;
    }).join('');
  }

  const ovFf = sizing.querySelector('#ov-ff');
  const ovFi = sizing.querySelector('#ov-fi');
  const ovFg = sizing.querySelector('#ov-fg');
  const ovFt = sizing.querySelector('#ov-ft');
  const ovFr = sizing.querySelector('#ov-fr');
  const ovFs = sizing.querySelector('#ov-fs');
  const ovFo = sizing.querySelector('#ov-fo');

  if (ovFf) ovFf.textContent = intelFM(T.fml);
  if (ovFi) ovFi.textContent = intelSC === 'e' ? intelFM(T.inf) : '—';
  if (ovFg) ovFg.textContent = intelFB(T.tg);
  if (ovFt) ovFt.textContent = intelFB(T.tt);
  if (ovFr) ovFr.textContent = intelFB(T.tr);
  if (ovFs) ovFs.textContent = intelFB(T.sr);
  if (ovFo) ovFo.textContent = intelFB(T.or_);
}

function intelRoDr(rows, T) {
  const sizing = document.getElementById('intel-sizing');
  if (!sizing) return;

  const BC = {};
  rows.forEach(r => {
    (BC[r.ct] = BC[r.ct] || []).push(r);
  });

  let h = '';
  INTEL_DATA.CORD.forEach(ct => {
    const cr = BC[ct] || [];
    const cs = cr.reduce((a, b) => ({
      mi: a.mi + b.mi, sm: a.sm + b.sm, me: a.me + b.me, inf: a.inf + b.inf,
      tg: a.tg + b.tg, tt: a.tt + b.tt, tr: a.tr + b.tr,
      sg: a.sg + b.sg, sr: a.sr + b.sr, or_: a.or_ + b.or_
    }), { mi: 0, sm: 0, me: 0, inf: 0, tg: 0, tt: 0, tr: 0, sg: 0, sr: 0, or_: 0 });

    const op = intelOC[ct];
    h += `<tr class="crr${op ? ' open' : ''}" onclick="intelTC('${ct.replace(/'/g, "\\'")}')" style="cursor:pointer;"><td><span class="ex">&#9658;</span><strong>${ct}</strong></td><td class="num">${intelFM(cs.mi)}</td><td class="num">${intelFM(cs.sm)}</td><td class="num">${intelFM(cs.me)}</td><td class="num">${intelSC === 'e' ? intelFM(cs.inf) : '—'}</td><td class="num">${intelFB(cs.tg)}</td><td class="num">${intelFB(cs.tt)}</td><td class="num" style="color:var(--tc);font-weight:700">${intelFB(cs.tr)}</td><td class="num">${intelFB(cs.sg)}</td><td class="num" style="color:var(--sc);font-weight:700">${intelFB(cs.sr)}</td><td class="num" style="color:var(--oc);font-weight:700">${intelFB(cs.or_)}</td><td></td></tr>`;

    cr.forEach(r => {
      h += `<tr class="cyr${r.lo ? ' loy' : ''} ${op ? 'vis' : ''}" data-c="${ct.replace(/"/g, '&quot;')}"><td>${r.fl} ${r.nm}${r.lo ? '<span class="ld"></span>' : ''}</td><td class="num">${intelFM(r.mi)}</td><td class="num">${intelFM(r.sm)}</td><td class="num">${intelFM(r.me)}</td><td class="num">${intelSC === 'e' ? intelFM(r.inf) : '—'}</td><td class="num">${intelFB(r.tg)}</td><td class="num">${intelFB(r.tt)}</td><td class="num" style="color:var(--tc)">${intelFB(r.tr)}</td><td class="num">${intelFB(r.sg)}</td><td class="num" style="color:var(--sc)">${intelFB(r.sr)}</td><td class="num" style="color:var(--oc)">${intelFB(r.or_)}</td><td>${intelTB(r.ti)}</td></tr>`;
    });
  });

  const ctTb = sizing.querySelector('#ct-tb');
  if (ctTb) ctTb.innerHTML = h;

  const cfM = sizing.querySelector('#cf-m');
  const cfS = sizing.querySelector('#cf-s');
  const cfD = sizing.querySelector('#cf-d');
  const cfI = sizing.querySelector('#cf-i');
  const cfG = sizing.querySelector('#cf-g');
  const cfT = sizing.querySelector('#cf-t');
  const cfR = sizing.querySelector('#cf-r');
  const cfSg = sizing.querySelector('#cf-sg');
  const cfSr = sizing.querySelector('#cf-sr');
  const cfOr = sizing.querySelector('#cf-or');

  if (cfM) cfM.textContent = intelFM(INTEL_DATA.RAW.reduce((s, r) => s + r[4], 0));
  if (cfS) cfS.textContent = intelFM(INTEL_DATA.RAW.reduce((s, r) => s + r[5], 0));
  if (cfD) cfD.textContent = intelFM(INTEL_DATA.RAW.reduce((s, r) => s + r[6], 0));
  if (cfI) cfI.textContent = intelSC === 'e' ? intelFM(INTEL_DATA.RAW.reduce((s, r) => s + r[7] * INTEL_DATA.INF_SCALE, 0)) : '—';
  if (cfG) cfG.textContent = intelFB(T.tg);
  if (cfT) cfT.textContent = intelFB(T.tt);
  if (cfR) cfR.textContent = intelFB(T.tr);
  if (cfSg) cfSg.textContent = intelFB(T.sg);
  if (cfSr) cfSr.textContent = intelFB(T.sr);
  if (cfOr) cfOr.textContent = intelFB(T.or_);
}

function intelTC(ct) {
  const sizing = document.getElementById('intel-sizing');
  if (!sizing) return;

  intelOC[ct] = !intelOC[ct];
  sizing.querySelectorAll(`[data-c="${ct}"]`).forEach(tr => tr.classList.toggle('vis', intelOC[ct]));
  sizing.querySelectorAll('.crr').forEach(tr => {
    if (tr.querySelector('strong') && tr.querySelector('strong').textContent === ct) {
      tr.classList.toggle('open', intelOC[ct]);
    }
  });
}

function intelRoCy(rows, p, T) {
  const sizing = document.getElementById('intel-sizing');
  if (!sizing) return;

  if (!rows) {
    const pp = intelGp2();
    rows = INTEL_DATA.RAW.map(r => intelCalc(r, pp));
    p = pp;
  }

  const reg = sizing.querySelector('#cy-reg');
  const lov = sizing.querySelector('#cy-lov');
  const psp = sizing.querySelector('#cy-psp');
  const q = sizing.querySelector('#cy-q');
  const regVal = reg ? reg.value : '';
  const lovVal = lov ? lov.value : '';
  const pspVal = psp ? psp.value : '';
  const qVal = (q ? q.value : '').toLowerCase();

  let f = rows.filter(r => {
    if (regVal && r.ct !== regVal) return false;
    if (lovVal === '1' && !r.lo) return false;
    if (lovVal === '0' && r.lo) return false;
    if (pspVal && r.ps !== pspVal) return false;
    if (qVal && !r.nm.toLowerCase().includes(qVal)) return false;
    return true;
  });

  const cm = [null, 'ct', 'ti', 'fml', 'inf', 'tg', 'tt', 'tr', 'sr', 'or_', 'dp'];
  f.sort((a, b) => {
    const k = cm[intelCsrt.c];
    if (!k) return 0;
    const va = a[k] ?? -Infinity, vb = b[k] ?? -Infinity;
    return typeof va === 'string' ? intelCsrt.d * va.localeCompare(vb) : intelCsrt.d * (va - vb);
  });

  const cyC = sizing.querySelector('#cy-c');
  if (cyC) cyC.textContent = f.length + ' countries';

  const cyTb = sizing.querySelector('#cy-tb');
  if (cyTb) {
    cyTb.innerHTML = f.map(r => `<tr class="${r.lo ? 'loy' : 'out'}"><td>${r.fl}${r.lo ? '<span class="ld"></span>' : ''}${r.nm}</td><td>${r.ct}</td><td>${intelTB(r.ti)}</td><td class="num">${intelFM(r.fml)}</td><td class="num">${intelSC === 'e' ? intelFM(r.inf) : '—'}</td><td class="num">${intelFB(r.tg)}</td><td class="num">${intelFB(r.tt)}</td><td class="num" style="color:var(--tc);font-weight:700">${intelFB(r.tr)}</td><td class="num" style="color:var(--sc);font-weight:700">${intelFB(r.sr)}</td><td class="num" style="color:var(--oc);font-weight:700">${intelFB(r.or_)}</td><td class="num">${intelPctS(r.dp)}</td><td>${intelPB(r.ps)}</td><td style="color:var(--mid-gray);font-size:11px;max-width:160px;white-space:normal">${r.src}</td></tr>`).join('');
  }
}

function intelRct() {
  intelRoCy();
}

function intelSc2(c) {
  if (intelCsrt.c === c) intelCsrt.d *= -1;
  else {
    intelCsrt.c = c;
    intelCsrt.d = -1;
  }
  intelRoCy();
}

function intelRoComp(p) {
  const sizing = document.getElementById('intel-sizing');
  if (!sizing) return;

  const C = intelCalcScenario('c', p);
  const E = intelCalcScenario('e', p);
  const lc = C.or_ * p.pr;
  const le = E.or_ * p.pr;

  const ccpLbl = sizing.querySelector('#ccp-lbl');
  const cepLbl = sizing.querySelector('#cep-lbl');
  if (ccpLbl) ccpLbl.textContent = (p.pr * 100).toFixed(1) + '%';
  if (cepLbl) cepLbl.textContent = (p.pr * 100).toFixed(1) + '%';

  const f = (id, v) => {
    const el = sizing.querySelector(id);
    if (el) el.textContent = v;
  };

  f('#cc-smbs', intelFM(C.all));
  f('#cc-gtv', intelFB(C.tg));
  f('#cc-tpv', intelFB(C.tt));
  f('#cc-tr', intelFB(C.tr));
  f('#cc-sr', intelFB(C.sr));
  f('#cc-or', intelFB(C.or_));
  f('#cc-lr', intelFB(lc));

  f('#ce-smbs', intelFM(E.all));
  f('#ce-gtv', intelFB(E.tg));
  f('#ce-tpv', intelFB(E.tt));
  f('#ce-tr', intelFB(E.tr));
  f('#ce-sr', intelFB(E.sr));
  f('#ce-or', intelFB(E.or_));
  f('#ce-lr', intelFB(le));

  const metrics = [
    ['Total SMBs', intelFM(C.all), intelFM(E.all), (E.all - C.all), E.all / C.all - 1, true],
    ['TAM GTV', intelFB(C.tg), intelFB(E.tg), (E.tg - C.tg), E.tg / C.tg - 1, false],
    ['TAM revenue potential', intelFB(C.tr), intelFB(E.tr), (E.tr - C.tr), E.tr / C.tr - 1, false],
    ['SAM revenue potential', intelFB(C.sr), intelFB(E.sr), (E.sr - C.sr), E.sr / C.sr - 1, false],
    ['SOM revenue potential', intelFB(C.or_), intelFB(E.or_), (E.or_ - C.or_), E.or_ / C.or_ - 1, false],
    ['Loyverse revenue', intelFB(lc), intelFB(le), (le - lc), le / lc - 1, false]
  ];

  const cmpTb = sizing.querySelector('#cmp-tb');
  if (cmpTb) {
    cmpTb.innerHTML = metrics.map(([k, vc, ve, da, dp, isSMB]) => `<tr><td><strong>${k}</strong></td><td class="num">${vc}</td><td class="num">${ve}</td><td class="num" style="color:var(--blue);font-weight:700">+${isSMB ? intelFM(da) : intelFB(da)}</td><td class="num" style="color:var(--blue);font-weight:700">+${(dp * 100).toFixed(1)}%</td></tr>`).join('');
  }
}

// Initialize market sizing when DOM is ready
document.addEventListener("DOMContentLoaded", function() {
  // Delay init until INTEL panel is first shown
  var _intelInit = false;
  var origShowPanel = window.showPanel;
  if (typeof origShowPanel === "function") {
    window.showPanel = function(name) {
      origShowPanel(name);
      if (name === "intel") {
        // Always reset to tile view when clicking the Market Intel tab
        showIntelTiles();
        if (!_intelInit) {
          _intelInit = true;
        }
      }
    };
  }
});

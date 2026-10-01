'use strict';
/* 줌스팟: 화면 확대 + 주석(화살표/사각형/펜/형광펜) + 마우스 스포트라이트 */

const $ = (s) => document.querySelector(s);
const stage = $('#stage'), baseCv = $('#base'), fxCv = $('#fx');
const bctx = baseCv.getContext('2d'), fctx = fxCv.getContext('2d');

/* ───────── 상태 ───────── */
const MIN_ZOOM = 1, MAX_ZOOM = 8;
const state = {
  source: null,            // video | img | canvas
  tool: 'arrow',
  color: '#ff3b30',
  width: 5,
  fill: false,
  anns: [], redo: [], draft: null,
  view: { z: 1, px: 0, py: 0 },     // 현재 뷰
  target: { z: 1, px: 0, py: 0 },   // 애니메이션 목표
  mouse: { x: -999, y: -999, inside: false },
  spot: { on: false, size: 70, opacity: 0.35, style: 'highlight', dim: 0.65, color: '#ffe600' },
  ripples: [],
  pinToolbar: false,
  stream: null,
};
let W = 0, H = 0, dpr = 1;

/* ───────── 설정 저장 ───────── */
const KEY = 'zoomspot.settings.v1';
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (s.color) state.color = s.color;
    if (s.width) state.width = s.width;
    if (typeof s.fill === 'boolean') state.fill = s.fill;
    if (s.spot) Object.assign(state.spot, s.spot, { on: false });
  } catch (e) { /* 무시 */ }
}
function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      color: state.color, width: state.width, fill: state.fill,
      spot: { size: state.spot.size, opacity: state.spot.opacity, style: state.spot.style, dim: state.spot.dim, color: state.spot.color },
    }));
  } catch (e) { /* 무시 */ }
}

/* ───────── 유틸 ───────── */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
}
function srcSize(s) {
  if (!s) return [0, 0];
  if (s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight];
  if (s instanceof HTMLImageElement) return [s.naturalWidth, s.naturalHeight];
  return [s.width, s.height];
}
function fitRect() {
  const [sw, sh] = srcSize(state.source);
  if (!sw || !sh) return { x: 0, y: 0, w: W, h: H };
  const k = Math.min(W / sw, H / sh);
  const w = sw * k, h = sh * k;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
// 화면 좌표 → 월드(확대 전 스테이지) 좌표
const toWorld = (sx, sy) => ({ x: (sx - state.view.px) / state.view.z, y: (sy - state.view.py) / state.view.z });

/* ───────── 리사이즈 ───────── */
function resize() {
  W = stage.clientWidth; H = stage.clientHeight; dpr = window.devicePixelRatio || 1;
  for (const c of [baseCv, fxCv]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  clampTarget();
}
window.addEventListener('resize', resize);

/* ───────── 뷰(확대/이동) ───────── */
function clampPan(t) {
  t.px = clamp(t.px, W * (1 - t.z), 0);
  t.py = clamp(t.py, H * (1 - t.z), 0);
}
function clampTarget() { clampPan(state.target); clampPan(state.view); }

function zoomAt(sx, sy, factor) {
  const t = state.target;
  const nz = clamp(t.z * factor, MIN_ZOOM, MAX_ZOOM);
  if (nz === t.z) return;
  const wx = (sx - t.px) / t.z, wy = (sy - t.py) / t.z;
  t.z = nz; t.px = sx - wx * nz; t.py = sy - wy * nz;
  clampPan(t);
  updateZoomToast();
}
function resetZoom() {
  Object.assign(state.target, { z: 1, px: 0, py: 0 });
  toast('확대 해제');
}
function updateZoomToast() { toast(`확대 ${state.target.z.toFixed(1)}x`); }

function stepView() {
  const v = state.view, t = state.target;
  const k = 0.22; // 약 200ms 수렴
  v.z += (t.z - v.z) * k; v.px += (t.px - v.px) * k; v.py += (t.py - v.py) * k;
  if (Math.abs(t.z - v.z) < 0.001 && Math.abs(t.px - v.px) < 0.3 && Math.abs(t.py - v.py) < 0.3) {
    v.z = t.z; v.px = t.px; v.py = t.py;
  }
}

/* ───────── 주석 그리기 ───────── */
function drawArrow(c, a) {
  const { x1, y1, x2, y2 } = a;
  const head = Math.max(14, a.width * 4);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  c.strokeStyle = a.color; c.fillStyle = a.color; c.lineWidth = a.width; c.lineCap = 'round'; c.lineJoin = 'round';
  const len = Math.hypot(x2 - x1, y2 - y1);
  const bx = len > head ? x2 - Math.cos(ang) * head * 0.8 : x1, by = len > head ? y2 - Math.sin(ang) * head * 0.8 : y1;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(bx, by); c.stroke();
  c.beginPath();
  c.moveTo(x2, y2);
  c.lineTo(x2 - head * Math.cos(ang - Math.PI / 7), y2 - head * Math.sin(ang - Math.PI / 7));
  c.lineTo(x2 - head * Math.cos(ang + Math.PI / 7), y2 - head * Math.sin(ang + Math.PI / 7));
  c.closePath(); c.fill();
}
function drawRect(c, a) {
  const x = Math.min(a.x1, a.x2), y = Math.min(a.y1, a.y2), w = Math.abs(a.x2 - a.x1), h = Math.abs(a.y2 - a.y1);
  c.lineWidth = a.width; c.lineJoin = 'round';
  if (a.fill) { c.globalAlpha = 0.3; c.fillStyle = a.color; c.fillRect(x, y, w, h); c.globalAlpha = 1; }
  c.strokeStyle = a.color; c.strokeRect(x, y, w, h);
}
function drawStroke(c, a, marker) {
  if (!a.pts.length) return;
  c.strokeStyle = a.color; c.lineWidth = marker ? a.width * 4 : a.width;
  c.lineCap = marker ? 'butt' : 'round'; c.lineJoin = 'round';
  if (marker) c.globalAlpha = 0.35;
  c.beginPath(); c.moveTo(a.pts[0].x, a.pts[0].y);
  if (a.pts.length === 1) c.lineTo(a.pts[0].x + 0.01, a.pts[0].y);
  for (let i = 1; i < a.pts.length; i++) c.lineTo(a.pts[i].x, a.pts[i].y);
  c.stroke(); c.globalAlpha = 1;
}
function drawAnn(c, a) {
  c.save();
  if (a.type === 'arrow') drawArrow(c, a);
  else if (a.type === 'rect') drawRect(c, a);
  else if (a.type === 'pen') drawStroke(c, a, false);
  else if (a.type === 'marker') drawStroke(c, a, true);
  c.restore();
}

/* ───────── 렌더링 ───────── */
function renderScene(c, scale, view) {
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  c.setTransform(scale * view.z, 0, 0, scale * view.z, scale * view.px, scale * view.py);
  const s = state.source;
  if (s) {
    const [sw, sh] = srcSize(s);
    if (sw && sh) { const r = fitRect(); c.drawImage(s, r.x, r.y, r.w, r.h); }
  }
  for (const a of state.anns) drawAnn(c, a);
  if (state.draft) drawAnn(c, state.draft);
}

function drawSpot() {
  fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fctx.clearRect(0, 0, W, H);
  const sp = state.spot, m = state.mouse;
  if (sp.on && m.inside) {
    const r = sp.size;
    if (sp.style === 'highlight') {
      fctx.globalAlpha = sp.opacity; fctx.fillStyle = sp.color;
      fctx.beginPath(); fctx.arc(m.x, m.y, r, 0, Math.PI * 2); fctx.fill(); fctx.globalAlpha = 1;
    } else if (sp.style === 'dim') {
      const g = fctx.createRadialGradient(m.x, m.y, r * 0.85, m.x, m.y, r);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${sp.dim})`);
      fctx.fillStyle = g; fctx.fillRect(0, 0, W, H);
    } else if (sp.style === 'ring') {
      fctx.globalAlpha = sp.opacity * 0.5; fctx.fillStyle = sp.color;
      fctx.beginPath(); fctx.arc(m.x, m.y, r, 0, Math.PI * 2); fctx.fill();
      fctx.globalAlpha = 0.95; fctx.strokeStyle = sp.color; fctx.lineWidth = 4;
      fctx.beginPath(); fctx.arc(m.x, m.y, r, 0, Math.PI * 2); fctx.stroke(); fctx.globalAlpha = 1;
    } else if (sp.style === 'cross') {
      fctx.strokeStyle = sp.color; fctx.lineWidth = 2; fctx.globalAlpha = Math.min(1, sp.opacity + 0.4);
      fctx.beginPath();
      fctx.moveTo(0, m.y); fctx.lineTo(W, m.y); fctx.moveTo(m.x, 0); fctx.lineTo(m.x, H); fctx.stroke();
      fctx.lineWidth = 3; fctx.beginPath(); fctx.arc(m.x, m.y, Math.min(r, 40), 0, Math.PI * 2); fctx.stroke();
      fctx.globalAlpha = 1;
    }
  }
  // 클릭 물결
  const now = performance.now();
  state.ripples = state.ripples.filter((p) => now - p.t0 < 650);
  for (const p of state.ripples) {
    const k = (now - p.t0) / 650;
    fctx.globalAlpha = 1 - k; fctx.strokeStyle = p.color; fctx.lineWidth = 4 * (1 - k) + 1;
    fctx.beginPath(); fctx.arc(p.x, p.y, 8 + k * Math.max(40, sp.size * 1.1), 0, Math.PI * 2); fctx.stroke();
  }
  fctx.globalAlpha = 1;
}

function frame() {
  stepView();
  renderScene(bctx, dpr, state.view);
  drawSpot();
  requestAnimationFrame(frame);
}

/* ───────── 포인터 입력 ───────── */
let spaceDown = false, drag = null;

function pos(e) { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

stage.addEventListener('pointerdown', (e) => {
  if (!state.source) return;
  const p = pos(e);
  state.mouse = { x: p.x, y: p.y, inside: true };
  if (state.spot.on) state.ripples.push({ x: p.x, y: p.y, t0: performance.now(), color: e.button === 2 ? '#ff5a5a' : state.spot.color });
  closePanel();
  stage.setPointerCapture(e.pointerId);

  const panning = e.button === 1 || spaceDown || (state.tool === 'pan' && e.button === 0);
  if (panning) {
    drag = { mode: 'pan', sx: p.x, sy: p.y, px: state.view.px, py: state.view.py };
    stage.classList.add('panning'); e.preventDefault(); return;
  }
  if (e.button !== 0) return;
  const w = toWorld(p.x, p.y);
  const base = { type: state.tool, color: state.color, width: state.width };
  if (state.tool === 'arrow') state.draft = { ...base, x1: w.x, y1: w.y, x2: w.x, y2: w.y };
  else if (state.tool === 'rect') state.draft = { ...base, fill: state.fill, x1: w.x, y1: w.y, x2: w.x, y2: w.y };
  else state.draft = { ...base, pts: [w] };
  drag = { mode: 'draw' };
});

stage.addEventListener('pointermove', (e) => {
  const p = pos(e);
  state.mouse = { x: p.x, y: p.y, inside: true };
  if (!drag) return;
  if (drag.mode === 'pan') {
    const v = state.view, t = state.target;
    v.px = drag.px + (p.x - drag.sx); v.py = drag.py + (p.y - drag.sy);
    clampPan(v); t.z = v.z; t.px = v.px; t.py = v.py;
  } else if (state.draft) {
    const w = toWorld(p.x, p.y), d = state.draft;
    if (d.pts) d.pts.push(w);
    else { d.x2 = w.x; d.y2 = w.y; }
  }
});

function endDrag() {
  if (!drag) return;
  if (drag.mode === 'draw' && state.draft) {
    const d = state.draft;
    const tiny = d.pts ? false : Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 3;
    if (!tiny) { state.anns.push(d); state.redo = []; updateButtons(); }
    state.draft = null;
  }
  stage.classList.remove('panning');
  drag = null;
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('pointerleave', () => { if (!drag) state.mouse.inside = false; });
stage.addEventListener('pointerenter', () => { state.mouse.inside = true; });

stage.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (drag) return;
  if (state.anns.length) { undo(); toast(`주석 취소 (남은 ${state.anns.length}개)`); }
  else if (state.target.z > 1.001) resetZoom(); // 지울 주석이 없으면 확대 해제
});

stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!state.source) return;
  const delta = e.deltaY || e.deltaX;
  if (e.shiftKey) { setWidth(state.width + (delta < 0 ? 1 : -1)); toast(`굵기 ${state.width}`); return; }
  const p = pos(e);
  zoomAt(p.x, p.y, delta < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });

/* ───────── 도구/색/굵기/스포트 ───────── */
function setTool(t) {
  state.tool = t;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  stage.className = stage.className.replace(/tool-\w+/g, '').trim();
  stage.classList.add('tool-' + t);
  if (state.spot.on) stage.classList.add('spot-on');
}
function setColor(c) {
  state.color = c;
  document.querySelectorAll('.sw').forEach((b) => b.classList.toggle('active', b.dataset.color === c));
  $('#colorPicker').value = c;
  saveSettings();
}
function setWidth(w) {
  state.width = clamp(w, 1, 30); $('#width').value = state.width; saveSettings();
}
function toggleSpot(force) {
  state.spot.on = typeof force === 'boolean' ? force : !state.spot.on;
  $('#btnSpot').classList.toggle('active', state.spot.on);
  stage.classList.toggle('spot-on', state.spot.on);
  toast(state.spot.on ? '스포트라이트 켜짐' : '스포트라이트 꺼짐');
}

const panel = $('#spotPanel');
function closePanel() { panel.hidden = true; }
function syncSpotUI() {
  const s = state.spot;
  $('#spotStyle').value = s.style; $('#spotSize').value = s.size;
  $('#spotOpacity').value = Math.round(s.opacity * 100); $('#spotDim').value = Math.round(s.dim * 100);
  $('#spotColor').value = s.color;
  $('#spotSizeV').textContent = s.size + 'px';
  $('#spotOpV').textContent = Math.round(s.opacity * 100) + '%';
  $('#spotDimV').textContent = Math.round(s.dim * 100) + '%';
}

document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('.sw').forEach((b) => b.addEventListener('click', () => setColor(b.dataset.color)));
$('#colorPicker').addEventListener('input', (e) => setColor(e.target.value));
$('#width').addEventListener('input', (e) => setWidth(+e.target.value));
$('#fill').addEventListener('change', (e) => { state.fill = e.target.checked; saveSettings(); });
$('#btnSpot').addEventListener('click', () => toggleSpot());
$('#btnSpotCfg').addEventListener('click', () => { panel.hidden = !panel.hidden; });
$('#spotStyle').addEventListener('change', (e) => { state.spot.style = e.target.value; syncSpotUI(); saveSettings(); });
$('#spotSize').addEventListener('input', (e) => { state.spot.size = +e.target.value; syncSpotUI(); saveSettings(); });
$('#spotOpacity').addEventListener('input', (e) => { state.spot.opacity = e.target.value / 100; syncSpotUI(); saveSettings(); });
$('#spotDim').addEventListener('input', (e) => { state.spot.dim = e.target.value / 100; syncSpotUI(); saveSettings(); });
$('#spotColor').addEventListener('input', (e) => { state.spot.color = e.target.value; saveSettings(); });

/* ───────── 편집 ───────── */
function undo() { const a = state.anns.pop(); if (a) { state.redo.push(a); updateButtons(); } }
function redo() { const a = state.redo.pop(); if (a) { state.anns.push(a); updateButtons(); } }
function clearAll() {
  if (!state.anns.length) return;
  state.redo = state.anns.slice().reverse(); // 다시실행으로 복구 가능
  state.anns = []; updateButtons(); toast('주석을 모두 지웠습니다 (Ctrl+Y로 복구)');
}
function updateButtons() {
  $('#btnUndo').disabled = !state.anns.length;
  $('#btnRedo').disabled = !state.redo.length;
  $('#btnClear').disabled = !state.anns.length;
}
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
$('#btnClear').addEventListener('click', clearAll);

function savePNG() {
  if (!state.source) return;
  const c = document.createElement('canvas');
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  renderScene(c.getContext('2d'), dpr, state.view);
  c.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'zoomspot-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.png';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('PNG로 저장했습니다');
  }, 'image/png');
}
$('#btnSave').addEventListener('click', savePNG);

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => toast('전체화면을 사용할 수 없습니다'));
}
$('#btnFull').addEventListener('click', toggleFull);
$('#btnHelp').addEventListener('click', () => toggleHelp());
$('#btnHelpClose').addEventListener('click', () => toggleHelp(false));
function toggleHelp(force) {
  const h = $('#help'); h.hidden = typeof force === 'boolean' ? !force : !h.hidden;
}

/* ───────── 소스 ───────── */
function setSource(s) {
  stopStream(false);
  state.source = s;
  state.anns = []; state.redo = []; state.draft = null;
  Object.assign(state.view, { z: 1, px: 0, py: 0 }); Object.assign(state.target, { z: 1, px: 0, py: 0 });
  updateButtons();
  $('#start').hidden = true;
}
function stopStream(showStart) {
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  if (showStart) { state.source = null; $('#start').hidden = false; }
}
function showStartError(msg) { $('#startError').textContent = msg || ''; }

async function startShare() {
  showStartError('');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    showStartError('이 브라우저는 화면 공유를 지원하지 않습니다. Chrome/Edge를 사용하세요.'); return;
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    const v = document.createElement('video');
    v.srcObject = stream; v.muted = true; v.playsInline = true;
    await v.play();
    setSource(v);
    state.stream = stream;
    stream.getVideoTracks()[0].addEventListener('ended', () => { toast('화면 공유가 종료되었습니다'); stopStream(true); });
    toast('화면 공유 시작 — 휠로 확대해 보세요');
  } catch (err) {
    showStartError(err && err.name === 'NotAllowedError' ? '화면 공유가 취소되었거나 권한이 거부되었습니다.' : '화면 공유를 시작할 수 없습니다: ' + (err && err.message));
  }
}
function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) { showStartError('이미지 파일을 선택하세요.'); return; }
  const img = new Image();
  img.onload = () => setSource(img);
  img.onerror = () => showStartError('이미지를 불러오지 못했습니다.');
  img.src = URL.createObjectURL(file);
}

// 샘플 화면: 간단한 대시보드 모양을 캔버스로 그림
function makeSample() {
  const c = document.createElement('canvas'); c.width = 1600; c.height = 900;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f6fa'; g.fillRect(0, 0, 1600, 900);
  g.fillStyle = '#1f2a44'; g.fillRect(0, 0, 1600, 80);
  g.fillStyle = '#fff'; g.font = 'bold 32px sans-serif'; g.fillText('월간 매출 대시보드 (샘플)', 40, 52);
  const cards = [['총 매출', '₩ 128,400,000', '#4c8dff'], ['신규 고객', '1,284 명', '#34c759'], ['환불률', '2.4 %', '#ff9500'], ['만족도', '4.7 / 5', '#af52de']];
  cards.forEach(([t, v, col], i) => {
    const x = 40 + i * 390;
    g.fillStyle = '#fff'; g.fillRect(x, 120, 360, 150);
    g.fillStyle = col; g.fillRect(x, 120, 8, 150);
    g.fillStyle = '#6b7385'; g.font = '22px sans-serif'; g.fillText(t, x + 28, 170);
    g.fillStyle = '#1f2a44'; g.font = 'bold 40px sans-serif'; g.fillText(v, x + 28, 230);
  });
  g.fillStyle = '#fff'; g.fillRect(40, 310, 920, 550);
  g.fillStyle = '#1f2a44'; g.font = 'bold 24px sans-serif'; g.fillText('월별 추이', 70, 360);
  const vals = [40, 55, 48, 70, 62, 90, 84, 110, 98, 130, 120, 150];
  vals.forEach((v, i) => {
    g.fillStyle = i === 11 ? '#ff3b30' : '#4c8dff';
    g.fillRect(80 + i * 72, 820 - v * 3.2, 44, v * 3.2);
    g.fillStyle = '#6b7385'; g.font = '16px sans-serif'; g.fillText(`${i + 1}월`, 84 + i * 72, 846);
  });
  g.fillStyle = '#fff'; g.fillRect(1000, 310, 560, 550);
  g.fillStyle = '#1f2a44'; g.font = 'bold 24px sans-serif'; g.fillText('최근 주문', 1030, 360);
  g.font = '20px sans-serif';
  for (let i = 0; i < 9; i++) {
    g.fillStyle = i % 2 ? '#f4f6fa' : '#fff'; g.fillRect(1020, 385 + i * 52, 520, 52);
    g.fillStyle = '#3a4258'; g.fillText(`#10${24 + i}  주문 상품 ${i + 1}`, 1036, 419 + i * 52);
    g.fillStyle = '#4c8dff'; g.fillText(`₩ ${(i + 3) * 12400}`, 1420, 419 + i * 52);
  }
  return c;
}

$('#btnShare').addEventListener('click', startShare);
$('#btnImage').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', (e) => { loadImageFile(e.target.files[0]); e.target.value = ''; });
$('#btnSample').addEventListener('click', () => setSource(makeSample()));
$('#btnSource').addEventListener('click', () => { stopStream(true); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) loadImageFile(e.dataTransfer.files[0]); });

/* ───────── 키보드 ───────── */
const COLOR_KEYS = { r: '#ff3b30', o: '#ff9500', y: '#ffe600', g: '#34c759', b: '#0a84ff', w: '#ffffff' };
window.addEventListener('keydown', (e) => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  activity();
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    else if (k === 's') { e.preventDefault(); savePNG(); }
    return;
  }
  if (e.key === ' ') { spaceDown = true; if (e.target === document.body) e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (!$('#help').hidden) toggleHelp(false);
    else if (!panel.hidden) closePanel();
    else if (state.target.z > 1.001) resetZoom();
    return;
  }
  if (e.key === '?') { toggleHelp(); return; }
  if (!state.source) return;
  if ('12345'.includes(e.key) && e.key) { setTool(['pan', 'arrow', 'rect', 'pen', 'marker'][+e.key - 1]); return; }
  if (COLOR_KEYS[k]) { setColor(COLOR_KEYS[k]); toast('색상 변경'); return; }
  if (k === 's') toggleSpot();
  else if (k === 'e' || e.key === 'Delete') clearAll();
  else if (k === 'f') toggleFull();
  else if (k === 'h') { state.pinToolbar = !state.pinToolbar; toast(state.pinToolbar ? '툴바 고정' : '툴바 자동숨김'); }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
window.addEventListener('blur', () => { spaceDown = false; });

/* ───────── 툴바 자동 숨김 ───────── */
const toolbar = $('#toolbar');
let hideTimer, overToolbar = false;
function activity() {
  toolbar.classList.remove('hidden');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!state.pinToolbar && !overToolbar && panel.hidden && state.source) toolbar.classList.add('hidden');
  }, 3000);
}
toolbar.addEventListener('pointerenter', () => { overToolbar = true; activity(); });
toolbar.addEventListener('pointerleave', () => { overToolbar = false; activity(); });
panel.addEventListener('pointerenter', () => { overToolbar = true; });
panel.addEventListener('pointerleave', () => { overToolbar = false; activity(); });
window.addEventListener('pointermove', (e) => {
  // 입력이 있을 때마다 타이머를 갱신하되, 하단 근처로 가면 항상 표시
  activity();
  if (e.clientY > innerHeight - 90) toolbar.classList.remove('hidden');
});

/* ───────── 시작 ───────── */
loadSettings();
resize();
setTool(state.tool);
setColor(state.color);
setWidth(state.width);
$('#fill').checked = state.fill;
syncSpotUI();
updateButtons();
activity();
requestAnimationFrame(frame);

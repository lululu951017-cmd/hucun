/* ══════════════════════════════════════════
   STATE
══════════════════════════════════════════ */
let storyboardFile = null;
let characterFiles = [];
let backgroundFiles = [];

/* ══════════════════════════════════════════
   STYLE PRESETS
══════════════════════════════════════════ */
const STYLE_PRESETS = {
  mature:    'mature narrative animation, cinematic anime aesthetic, realistic detailed illustration, 2.5D cinematic quality, dramatic lighting, film grain, professional color grading, story-driven visual narrative',
  realistic: 'ultra-realistic anime, photorealistic rendering, highly detailed skin texture, subsurface scattering, ray-traced lighting, hyperdetailed fabric',
  cinematic: 'cinematic lighting, anamorphic lens flare, depth of field bokeh, volumetric fog, golden hour rim lighting, cinematic color grading, dramatic shadows',
  cel:       'cel-shaded anime, clean lineart, flat color fills, sharp shadow edges, traditional anime coloring, retro 90s anime style',
  painterly: 'painterly illustration, visible brushstrokes, oil painting texture, impressionistic color blending, artistic rendering, Makoto Shinkai style',
  dark:      'dark moody atmosphere, desaturated palette, heavy shadows, noir lighting, low-key lighting, melancholic tone, cold color temperature'
};

const activePresets = new Set(['mature']);

const styleInput = document.getElementById('styleInput');

// Initialize style input with default
styleInput.value = STYLE_PRESETS.mature;

// Preset chip logic
document.getElementById('stylePresets').addEventListener('click', e => {
  const chip = e.target.closest('.preset-chip');
  if (!chip) return;
  const key = chip.dataset.key;

  if (activePresets.has(key)) {
    if (activePresets.size === 1) return; // keep at least one
    activePresets.delete(key);
    chip.classList.remove('preset-active');
  } else {
    activePresets.add(key);
    chip.classList.add('preset-active');
  }

  styleInput.value = [...activePresets].map(k => STYLE_PRESETS[k]).join(', ');
});

/* ══════════════════════════════════════════
   STORYBOARD UPLOAD
══════════════════════════════════════════ */
const storyboardInput = document.getElementById('storyboardInput');
const storyboardZone  = document.getElementById('storyboardZone');
const storyboardPrev  = document.getElementById('storyboardPreview');

storyboardInput.addEventListener('change', e => {
  if (e.target.files[0]) setStoryboard(e.target.files[0]);
});
setupDropZone(storyboardZone, f => setStoryboard(f));

function setStoryboard(file) {
  storyboardFile = file;
  const url = URL.createObjectURL(file);
  storyboardPrev.innerHTML = `
    <img src="${url}" alt="分镜图预览">
    <div class="img-label">${file.name} · ${fmtSize(file.size)}</div>`;
  storyboardZone.classList.add('has-image');
  checkReady();
}

/* ══════════════════════════════════════════
   CHARACTER REFS UPLOAD
══════════════════════════════════════════ */
const characterInput = document.getElementById('characterInput');
const characterZone  = document.getElementById('characterZone');
const charThumbs     = document.getElementById('charThumbs');

characterInput.addEventListener('change', e => addFiles(e.target.files, characterFiles, 6, charThumbs, 'char'));
setupDropZone(characterZone, f => addFiles([f], characterFiles, 6, charThumbs, 'char'), true);

/* ══════════════════════════════════════════
   BACKGROUND REFS UPLOAD
══════════════════════════════════════════ */
const backgroundInput = document.getElementById('backgroundInput');
const backgroundZone  = document.getElementById('backgroundZone');
const bgThumbs        = document.getElementById('bgThumbs');

backgroundInput.addEventListener('change', e => addFiles(e.target.files, backgroundFiles, 3, bgThumbs, 'bg'));
setupDropZone(backgroundZone, f => addFiles([f], backgroundFiles, 3, bgThumbs, 'bg'), true);

/* Generic multi-file handler */
function addFiles(rawFiles, arr, max, thumbContainer, type) {
  const files = Array.from(rawFiles).filter(f => f.type.startsWith('image/'));
  const slots = max - arr.length;
  if (slots <= 0) return;
  arr.push(...files.slice(0, slots));
  renderThumbs(arr, thumbContainer, type);
}

function renderThumbs(arr, container, type) {
  container.innerHTML = '';
  arr.forEach((file, i) => {
    const url = URL.createObjectURL(file);
    const div = document.createElement('div');
    div.className = 'thumb-item' + (type === 'bg' ? ' thumb-bg' : '');
    div.innerHTML = `
      <img src="${url}" alt="${type} ${i+1}">
      <button class="thumb-remove" data-idx="${i}">×</button>`;
    container.appendChild(div);
  });
  container.querySelectorAll('.thumb-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      arr.splice(parseInt(btn.dataset.idx), 1);
      renderThumbs(arr, container, type);
    });
  });
}

/* ══════════════════════════════════════════
   ANALYZE
══════════════════════════════════════════ */
const analyzeBtn     = document.getElementById('analyzeBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingStepEls = document.querySelectorAll('.loading-step');

analyzeBtn.addEventListener('click', async () => {
  if (!storyboardFile) return;
  showLoading();

  try {
    const fd = new FormData();
    fd.append('storyboard', storyboardFile);
    characterFiles.forEach(f => fd.append('characters', f));
    backgroundFiles.forEach(f => fd.append('backgrounds', f));

    const ctx = document.getElementById('contextInput').value.trim();
    if (ctx) fd.append('context', ctx);

    const style = styleInput.value.trim();
    if (style) fd.append('stylePrompt', style);

    const res  = await fetch('/api/analyze', { method: 'POST', body: fd });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '分析失败');
    renderResults(json.data);
  } catch (err) {
    alert('分析失败：' + err.message);
  } finally {
    hideLoading();
  }
});

function checkReady() {
  analyzeBtn.disabled = !storyboardFile;
}

/* ══════════════════════════════════════════
   RENDER RESULTS
══════════════════════════════════════════ */
function renderResults(data) {
  hide('analysisEmpty'); hide('promptsEmpty');
  show('analysisContent', 'flex'); show('promptsContent', 'flex');
  show('copyAllBtn');

  const comp    = data.composition          || {};
  const scene   = data.scene               || {};
  const bgRef   = data.background_reference || {};
  const prompts = data.prompts             || {};

  // Meta
  const metaParts = [];
  if (characterFiles.length > 0) metaParts.push(`角色参考×${characterFiles.length}`);
  if (backgroundFiles.length > 0) metaParts.push(`背景参考×${backgroundFiles.length}`);
  setText('analysisMeta', metaParts.join(' · '));

  // Composition
  setText('infoShotType',    joinCnEn(comp.shot_type, comp.shot_type_en));
  setText('infoCameraAngle', joinCnEn(comp.camera_angle, comp.camera_angle_en));
  setText('infoDepth',       comp.depth_of_field);
  setText('infoLayout',      comp.layout_description);

  // Characters
  const charContainer = document.getElementById('charactersContainer');
  charContainer.innerHTML = '';
  const chars = Array.isArray(data.characters) ? data.characters : [];
  if (chars.length === 0) {
    charContainer.innerHTML = '<div style="color:var(--text2);font-size:12px;font-style:italic;">未检测到明确角色</div>';
  } else {
    chars.forEach((c, i) => {
      const card = document.createElement('div');
      card.className = 'char-card';
      card.innerHTML = `
        <div class="char-card-header">
          ${esc(c.label || `角色 ${i+1}`)}
          <span class="char-position-tag">${esc(c.position_in_frame || '')}</span>
        </div>
        <div class="char-rows">
          ${infoRow('姿态', c.pose)}
          ${infoRow('神态', c.expression)}
          ${infoRow('情绪', c.emotion)}
          ${infoRow('动作', c.action)}
          ${c.color_scheme ? `<div class="char-row">
            <span class="char-row-label">上色</span>
            <span class="char-row-val"><span class="color-tag">配色</span>${esc(c.color_scheme)}</span>
          </div>` : ''}
        </div>`;
      charContainer.appendChild(card);
    });
  }

  // Scene
  setText('infoEnv',   scene.environment);
  setText('infoTime',  scene.time_of_day);
  setText('infoLight', scene.lighting);
  setText('infoAtmos', [scene.atmosphere, scene.background_key_elements].filter(Boolean).join('\n'));

  // Background reference
  if (bgRef.has_reference) {
    hide('bgRefNone'); show('bgRefData');
    setText('bgColorPalette',   bgRef.color_palette);
    setText('bgEnvMatch',       bgRef.environment_match);
    setText('bgStyleExtracted', bgRef.style_extracted);
    setText('bgKeyElements',    bgRef.key_visual_elements);
    show('bgRefTag');
  } else {
    show('bgRefNone'); hide('bgRefData');
    hide('bgRefTag');
  }

  // Scene summary
  setText('sceneSummary', prompts.scene_summary_cn);

  // Prompts
  setText('promptFull',        prompts.nano_banana_format || prompts.full_prompt);
  setText('promptCharacter',   prompts.character_prompt);
  setText('promptComposition', prompts.composition_prompt);
  setText('promptBackground',  prompts.background_prompt);
  setText('promptStyle',       prompts.style_prompt);
  setText('promptNegative',    prompts.negative_prompt);

  document.getElementById('panelAnalysis').scrollTop = 0;
  document.getElementById('panelPrompts').scrollTop  = 0;
}

/* ══════════════════════════════════════════
   COPY BUTTONS
══════════════════════════════════════════ */
document.addEventListener('click', e => {
  const btn = e.target.closest('.copy-btn[data-target]');
  if (!btn) return;
  const el = document.getElementById(btn.dataset.target);
  if (el) copyText(el.textContent, btn);
});

document.getElementById('copyAllBtn').addEventListener('click', () => {
  const btn = document.getElementById('copyAllBtn');
  const sections = ['promptFull', 'promptCharacter', 'promptComposition', 'promptBackground', 'promptStyle'];
  const neg = document.getElementById('promptNegative').textContent;
  const parts = sections
    .map(id => document.getElementById(id)?.textContent || '')
    .filter(t => t && t !== '—');
  const negPart = neg && neg !== '—' ? `\n\n[Negative Prompt]\n${neg}` : '';
  navigator.clipboard.writeText(parts.join('\n\n') + negPart).then(() => {
    const orig = btn.textContent;
    btn.textContent = '已复制！';
    setTimeout(() => btn.textContent = orig, 2000);
  });
});

function copyText(text, btn) {
  if (!text || text === '—') return;
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '已复制';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
  });
}

/* ══════════════════════════════════════════
   LOADING
══════════════════════════════════════════ */
let loadingTimer = null;
let stepIdx = 0;

function showLoading() {
  stepIdx = 0;
  loadingStepEls.forEach(s => s.classList.remove('active', 'done'));
  loadingStepEls[0]?.classList.add('active');
  loadingOverlay.style.display = 'flex';
  analyzeBtn.disabled = true;
  loadingTimer = setInterval(() => {
    if (stepIdx < loadingStepEls.length - 1) {
      loadingStepEls[stepIdx].classList.remove('active');
      loadingStepEls[stepIdx].classList.add('done');
      stepIdx++;
      loadingStepEls[stepIdx].classList.add('active');
    }
  }, 1200);
}

function hideLoading() {
  clearInterval(loadingTimer);
  loadingOverlay.style.display = 'none';
  analyzeBtn.disabled = !storyboardFile;
}

/* ══════════════════════════════════════════
   DROP ZONE HELPER
══════════════════════════════════════════ */
function setupDropZone(zone, onFile, multi = false) {
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    if (multi) files.forEach(f => onFile(f));
    else onFile(files[0]);
  });
}

/* ══════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════ */
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val || '—';
}
function show(id, display = 'block') {
  const el = document.getElementById(id);
  if (el) el.style.display = display;
}
function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
function joinCnEn(cn, en) {
  if (cn && en) return `${cn}\n${en}`;
  return cn || en || '—';
}
function infoRow(label, val) {
  if (!val) return '';
  return `<div class="char-row">
    <span class="char-row-label">${label}</span>
    <span class="char-row-val">${esc(val)}</span>
  </div>`;
}
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtSize(bytes) {
  return bytes < 1048576 ? (bytes / 1024).toFixed(0) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';
}

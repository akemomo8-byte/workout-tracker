// AegisLift - AI-Driven Workout Tracker Logic
(function () {
  'use strict';

  // =====================================================
  // Constants & Storage
  // =====================================================
  const STORAGE_KEY = 'aegislift_workout_logs_v1';
  const BW_KEY = 'aegislift_bodyweight_v1';
  const SETTINGS_KEY = 'aegislift_settings_v1';

  const PARTS = ['胸', '背中', '脚', '肩', '腕', 'その他'];
  const DEFAULT_EXERCISES = [
    { name: 'ベンチプレス', part: '胸' },
    { name: 'インクラインダンベルプレス', part: '胸' },
    { name: 'ダンベルフライ', part: '胸' },
    { name: 'デッドリフト', part: '背中' },
    { name: '懸垂 (チンニング)', part: '背中' },
    { name: 'ラットプルダウン', part: '背中' },
    { name: 'スクワット', part: '脚' },
    { name: 'レッグプレス', part: '脚' },
    { name: 'ショルダープレス', part: '肩' },
    { name: 'サイドレイズ', part: '肩' },
    { name: 'アームカール', part: '腕' }
  ];

  const CIRCLE_CIRCUMFERENCE = 282.74; // 2 * PI * 45
  const BACKUP_INTERVAL_DAYS = 7;
  const DAY_MS = 86400000;

  function makeDefaultSettings() {
    return {
      theme: 'dark',          // 'auto' | 'dark' | 'light'
      timerSeconds: 90,
      autoTimer: true,
      wakeLock: true,
      notify: false,
      backupReminder: true,
      lastExport: 0,
      customExercises: [],    // [{name, part}]
      hiddenExercises: [],    // 非表示にした標準種目名
      order: [],              // 種目の並び順
      routines: []            // [{id, name, exercises:[]}]
    };
  }

  // =====================================================
  // Generic helpers
  // =====================================================
  function $(id) { return document.getElementById(id); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function keyFromDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayKey() { return keyFromDate(new Date()); }
  function dateFromKey(k) {
    const p = k.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2], 12, 0, 0);
  }
  function addDays(d, n) { const r = new Date(d.getTime()); r.setDate(r.getDate() + n); return r; }
  function startOfWeek(d) {
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
    r.setDate(r.getDate() - ((r.getDay() + 6) % 7)); // 月曜始まり
    return r;
  }
  function round1(n) { return Math.round(n * 10) / 10; }
  function fmt(n) { return String(round1(n)); }
  function uid(prefix) { return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
  function e1rm(weight, reps) { return round1(reps <= 1 ? weight : weight * (1 + reps / 30)); }
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.error('Failed to save to localStorage', e); }
  }

  // =====================================================
  // Data normalisation
  // =====================================================
  function normalizeLog(l) {
    if (!l || typeof l !== 'object') return null;
    if (typeof l.exercise !== 'string' || !l.exercise) return null;
    if (typeof l.dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(l.dateKey)) return null;
    const weight = Number(l.weight);
    const reps = Number(l.reps);
    if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight < 0 || reps <= 0) return null;
    let rpe = null;
    if (l.rpe !== null && l.rpe !== undefined && l.rpe !== '' && Number.isFinite(Number(l.rpe))) rpe = Number(l.rpe);
    return {
      id: (typeof l.id === 'string' && l.id) ? l.id : uid('set'),
      dateKey: l.dateKey,
      timeStr: typeof l.timeStr === 'string' ? l.timeStr : '',
      exercise: l.exercise.slice(0, 60),
      weight: weight,
      reps: reps,
      volume: Math.round(weight * reps),
      rpe: rpe,
      memo: typeof l.memo === 'string' ? l.memo.slice(0, 80) : '',
      pr: !!l.pr
    };
  }

  function normalizeBw(b) {
    if (!b || typeof b !== 'object') return null;
    if (typeof b.dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.dateKey)) return null;
    const kg = Number(b.kg);
    if (!Number.isFinite(kg) || kg <= 0) return null;
    return { id: (typeof b.id === 'string' && b.id) ? b.id : uid('bw'), dateKey: b.dateKey, kg: kg };
  }

  function loadLogs() {
    const data = loadJSON(STORAGE_KEY, []);
    if (!Array.isArray(data)) return [];
    return data.map(normalizeLog).filter(Boolean);
  }
  function loadBodyweights() {
    const data = loadJSON(BW_KEY, []);
    if (!Array.isArray(data)) return [];
    return data.map(normalizeBw).filter(Boolean).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }
  function loadSettings() {
    const s = Object.assign(makeDefaultSettings(), loadJSON(SETTINGS_KEY, {}) || {});
    ['customExercises', 'hiddenExercises', 'order', 'routines'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
    s.customExercises = s.customExercises.filter(c => c && typeof c.name === 'string' && PARTS.includes(c.part));
    s.routines = s.routines.filter(r => r && typeof r.id === 'string' && typeof r.name === 'string' && Array.isArray(r.exercises));
    if (!['auto', 'dark', 'light'].includes(s.theme)) s.theme = 'dark';
    if (!Number.isFinite(Number(s.timerSeconds)) || s.timerSeconds < 10) s.timerSeconds = 90;
    return s;
  }

  // =====================================================
  // State
  // =====================================================
  let logs = loadLogs();
  let bodyweights = loadBodyweights();
  let settings = loadSettings();

  function saveLogs() { saveJSON(STORAGE_KEY, logs); }
  function saveBodyweights() { saveJSON(BW_KEY, bodyweights); }
  function saveSettings() { saveJSON(SETTINGS_KEY, settings); }

  // Timer state
  let timerInterval = null;
  let timerDuration = settings.timerSeconds;
  let timerRemaining = settings.timerSeconds;
  let timerEndAt = 0;
  let isTimerRunning = false;
  let wakeLock = null;
  let audioCtx = null;

  // UI state
  let chartMetric = 'weight';
  let chartPeriod = 'all';
  let reportMode = 'week';
  let calYear = new Date().getFullYear();
  let calMonth = new Date().getMonth();
  let selectedDay = todayKey();
  let activeRoutineId = null;
  let editingId = null;
  let deferredInstallPrompt = null;
  let toastTimer = null;

  // =====================================================
  // DOM
  // =====================================================
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  const exerciseSelect = $('exerciseSelect');
  const customExerciseWrapper = $('customExerciseWrapper');
  const customExerciseInput = $('customExerciseInput');
  const customPartSelect = $('customPartSelect');
  const previousBestText = $('previousBestText');
  const weightInput = $('weightInput');
  const repsInput = $('repsInput');
  const rpeSelect = $('rpeSelect');
  const memoInput = $('memoInput');
  const e1rmPreview = $('e1rmPreview');
  const autoStartTimerToggle = $('autoStartTimerToggle');
  const autoTimerLabel = $('autoTimerLabel');
  const btnSaveSet = $('btnSaveSet');
  const btnRepeatLast = $('btnRepeatLast');

  const todayVolumeElem = $('todayVolume');
  const todaySetsElem = $('todaySets');
  const todaySetsList = $('todaySetsList');
  const btnClearTodayBtn = $('btnClearTodayBtn');

  const timerDigits = $('timerDigits');
  const timerStatus = $('timerStatus');
  const timerProgressCircle = $('timerProgressCircle');
  const presetButtons = document.querySelectorAll('.preset-btn');
  const btnTimerStart = $('btnTimerStart');
  const btnTimerReset = $('btnTimerReset');
  const wakeLockToggle = $('wakeLockToggle');
  const notifyToggle = $('notifyToggle');

  const floatingTimerPill = $('floatingTimerPill');
  const floatingTimerSec = $('floatingTimerSec');
  const floatingStopBtn = $('floatingStopBtn');

  const maxRecordsContainer = $('maxRecordsContainer');
  const allHistoryList = $('allHistoryList');
  const btnClearAllHistoryBtn = $('btnClearAllHistoryBtn');
  const chartExerciseSelect = $('chartExerciseSelect');
  const progressChart = $('progressChart');

  const btnExportData = $('btnExportData');
  const btnImportData = $('btnImportData');
  const importFileInput = $('importFileInput');

  const toastEl = $('toast');

  // =====================================================
  // Exercise list management
  // =====================================================
  function allExercises() {
    const hidden = settings.hiddenExercises;
    const base = DEFAULT_EXERCISES.filter(e => !hidden.includes(e.name))
      .concat(settings.customExercises.filter(c => !DEFAULT_EXERCISES.some(d => d.name === c.name)));
    const idx = n => { const i = settings.order.indexOf(n); return i < 0 ? 1e6 : i; };
    return base.map((e, i) => ({ name: e.name, part: e.part, _i: i }))
      .sort((a, b) => (idx(a.name) - idx(b.name)) || (a._i - b._i));
  }

  function partOf(name) {
    const e = DEFAULT_EXERCISES.find(x => x.name === name) || settings.customExercises.find(x => x.name === name);
    return e ? e.part : 'その他';
  }

  function renderExerciseSelect(preferName) {
    const prev = preferName || exerciseSelect.value;
    const list = allExercises();
    let html = '';
    PARTS.forEach(part => {
      const items = list.filter(e => e.part === part);
      if (!items.length) return;
      html += '<optgroup label="' + escapeHtml(part) + '">' +
        items.map(e => '<option value="' + escapeHtml(e.name) + '">' + escapeHtml(e.name) + '</option>').join('') +
        '</optgroup>';
    });
    html += '<optgroup label="カスタム"><option value="__custom__">＋ 新規種目を追加...</option></optgroup>';
    exerciseSelect.innerHTML = html;
    const has = prev && Array.prototype.some.call(exerciseSelect.options, o => o.value === prev);
    if (has) exerciseSelect.value = prev;
    else exerciseSelect.selectedIndex = 0;
    customExerciseWrapper.classList.toggle('hidden', exerciseSelect.value !== '__custom__');
  }

  function renderCustomPartSelect() {
    customPartSelect.innerHTML = PARTS.map(p => '<option value="' + p + '">' + p + '</option>').join('');
    customPartSelect.value = 'その他';
  }

  function ensureExerciseRegistered(name) {
    if (allExercises().some(e => e.name === name)) return false;
    const builtin = DEFAULT_EXERCISES.find(e => e.name === name);
    if (builtin) {
      settings.hiddenExercises = settings.hiddenExercises.filter(n => n !== name);
    } else {
      settings.customExercises.push({ name: name, part: customPartSelect.value || 'その他' });
    }
    saveSettings();
    return true;
  }

  function moveExercise(name, dir) {
    const list = allExercises();
    const i = list.findIndex(e => e.name === name);
    if (i < 0) return;
    let j = i + dir;
    while (j >= 0 && j < list.length && list[j].part !== list[i].part) j += dir;
    if (j < 0 || j >= list.length) return;
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    settings.order = list.map(e => e.name);
    saveSettings();
    renderExerciseSelect();
    renderExerciseManage();
    renderRoutinePicker();
  }

  function removeExercise(name) {
    if (!confirm('「' + name + '」を種目リストから削除しますか？\n(過去の記録は残ります)')) return;
    if (DEFAULT_EXERCISES.some(e => e.name === name)) {
      if (!settings.hiddenExercises.includes(name)) settings.hiddenExercises.push(name);
    } else {
      settings.customExercises = settings.customExercises.filter(c => c.name !== name);
    }
    settings.order = settings.order.filter(n => n !== name);
    saveSettings();
    renderExerciseSelect();
    renderExerciseManage();
    renderRoutinePicker();
    renderRoutineBar();
    updateExerciseReference(true);
  }

  function getCurrentExerciseName() {
    if (exerciseSelect.value === '__custom__') return customExerciseInput.value.trim();
    return exerciseSelect.value;
  }

  function selectExercise(name) {
    if (!Array.prototype.some.call(exerciseSelect.options, o => o.value === name)) {
      showToast('「' + name + '」は種目リストにありません');
      return;
    }
    exerciseSelect.value = name;
    customExerciseWrapper.classList.add('hidden');
    updateExerciseReference(true);
  }

  // =====================================================
  // Toast
  // =====================================================
  function showToast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3200);
  }

  // =====================================================
  // Theme
  // =====================================================
  const darkMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function effectiveTheme() {
    if (settings.theme === 'auto') return (darkMedia && !darkMedia.matches) ? 'light' : 'dark';
    return settings.theme;
  }
  function applyTheme() {
    const t = effectiveTheme();
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f1f5f9' : '#0a0e17');
    const btn = $('themeToggleBtn');
    if (btn) btn.textContent = t === 'light' ? '☀️' : '🌙';
    document.querySelectorAll('#themeSeg .seg-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-theme-opt') === settings.theme);
    });
  }
  function setTheme(t) { settings.theme = t; saveSettings(); applyTheme(); }

  // =====================================================
  // Reference & preview
  // =====================================================
  function updateExerciseReference(autoFill) {
    const exercise = getCurrentExerciseName();
    const exerciseLogs = logs.filter(l => l.exercise === exercise);

    if (exerciseLogs.length === 0) {
      previousBestText.textContent = '前回記録: なし (最初のセットを記録しよう)';
      updateE1rmPreview();
      return;
    }
    const lastLog = exerciseLogs[exerciseLogs.length - 1];
    const maxWeight = Math.max.apply(null, exerciseLogs.map(l => l.weight));
    previousBestText.innerHTML = '前回: <strong>' + lastLog.weight + 'kg × ' + lastLog.reps +
      '回</strong> (MAX: ' + maxWeight + 'kg)';

    if (autoFill) {
      weightInput.value = lastLog.weight;
      repsInput.value = lastLog.reps;
    }
    updateE1rmPreview();
  }

  function updateE1rmPreview() {
    const w = parseFloat(weightInput.value);
    const r = parseInt(repsInput.value, 10);
    if (isNaN(w) || isNaN(r) || w <= 0 || r <= 0) { e1rmPreview.textContent = '推定1RM: -'; return; }
    e1rmPreview.textContent = '推定1RM: ' + e1rm(w, r).toFixed(1) + 'kg';
  }

  function changeNumberInput(input, delta, min) {
    const cur = parseFloat(input.value) || 0;
    input.value = Math.max(min, Math.round((cur + delta) * 10) / 10);
    updateE1rmPreview();
  }

  function bindStepper(btn, action) {
    let delayT = null, repeatT = null;
    const stop = () => { clearTimeout(delayT); clearInterval(repeatT); delayT = repeatT = null; };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      action();
      delayT = setTimeout(() => { repeatT = setInterval(action, 110); }, 450);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
    btn.addEventListener('click', (e) => { if (e.detail === 0) action(); }); // キーボード操作用
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // =====================================================
  // Save / Repeat / Edit sets
  // =====================================================
  function addLog(exercise, weight, reps, rpe, memo) {
    const prior = logs.filter(l => l.exercise === exercise);
    const prevMaxW = prior.length ? Math.max.apply(null, prior.map(l => l.weight)) : null;
    const prevMaxE = prior.length ? Math.max.apply(null, prior.map(l => e1rm(l.weight, l.reps))) : null;
    const newE = e1rm(weight, reps);

    let prType = null;
    if (prior.length > 0) {
      if (weight > prevMaxW) prType = 'weight';
      else if (newE > prevMaxE) prType = 'e1rm';
    }

    const now = new Date();
    const entry = {
      id: uid('set'),
      dateKey: todayKey(),
      timeStr: now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
      exercise: exercise,
      weight: weight,
      reps: reps,
      volume: Math.round(weight * reps),
      rpe: rpe,
      memo: memo,
      pr: !!prType
    };
    logs.push(entry);
    saveLogs();
    return { entry: entry, prType: prType, e1rm: newE };
  }

  function afterSetSaved(result) {
    btnSaveSet.innerHTML = '<span>✅ 記録完了！</span>';
    setTimeout(() => { btnSaveSet.innerHTML = '<span>⚡ セットを完了して記録</span>'; }, 1200);

    if (result.prType) {
      const e = result.entry;
      const msg = result.prType === 'weight'
        ? '🎉 自己ベスト更新！ ' + e.exercise + ' ' + e.weight + 'kg'
        : '🎉 推定1RM更新！ ' + e.exercise + ' ' + result.e1rm + 'kg';
      showToast(msg, 'pr');
      if ('vibrate' in navigator) navigator.vibrate([100, 60, 100, 60, 250]);
    }

    renderTodayStats();
    updateExerciseReference(false);
    renderRoutineBar();
    updateBackupBanner();

    if (settings.autoTimer) {
      resetTimer();
      startTimer();
      updateFloatingPillVisibility();
    }
  }

  function handleSaveSet() {
    const exercise = getCurrentExerciseName();
    const weight = parseFloat(weightInput.value);
    const reps = parseInt(repsInput.value, 10);
    const rpe = rpeSelect.value ? parseFloat(rpeSelect.value) : null;
    const memo = memoInput.value.trim();

    if (!exercise) { alert('種目名を入力してください'); return; }
    if (isNaN(weight) || weight < 0 || isNaN(reps) || reps <= 0) {
      alert('重量と回数を正しく入力してください');
      return;
    }

    const wasCustom = exerciseSelect.value === '__custom__';
    const registered = ensureExerciseRegistered(exercise);
    if (registered || wasCustom) {
      renderExerciseSelect(exercise);
      customExerciseWrapper.classList.add('hidden');
      customExerciseInput.value = '';
      renderExerciseManage();
      renderRoutinePicker();
    }

    const result = addLog(exercise, weight, reps, rpe, memo);
    rpeSelect.value = '';
    memoInput.value = '';
    afterSetSaved(result);
  }

  function handleRepeatLast() {
    const exercise = getCurrentExerciseName();
    const exerciseLogs = logs.filter(l => l.exercise === exercise);
    if (!exercise || exerciseLogs.length === 0) {
      showToast('この種目の前回記録がありません');
      return;
    }
    const last = exerciseLogs[exerciseLogs.length - 1];
    weightInput.value = last.weight;
    repsInput.value = last.reps;
    const result = addLog(exercise, last.weight, last.reps, last.rpe, '');
    afterSetSaved(result);
    showToast('🔁 前回と同じ ' + last.weight + 'kg × ' + last.reps + '回 を記録しました');
  }

  function openEditModal(id) {
    const log = logs.find(l => l.id === id);
    if (!log) return;
    editingId = id;
    $('editExerciseName').textContent = log.exercise + '  (' + log.dateKey + ')';
    $('editWeight').value = log.weight;
    $('editReps').value = log.reps;
    $('editRpe').value = log.rpe === null ? '' : String(log.rpe);
    $('editMemo').value = log.memo || '';
    $('editModal').classList.remove('hidden');
    $('editWeight').focus();
  }

  function closeEditModal() {
    editingId = null;
    $('editModal').classList.add('hidden');
  }

  function saveEdit() {
    const log = logs.find(l => l.id === editingId);
    if (!log) { closeEditModal(); return; }
    const weight = parseFloat($('editWeight').value);
    const reps = parseInt($('editReps').value, 10);
    if (isNaN(weight) || weight < 0 || isNaN(reps) || reps <= 0) {
      alert('重量と回数を正しく入力してください');
      return;
    }
    log.weight = weight;
    log.reps = reps;
    log.volume = Math.round(weight * reps);
    log.rpe = $('editRpe').value ? parseFloat($('editRpe').value) : null;
    log.memo = $('editMemo').value.trim();
    saveLogs();
    closeEditModal();
    refreshAll();
    showToast('✏️ セットを更新しました');
  }

  function deleteSetById(id) {
    logs = logs.filter(l => l.id !== id);
    saveLogs();
    refreshAll();
  }

  function handleSetListClick(e) {
    const del = e.target.closest('.set-delete-btn');
    if (del) { deleteSetById(del.getAttribute('data-id')); return; }
    const ed = e.target.closest('.set-edit-btn');
    if (ed) openEditModal(ed.getAttribute('data-id'));
  }

  // =====================================================
  // Rendering: record tab
  // =====================================================
  function setRowHtml(log, showVolume) {
    const sub = [];
    if (log.timeStr) sub.push(escapeHtml(log.timeStr));
    if (showVolume) sub.push('ボリューム ' + (log.volume || 0) + 'kg');
    sub.push('1RM ' + e1rm(log.weight, log.reps) + 'kg');
    if (log.rpe) sub.push('RPE ' + log.rpe);
    const memo = log.memo ? '<div class="set-memo">📝 ' + escapeHtml(log.memo) + '</div>' : '';
    const pr = log.pr ? ' <span class="pr-mark" title="自己ベスト更新">🏆</span>' : '';
    return '<div class="set-row">' +
      '<div class="set-main">' +
        '<div class="set-info-primary">' + escapeHtml(log.exercise) + pr + '</div>' +
        '<div class="set-info-sub">' + sub.join(' • ') + '</div>' + memo +
      '</div>' +
      '<div class="set-row-actions">' +
        '<span class="set-badge">' + log.weight + 'kg × ' + log.reps + '回</span>' +
        '<button class="set-edit-btn" data-id="' + escapeHtml(log.id) + '" title="編集" aria-label="編集">✎</button>' +
        '<button class="set-delete-btn" data-id="' + escapeHtml(log.id) + '" title="削除" aria-label="削除">×</button>' +
      '</div>' +
    '</div>';
  }

  function renderTodayStats() {
    const todayLogs = logs.filter(l => l.dateKey === todayKey());
    let totalVolume = 0;
    todayLogs.forEach(l => { totalVolume += (l.volume || 0); });

    todayVolumeElem.innerHTML = totalVolume.toLocaleString() + ' <span class="unit">kg</span>';
    todaySetsElem.innerHTML = todayLogs.length + ' <span class="unit">sets</span>';

    if (todayLogs.length === 0) {
      todaySetsList.innerHTML = '<div class="empty-state">まだ本日の記録はありません</div>';
      return;
    }
    todaySetsList.innerHTML = todayLogs.slice().reverse().map(l => setRowHtml(l, true)).join('');
  }

  function renderRoutineBar() {
    const card = $('routineCard');
    if (!settings.routines.length) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');

    $('routineChips').innerHTML = settings.routines.map(r =>
      '<button type="button" class="chip' + (r.id === activeRoutineId ? ' selected' : '') +
      '" data-routine="' + escapeHtml(r.id) + '">' + escapeHtml(r.name) + '</button>').join('');

    const exWrap = $('routineExerciseChips');
    const routine = settings.routines.find(r => r.id === activeRoutineId);
    if (!routine) {
      exWrap.classList.add('hidden');
      $('routineProgress').textContent = '';
      return;
    }
    const todayNames = new Set(logs.filter(l => l.dateKey === todayKey()).map(l => l.exercise));
    const available = allExercises().map(e => e.name);
    const items = routine.exercises.filter(n => available.includes(n));
    const done = items.filter(n => todayNames.has(n)).length;
    $('routineProgress').textContent = done + '/' + items.length + ' 種目完了';
    exWrap.classList.remove('hidden');
    exWrap.innerHTML = items.length
      ? items.map(n => '<button type="button" class="chip' + (todayNames.has(n) ? ' done' : '') +
        '" data-exercise="' + escapeHtml(n) + '">' + (todayNames.has(n) ? '✓ ' : '') + escapeHtml(n) + '</button>').join('')
      : '<span class="data-note nm">種目がありません。設定から編集してください。</span>';
  }

  function updateBackupBanner() {
    const banner = $('backupBanner');
    if (!settings.backupReminder || logs.length === 0) { banner.classList.add('hidden'); return; }
    let text = '';
    if (!settings.lastExport) {
      if (logs.length < 10) { banner.classList.add('hidden'); return; }
      text = '💾 まだバックアップしていません。記録が消える前に保存しましょう。';
    } else {
      const days = Math.floor((Date.now() - settings.lastExport) / DAY_MS);
      if (days < BACKUP_INTERVAL_DAYS) { banner.classList.add('hidden'); return; }
      text = '💾 最後のバックアップから' + days + '日経過しています。';
    }
    $('backupBannerText').textContent = text;
    banner.classList.remove('hidden');
  }

  // =====================================================
  // Rendering: history tab
  // =====================================================
  function renderHistoryView() {
    renderChartOptions();
    renderProgressChart();

    // 1. Max records
    const maxMap = {};
    const bestE = {};
    logs.forEach(l => {
      if (!maxMap[l.exercise] || l.weight > maxMap[l.exercise].weight) maxMap[l.exercise] = l;
      const e = e1rm(l.weight, l.reps);
      if (!bestE[l.exercise] || e > bestE[l.exercise]) bestE[l.exercise] = e;
    });

    const exercises = Object.keys(maxMap);
    if (exercises.length === 0) {
      maxRecordsContainer.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;">記録がありません</div>';
    } else {
      maxRecordsContainer.innerHTML = exercises.map(ex =>
        '<div class="max-card">' +
          '<div class="max-exercise-name">' + escapeHtml(ex) + '</div>' +
          '<div class="max-exercise-val">' + maxMap[ex].weight +
            '<span style="font-size:12px;color:var(--text-muted);font-weight:400;">kg</span> ' +
            '<span style="font-size:12px;color:var(--text-sub);font-weight:500;">(' + maxMap[ex].reps + '回)</span></div>' +
          '<div class="max-e1rm">推定1RM ' + bestE[ex] + 'kg</div>' +
        '</div>').join('');
    }

    // 2. Full history grouped by date
    if (logs.length === 0) {
      allHistoryList.innerHTML = '<div class="empty-state">履歴はありません</div>';
      return;
    }
    const grouped = {};
    logs.forEach(l => { (grouped[l.dateKey] = grouped[l.dateKey] || []).push(l); });
    const sortedDates = Object.keys(grouped).sort().reverse();
    allHistoryList.innerHTML = sortedDates.map(dateKey => {
      let vol = 0;
      grouped[dateKey].forEach(l => { vol += (l.volume || 0); });
      return '<div class="history-date-group">' +
        '<div class="history-date-header">📅 ' + dateKey + ' (合計 ' + vol.toLocaleString() + 'kg)</div>' +
        '<div class="sets-list">' + grouped[dateKey].map(l => setRowHtml(l, false)).join('') + '</div>' +
      '</div>';
    }).join('');
  }

  function renderChartOptions() {
    const prev = chartExerciseSelect.value;
    const names = [];
    logs.forEach(l => { if (!names.includes(l.exercise)) names.push(l.exercise); });
    if (names.length === 0) {
      chartExerciseSelect.innerHTML = '<option value="">記録なし</option>';
      return;
    }
    chartExerciseSelect.innerHTML = names.map(n =>
      '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>').join('');
    chartExerciseSelect.value = names.includes(prev) ? prev : names[0];
  }

  function renderProgressChart() {
    const exercise = chartExerciseSelect.value;
    if (!exercise) {
      progressChart.innerHTML = '<div class="empty-state">記録がありません</div>';
      return;
    }
    let src = logs.filter(l => l.exercise === exercise);
    if (chartPeriod !== 'all') {
      const cutoff = keyFromDate(addDays(new Date(), -Number(chartPeriod)));
      src = src.filter(l => l.dateKey >= cutoff);
    }
    const byDate = {};
    src.forEach(l => {
      let v;
      if (chartMetric === 'weight') v = l.weight;
      else if (chartMetric === 'e1rm') v = e1rm(l.weight, l.reps);
      else v = l.volume || 0;
      if (chartMetric === 'volume') byDate[l.dateKey] = (byDate[l.dateKey] || 0) + v;
      else if (byDate[l.dateKey] === undefined || v > byDate[l.dateKey]) byDate[l.dateKey] = v;
    });
    const points = Object.keys(byDate).sort().map(k => ({ key: k, value: byDate[k] }));
    drawLineChart(progressChart, points, {
      unit: chartMetric === 'volume' ? 'kg(合計)' : 'kg',
      gradId: 'gradProgress',
      label: exercise,
      emptyMessage: 'グラフは2日以上の記録で表示されます'
    });
  }

  // =====================================================
  // SVG charts
  // =====================================================
  function drawLineChart(container, points, opts) {
    if (points.length < 2) {
      container.innerHTML = '<div class="empty-state">' + escapeHtml(opts.emptyMessage) + '</div>';
      return;
    }
    const W = 320, H = 190, padL = 40, padR = 14, padT = 16, padB = 28;
    const vals = points.map(p => p.value);
    const minV = Math.min.apply(null, vals);
    const maxV = Math.max.apply(null, vals);
    const range = (maxV - minV) || Math.max(1, Math.abs(maxV) * 0.1);
    let lo = minV - range * 0.15;
    if (minV >= 0 && lo < 0) lo = 0;
    const hi = maxV + range * 0.15;

    const t0 = dateFromKey(points[0].key).getTime();
    const t1 = dateFromKey(points[points.length - 1].key).getTime();
    const x = p => padL + ((dateFromKey(p.key).getTime() - t0) / (t1 - t0 || 1)) * (W - padL - padR);
    const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const axisFmt = v => (hi - lo) >= 20 ? String(Math.round(v)) : String(round1(v));

    let grid = '';
    for (let i = 0; i < 4; i++) {
      const v = lo + ((hi - lo) * i) / 3;
      const yy = y(v).toFixed(1);
      grid += '<line class="chart-grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy + '" y2="' + yy + '"/>' +
        '<text class="chart-axis-text" x="' + (padL - 5) + '" y="' + (Number(yy) + 3) + '" text-anchor="end">' + axisFmt(v) + '</text>';
    }

    const coords = points.map(p => x(p).toFixed(1) + ',' + y(p.value).toFixed(1));
    const baseY = H - padB;
    const area = x(points[0]).toFixed(1) + ',' + baseY + ' ' + coords.join(' ') + ' ' +
      x(points[points.length - 1]).toFixed(1) + ',' + baseY;
    const r = points.length > 40 ? 2 : 3.5;
    const dots = points.map(p =>
      '<circle class="chart-dot" cx="' + x(p).toFixed(1) + '" cy="' + y(p.value).toFixed(1) + '" r="' + r + '">' +
      '<title>' + p.key + ': ' + fmt(p.value) + opts.unit + '</title></circle>').join('');

    const short = k => k.slice(5).replace('-', '/');
    const lastP = points[points.length - 1];
    const labels =
      '<text class="chart-axis-text" x="' + padL + '" y="' + (H - 8) + '" text-anchor="start">' + short(points[0].key) + '</text>' +
      '<text class="chart-axis-text" x="' + (W - padR) + '" y="' + (H - 8) + '" text-anchor="end">' + short(lastP.key) + '</text>' +
      '<text class="chart-last-text" x="' + Math.min(x(lastP), W - padR - 4).toFixed(1) + '" y="' + (y(lastP.value) - 8).toFixed(1) +
      '" text-anchor="end">' + fmt(lastP.value) + '</text>';

    container.innerHTML =
      '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + escapeHtml(opts.label) + 'の推移">' +
        '<defs><linearGradient id="' + opts.gradId + '" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0%" stop-color="#00f2fe"/><stop offset="100%" stop-color="#8b5cf6"/></linearGradient></defs>' +
        grid +
        '<polygon class="chart-area" points="' + area + '"/>' +
        '<polyline class="chart-line" stroke="url(#' + opts.gradId + ')" points="' + coords.join(' ') + '"/>' +
        dots + labels +
      '</svg>';
  }

  function compactNum(v) {
    if (v >= 10000) return (v / 1000).toFixed(0) + 'k';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return String(Math.round(v));
  }

  function drawBars(container, bars) {
    if (!bars.some(b => b.value > 0)) {
      container.innerHTML = '<div class="empty-state">この期間の記録はありません</div>';
      return;
    }
    const W = 320, H = 180, padL = 8, padR = 8, padT = 22, padB = 26;
    const n = bars.length;
    const slot = (W - padL - padR) / n;
    const bw = slot * 0.62;
    const max = Math.max.apply(null, bars.map(b => b.value));
    let out = '';
    bars.forEach((b, i) => {
      const h = max > 0 ? (b.value / max) * (H - padT - padB) : 0;
      const bx = padL + slot * i + (slot - bw) / 2;
      const by = H - padB - h;
      const cur = i === n - 1 ? ' current' : '';
      out += '<rect class="chart-bar' + cur + '" x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + Math.max(h, 0).toFixed(1) + '" rx="4"><title>' +
        escapeHtml(b.label) + ': ' + b.value.toLocaleString() + 'kg</title></rect>';
      if (b.value > 0) {
        out += '<text class="chart-axis-text bar-val" x="' + (bx + bw / 2).toFixed(1) + '" y="' + (by - 4).toFixed(1) +
          '" text-anchor="middle">' + compactNum(b.value) + '</text>';
      }
      out += '<text class="chart-axis-text" x="' + (bx + bw / 2).toFixed(1) + '" y="' + (H - 9) +
        '" text-anchor="middle">' + escapeHtml(b.label) + '</text>';
    });
    container.innerHTML =
      '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="ボリュームの推移">' +
        '<defs><linearGradient id="gradBars" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#00f2fe"/><stop offset="100%" stop-color="#4facfe"/></linearGradient></defs>' +
        '<line class="chart-grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (H - padB) + '" y2="' + (H - padB) + '"/>' +
        out +
      '</svg>';
  }

  // =====================================================
  // Rendering: analysis tab (calendar / report / body weight)
  // =====================================================
  function groupLogsByDate() {
    const m = {};
    logs.forEach(l => { (m[l.dateKey] = m[l.dateKey] || []).push(l); });
    return m;
  }

  function computeStreaks(byDate) {
    const keys = Object.keys(byDate).sort();
    let longest = 0, run = 0, prev = null;
    keys.forEach(k => {
      if (prev && keyFromDate(addDays(dateFromKey(prev), 1)) === k) run++;
      else run = 1;
      if (run > longest) longest = run;
      prev = k;
    });
    // current: 今日から(今日がなければ昨日から)連続した日数
    let cur = 0;
    let d = new Date();
    if (!byDate[keyFromDate(d)]) d = addDays(d, -1);
    while (byDate[keyFromDate(d)]) { cur++; d = addDays(d, -1); }
    const monthPrefix = keyFromDate(new Date()).slice(0, 7);
    const monthDays = keys.filter(k => k.startsWith(monthPrefix)).length;
    return { current: cur, longest: longest, month: monthDays };
  }

  function renderCalendar() {
    const byDate = groupLogsByDate();
    const st = computeStreaks(byDate);
    $('streakCurrent').textContent = st.current;
    $('streakLongest').textContent = st.longest;
    $('streakMonth').textContent = st.month;

    $('calTitle').textContent = calYear + '年' + (calMonth + 1) + '月';
    $('calHead').innerHTML = ['月', '火', '水', '木', '金', '土', '日'].map(d => '<span>' + d + '</span>').join('');

    let maxVol = 0;
    Object.keys(byDate).forEach(k => {
      const v = byDate[k].reduce((s, l) => s + (l.volume || 0), 0);
      if (v > maxVol) maxVol = v;
    });

    const first = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
    const days = new Date(calYear, calMonth + 1, 0).getDate();
    const tKey = todayKey();
    let html = '';
    for (let i = 0; i < first; i++) html += '<div class="cal-cell empty"></div>';
    for (let d = 1; d <= days; d++) {
      const key = calYear + '-' + pad(calMonth + 1) + '-' + pad(d);
      const dayLogs = byDate[key];
      let cls = 'cal-cell';
      if (dayLogs) {
        const vol = dayLogs.reduce((s, l) => s + (l.volume || 0), 0);
        const ratio = maxVol > 0 ? vol / maxVol : 0;
        cls += ' has ' + (ratio > 0.66 ? 'lv3' : ratio > 0.33 ? 'lv2' : 'lv1');
      }
      if (key === tKey) cls += ' today';
      if (key === selectedDay) cls += ' selected';
      html += '<button type="button" class="' + cls + '" data-key="' + key + '">' + d + '</button>';
    }
    $('calGrid').innerHTML = html;

    // Detail
    const detail = $('calDetail');
    const dayLogs = byDate[selectedDay];
    if (!dayLogs) {
      detail.innerHTML = '<div class="empty-state small">' + selectedDay + ' の記録はありません</div>';
      return;
    }
    const vol = dayLogs.reduce((s, l) => s + (l.volume || 0), 0);
    const perEx = {};
    dayLogs.forEach(l => {
      const p = perEx[l.exercise] = perEx[l.exercise] || { sets: 0, max: 0 };
      p.sets++;
      if (l.weight > p.max) p.max = l.weight;
    });
    detail.innerHTML = '<div class="cal-detail-head">📅 ' + selectedDay + ' ・ ' + dayLogs.length + 'セット ・ ' +
      vol.toLocaleString() + 'kg</div>' +
      Object.keys(perEx).map(ex =>
        '<div class="cal-detail-row"><span>' + escapeHtml(ex) + '</span><span>' + perEx[ex].sets + 'セット / 最大' + perEx[ex].max + 'kg</span></div>').join('');
  }

  function reportBuckets(mode) {
    const now = new Date();
    const buckets = [];
    if (mode === 'week') {
      const s = startOfWeek(now);
      for (let i = 7; i >= 0; i--) {
        const st = addDays(s, -7 * i);
        buckets.push({ start: keyFromDate(st), end: keyFromDate(addDays(st, 6)), label: (st.getMonth() + 1) + '/' + st.getDate() });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const st = new Date(now.getFullYear(), now.getMonth() - i, 1, 12);
        const en = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 12);
        buckets.push({ start: keyFromDate(st), end: keyFromDate(en), label: (st.getMonth() + 1) + '月' });
      }
    }
    return buckets;
  }

  function bucketStats(b) {
    const items = logs.filter(l => l.dateKey >= b.start && l.dateKey <= b.end);
    const days = new Set(items.map(l => l.dateKey));
    return {
      items: items,
      volume: items.reduce((s, l) => s + (l.volume || 0), 0),
      sets: items.length,
      days: days.size
    };
  }

  function diffHtml(cur, prev) {
    if (!prev) return '<span class="diff flat">-</span>';
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return '<span class="diff flat">±0%</span>';
    return pct > 0 ? '<span class="diff up">▲ ' + pct + '%</span>' : '<span class="diff down">▼ ' + Math.abs(pct) + '%</span>';
  }

  function renderReport() {
    document.querySelectorAll('#reportSeg .seg-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-report') === reportMode);
    });
    const buckets = reportBuckets(reportMode);
    const stats = buckets.map(bucketStats);
    const cur = stats[stats.length - 1];
    const prev = stats[stats.length - 2];
    const curLabel = reportMode === 'week' ? '今週' : '今月';
    const prevLabel = reportMode === 'week' ? '先週' : '先月';

    $('reportSummary').innerHTML =
      '<div class="report-card"><span class="rc-label">' + curLabel + 'のボリューム</span><span class="rc-value">' +
        cur.volume.toLocaleString() + '<small>kg</small></span><span class="rc-sub">' + prevLabel + '比 ' + diffHtml(cur.volume, prev.volume) + '</span></div>' +
      '<div class="report-card"><span class="rc-label">セット数</span><span class="rc-value">' +
        cur.sets + '<small>sets</small></span><span class="rc-sub">' + prevLabel + '比 ' + diffHtml(cur.sets, prev.sets) + '</span></div>' +
      '<div class="report-card"><span class="rc-label">トレーニング日数</span><span class="rc-value">' +
        cur.days + '<small>日</small></span><span class="rc-sub">' + prevLabel + ' ' + prev.days + '日</span></div>';

    drawBars($('reportBars'), buckets.map((b, i) => ({ label: b.label, value: stats[i].volume })));

    // Part breakdown (current period)
    const byPart = {};
    cur.items.forEach(l => {
      const p = partOf(l.exercise);
      byPart[p] = (byPart[p] || 0) + (l.volume || 0);
    });
    const total = Object.keys(byPart).reduce((s, k) => s + byPart[k], 0);
    const box = $('partBreakdown');
    if (total <= 0) {
      box.innerHTML = '<div class="empty-state small">' + curLabel + 'の記録はまだありません</div>';
      return;
    }
    box.innerHTML = Object.keys(byPart).sort((a, b) => byPart[b] - byPart[a]).map(p => {
      const pct = Math.round((byPart[p] / total) * 100);
      return '<div class="part-row"><span class="part-name">' + escapeHtml(p) + '</span>' +
        '<div class="part-bar"><div class="part-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="part-val">' + pct + '% <small>' + byPart[p].toLocaleString() + 'kg</small></span></div>';
    }).join('');
  }

  function renderBodyweight() {
    const list = bodyweights;
    const stats = $('bwStats');
    if (list.length === 0) {
      stats.innerHTML = '<div class="empty-state small">体重を記録するとグラフが表示されます</div>';
    } else {
      const latest = list[list.length - 1];
      const first = list[0];
      const before = list.length >= 2 ? list[list.length - 2] : null;
      const sign = v => (v > 0 ? '+' : '') + round1(v);
      stats.innerHTML =
        '<div class="report-card"><span class="rc-label">最新</span><span class="rc-value">' + round1(latest.kg) +
          '<small>kg</small></span><span class="rc-sub">' + latest.dateKey.slice(5).replace('-', '/') + '</span></div>' +
        '<div class="report-card"><span class="rc-label">前回比</span><span class="rc-value">' +
          (before ? sign(latest.kg - before.kg) : '-') + '<small>kg</small></span><span class="rc-sub">&nbsp;</span></div>' +
        '<div class="report-card"><span class="rc-label">開始比</span><span class="rc-value">' +
          (list.length >= 2 ? sign(latest.kg - first.kg) : '-') + '<small>kg</small></span><span class="rc-sub">' +
          first.dateKey.slice(5).replace('-', '/') + '〜</span></div>';
    }
    drawLineChart($('bwChart'), list.map(b => ({ key: b.dateKey, value: b.kg })), {
      unit: 'kg', gradId: 'gradBw', label: '体重', emptyMessage: 'グラフは2日以上の記録で表示されます'
    });

    $('bwList').innerHTML = list.slice(-10).reverse().map(b =>
      '<div class="set-row"><div class="set-main"><div class="set-info-primary">' + round1(b.kg) + ' kg</div>' +
      '<div class="set-info-sub">' + b.dateKey + '</div></div>' +
      '<div class="set-row-actions"><button class="bw-delete-btn set-delete-btn" data-id="' + escapeHtml(b.id) +
      '" title="削除" aria-label="削除">×</button></div></div>').join('');
  }

  function saveBodyweight() {
    const dateKey = $('bwDateInput').value || todayKey();
    const kg = parseFloat($('bwInput').value);
    if (isNaN(kg) || kg <= 0 || kg > 500) { alert('体重を正しく入力してください'); return; }
    const existing = bodyweights.find(b => b.dateKey === dateKey);
    if (existing) existing.kg = kg;
    else bodyweights.push({ id: uid('bw'), dateKey: dateKey, kg: kg });
    bodyweights.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    saveBodyweights();
    $('bwInput').value = '';
    renderBodyweight();
    showToast('⚖️ 体重を記録しました (' + round1(kg) + 'kg)');
  }

  function renderAnalysis() {
    renderCalendar();
    renderReport();
    renderBodyweight();
  }

  // =====================================================
  // Rendering: settings tab
  // =====================================================
  function renderExerciseManage() {
    const list = allExercises();
    $('exerciseManageList').innerHTML = list.length ? list.map(e =>
      '<div class="manage-row"><div class="manage-name">' + escapeHtml(e.name) +
        '<span class="part-tag">' + escapeHtml(e.part) + '</span></div>' +
      '<div class="manage-actions">' +
        '<button type="button" class="mini-btn" data-action="up" data-name="' + escapeHtml(e.name) + '" aria-label="上へ">▲</button>' +
        '<button type="button" class="mini-btn" data-action="down" data-name="' + escapeHtml(e.name) + '" aria-label="下へ">▼</button>' +
        '<button type="button" class="mini-btn danger" data-action="del" data-name="' + escapeHtml(e.name) + '" aria-label="削除">✕</button>' +
      '</div></div>').join('')
      : '<div class="empty-state small">種目がありません。記録タブから追加できます。</div>';
  }

  function renderRoutinePicker() {
    const picker = $('routineExercisePicker');
    const selected = new Set(Array.prototype.map.call(
      picker.querySelectorAll('.chip.selected'), c => c.getAttribute('data-name')));
    picker.innerHTML = allExercises().map(e =>
      '<button type="button" class="chip' + (selected.has(e.name) ? ' selected' : '') +
      '" data-name="' + escapeHtml(e.name) + '">' + escapeHtml(e.name) + '</button>').join('');
  }

  function renderRoutineManage() {
    $('routineManageList').innerHTML = settings.routines.length ? settings.routines.map(r =>
      '<div class="manage-row"><div class="manage-name">' + escapeHtml(r.name) +
        '<span class="part-tag">' + r.exercises.length + '種目</span>' +
        '<div class="manage-sub">' + escapeHtml(r.exercises.join(' / ')) + '</div></div>' +
      '<div class="manage-actions"><button type="button" class="mini-btn danger" data-action="del-routine" data-id="' +
        escapeHtml(r.id) + '" aria-label="削除">✕</button></div></div>').join('')
      : '<div class="empty-state small">ルーティンはまだありません</div>';
  }

  function addRoutine() {
    const name = $('routineNameInput').value.trim();
    const exercises = Array.prototype.map.call(
      $('routineExercisePicker').querySelectorAll('.chip.selected'), c => c.getAttribute('data-name'));
    if (!name) { alert('ルーティン名を入力してください'); return; }
    if (exercises.length === 0) { alert('種目を1つ以上選んでください'); return; }
    settings.routines.push({ id: uid('rt'), name: name, exercises: exercises });
    saveSettings();
    $('routineNameInput').value = '';
    $('routineExercisePicker').querySelectorAll('.chip.selected').forEach(c => c.classList.remove('selected'));
    renderRoutineManage();
    renderRoutineBar();
    showToast('📋 ルーティン「' + name + '」を追加しました');
  }

  function renderDataInfo() {
    const t = $('lastBackupText');
    if (!settings.lastExport) {
      t.textContent = 'まだバックアップしていません。';
    } else {
      const d = new Date(settings.lastExport);
      const days = Math.floor((Date.now() - settings.lastExport) / DAY_MS);
      t.textContent = '最後のバックアップ: ' + d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() +
        ' (' + (days <= 0 ? '今日' : days + '日前') + ')';
    }
  }

  function renderInstallInfo() {
    const hint = $('installHint');
    const ua = navigator.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone;
    if (standalone) hint.textContent = '✅ ホーム画面のアプリとして起動しています。';
    else if (isIOS) hint.textContent = 'Safariの共有ボタン(□に↑)→「ホーム画面に追加」で、アプリのように使えます。';
    else hint.textContent = 'ブラウザのメニュー →「ホーム画面に追加」(または「アプリをインストール」)で、アプリのように使えます。';

    const status = $('offlineStatus');
    if (!('serviceWorker' in navigator)) { status.textContent = 'この環境ではオフライン機能は使えません。'; return; }
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      status.textContent = 'ファイルを直接開いている間はオフライン機能は無効です。公開URLから開くと有効になります。';
      return;
    }
    navigator.serviceWorker.getRegistration().then(reg => {
      status.textContent = (reg && reg.active)
        ? '✅ オフライン対応: 有効(電波がなくても記録できます)'
        : '⏳ オフライン対応を準備中です。一度ページを再読み込みしてください。';
    }).catch(() => { status.textContent = ''; });

    if (deferredInstallPrompt && !$('btnInstall')) {
      const btn = document.createElement('button');
      btn.id = 'btnInstall';
      btn.type = 'button';
      btn.className = 'secondary-btn full-btn';
      btn.textContent = '📲 アプリとしてインストール';
      btn.addEventListener('click', () => {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.finally(() => { deferredInstallPrompt = null; btn.remove(); });
      });
      hint.parentNode.insertBefore(btn, $('offlineStatus'));
    }
  }

  function renderSettings() {
    applyTheme();
    renderExerciseManage();
    renderRoutinePicker();
    renderRoutineManage();
    renderDataInfo();
    renderInstallInfo();
    wakeLockToggle.checked = !!settings.wakeLock;
    notifyToggle.checked = !!settings.notify && ('Notification' in window) && Notification.permission === 'granted';
    $('backupReminderToggle').checked = !!settings.backupReminder;
    autoStartTimerToggle.checked = !!settings.autoTimer;
  }

  function refreshAll() {
    renderTodayStats();
    renderHistoryView();
    renderRoutineBar();
    updateExerciseReference(false);
    updateBackupBanner();
    renderAnalysis();
  }

  // =====================================================
  // Export / Import
  // =====================================================
  function exportData() {
    const payload = {
      app: 'AegisLift',
      version: 2,
      exportedAt: new Date().toISOString(),
      logs: logs,
      bodyweights: bodyweights,
      settings: {
        customExercises: settings.customExercises,
        hiddenExercises: settings.hiddenExercises,
        order: settings.order,
        routines: settings.routines
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aegislift-backup-' + todayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    settings.lastExport = Date.now();
    saveSettings();
    renderDataInfo();
    updateBackupBanner();
    showToast('📤 バックアップを書き出しました');
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    importFileInput.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        let rawLogs, rawBw = [], rawSettings = null;
        if (Array.isArray(data)) rawLogs = data;                 // 旧形式(記録のみ)
        else if (data && Array.isArray(data.logs)) {
          rawLogs = data.logs;
          if (Array.isArray(data.bodyweights)) rawBw = data.bodyweights;
          if (data.settings && typeof data.settings === 'object') rawSettings = data.settings;
        } else throw new Error('invalid');

        const validLogs = rawLogs.map(normalizeLog).filter(Boolean);
        const validBw = rawBw.map(normalizeBw).filter(Boolean);
        if (validLogs.length === 0 && validBw.length === 0) throw new Error('empty');

        const ok = confirm('記録 ' + validLogs.length + '件・体重 ' + validBw.length +
          '件を読み込みます。\nOK: 現在のデータに統合(重複は除外)\nキャンセル: 中止');
        if (!ok) return;

        const ids = new Set(logs.map(l => l.id));
        validLogs.forEach(l => { if (!ids.has(l.id)) { logs.push(l); ids.add(l.id); } });
        logs.sort((a, b) => (a.dateKey + a.timeStr).localeCompare(b.dateKey + b.timeStr));
        saveLogs();

        validBw.forEach(b => {
          const ex = bodyweights.find(x => x.dateKey === b.dateKey);
          if (!ex) bodyweights.push(b);
        });
        bodyweights.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
        saveBodyweights();

        if (rawSettings) {
          if (Array.isArray(rawSettings.customExercises)) {
            rawSettings.customExercises.forEach(c => {
              if (c && typeof c.name === 'string' && PARTS.includes(c.part) &&
                  !settings.customExercises.some(x => x.name === c.name)) settings.customExercises.push({ name: c.name, part: c.part });
            });
          }
          if (Array.isArray(rawSettings.routines)) {
            rawSettings.routines.forEach(r => {
              if (r && typeof r.id === 'string' && typeof r.name === 'string' && Array.isArray(r.exercises) &&
                  !settings.routines.some(x => x.id === r.id)) settings.routines.push({ id: r.id, name: r.name, exercises: r.exercises.filter(n => typeof n === 'string') });
            });
          }
        }
        // 記録にあるのに種目リストにない種目は、カスタム種目として登録
        logs.forEach(l => {
          if (!DEFAULT_EXERCISES.some(d => d.name === l.exercise) && !settings.customExercises.some(c => c.name === l.exercise)) {
            settings.customExercises.push({ name: l.exercise, part: 'その他' });
          }
        });
        saveSettings();

        renderExerciseSelect();
        renderSettings();
        refreshAll();
        alert('インポートが完了しました');
      } catch (err) {
        alert('読み込めないファイルです。エクスポートしたJSONを選択してください。');
      }
    };
    reader.readAsText(file);
  }

  // =====================================================
  // Timer
  // =====================================================
  function setTimerDuration(seconds) {
    timerDuration = seconds;
    settings.timerSeconds = seconds;
    saveSettings();
    resetTimer();
    updateAutoTimerLabel();
  }

  function updateAutoTimerLabel() {
    autoTimerLabel.textContent = 'セット記録後にインターバルタイマーを自動開始 (' + timerDuration + '秒)';
  }

  function ensureAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }

  function playBeepSound() {
    try {
      ensureAudio();
      if (!audioCtx) return;
      [0, 0.28, 0.56].forEach((offset, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const t = audioCtx.currentTime + offset;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(i === 2 ? 1175 : 880, t);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.25);
      });
    } catch (e) {
      console.log('Audio playback prevented or unsupported', e);
    }
  }

  async function requestWakeLock() {
    if (!settings.wakeLock || !('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { wakeLock = null; }
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  function notifyTimerDone() {
    if (!settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    const title = '休憩終了！';
    const opts = { body: '次のセットを始めましょう 💪', icon: 'icons/icon-192.png', tag: 'aegislift-timer' };
    const fallback = () => { try { new Notification(title, opts); } catch (e) { /* ignore */ } };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) reg.showNotification(title, opts); else fallback();
      }).catch(fallback);
    } else fallback();
  }

  function toggleTimer() {
    if (isTimerRunning) stopTimer(); else startTimer();
  }

  function startTimer() {
    ensureAudio();
    if (timerRemaining <= 0) timerRemaining = timerDuration;
    timerEndAt = Date.now() + timerRemaining * 1000;
    isTimerRunning = true;
    btnTimerStart.textContent = '一時停止';
    btnTimerStart.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
    timerStatus.textContent = 'RESTING';
    timerStatus.style.color = 'var(--accent-cyan)';

    clearInterval(timerInterval);
    timerInterval = setInterval(tickTimer, 250);
    requestWakeLock();
    updateTimerDisplay();
    updateFloatingPillVisibility();
  }

  function tickTimer() {
    if (!isTimerRunning) return;
    const rem = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
    if (rem !== timerRemaining) {
      timerRemaining = rem;
      updateTimerDisplay();
    }
    if (rem <= 0) completeTimer();
  }

  function stopTimer() {
    if (isTimerRunning) timerRemaining = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
    isTimerRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
    releaseWakeLock();
    btnTimerStart.textContent = '再開';
    btnTimerStart.style.background = 'var(--accent-gradient)';
    timerStatus.textContent = 'PAUSED';
    timerStatus.style.color = 'var(--text-sub)';
    updateFloatingPillVisibility();
  }

  function resetTimer() {
    isTimerRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
    releaseWakeLock();
    timerRemaining = timerDuration;
    btnTimerStart.textContent = 'タイマースタート';
    btnTimerStart.style.background = 'var(--accent-gradient)';
    timerStatus.textContent = 'READY';
    timerStatus.style.color = 'var(--accent-cyan)';
    updateTimerDisplay();
    updateFloatingPillVisibility();
  }

  function completeTimer() {
    isTimerRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
    releaseWakeLock();
    timerRemaining = 0;
    updateTimerDisplay();
    timerStatus.textContent = 'READY TO LIFT!';
    timerStatus.style.color = 'var(--accent-emerald)';
    btnTimerStart.textContent = 'スタート';
    btnTimerStart.style.background = 'var(--accent-gradient)';
    playBeepSound();
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200, 100, 400]);
    notifyTimerDone();
    updateFloatingPillVisibility();
    showToast('⏱️ 休憩終了！次のセットへ');
  }

  function updateTimerDisplay() {
    const mins = Math.floor(timerRemaining / 60);
    const secs = timerRemaining % 60;
    timerDigits.textContent = pad(mins) + ':' + pad(secs);
    floatingTimerSec.textContent = timerRemaining;
    const fraction = timerDuration > 0 ? timerRemaining / timerDuration : 0;
    timerProgressCircle.style.strokeDashoffset = CIRCLE_CIRCUMFERENCE * (1 - fraction);
  }

  function updateFloatingPillVisibility() {
    const activeTab = document.querySelector('.tab-pane.active');
    const isTimerTab = activeTab && activeTab.id === 'tab-timer';
    floatingTimerPill.classList.toggle('hidden', !(isTimerRunning && !isTimerTab));
  }

  function syncPresetButtons() {
    presetButtons.forEach(b => {
      b.classList.toggle('active', parseInt(b.getAttribute('data-sec'), 10) === timerDuration);
    });
  }

  // =====================================================
  // Tabs & events
  // =====================================================
  function activateTab(targetTab) {
    tabButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === targetTab));
    tabPanes.forEach(p => p.classList.toggle('active', p.id === targetTab));

    if (targetTab === 'tab-history') renderHistoryView();
    if (targetTab === 'tab-analysis') renderAnalysis();
    if (targetTab === 'tab-settings') renderSettings();
    if (targetTab === 'tab-record') { renderTodayStats(); renderRoutineBar(); updateBackupBanner(); }

    updateFloatingPillVisibility();
    window.scrollTo({ top: 0 });
  }

  function initEventListeners() {
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
    });

    // Theme
    $('themeToggleBtn').addEventListener('click', () => setTheme(effectiveTheme() === 'light' ? 'dark' : 'light'));
    document.querySelectorAll('#themeSeg .seg-btn').forEach(b => {
      b.addEventListener('click', () => setTheme(b.getAttribute('data-theme-opt')));
    });
    if (darkMedia) {
      const onChange = () => { if (settings.theme === 'auto') applyTheme(); };
      if (darkMedia.addEventListener) darkMedia.addEventListener('change', onChange);
      else if (darkMedia.addListener) darkMedia.addListener(onChange);
    }

    // Exercise selection
    exerciseSelect.addEventListener('change', () => {
      if (exerciseSelect.value === '__custom__') {
        customExerciseWrapper.classList.remove('hidden');
        customExerciseInput.focus();
        updateExerciseReference(false);
      } else {
        customExerciseWrapper.classList.add('hidden');
        updateExerciseReference(true);
      }
    });
    customExerciseInput.addEventListener('input', () => updateExerciseReference(true));

    // Steppers (long-press repeat)
    bindStepper($('btnWeightMinus5'), () => changeNumberInput(weightInput, -5, 0));
    bindStepper($('btnWeightMinus'), () => changeNumberInput(weightInput, -1, 0));
    bindStepper($('btnWeightPlus'), () => changeNumberInput(weightInput, 1, 0));
    bindStepper($('btnWeightPlus5'), () => changeNumberInput(weightInput, 5, 0));
    bindStepper($('btnRepsMinus'), () => changeNumberInput(repsInput, -1, 1));
    bindStepper($('btnRepsPlus'), () => changeNumberInput(repsInput, 1, 1));
    weightInput.addEventListener('input', updateE1rmPreview);
    repsInput.addEventListener('input', updateE1rmPreview);

    // Save / repeat
    btnSaveSet.addEventListener('click', handleSaveSet);
    btnRepeatLast.addEventListener('click', handleRepeatLast);

    // Set list actions (edit / delete)
    todaySetsList.addEventListener('click', handleSetListClick);
    allHistoryList.addEventListener('click', handleSetListClick);

    // Routine bar
    $('routineChips').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-routine]');
      if (!chip) return;
      const id = chip.getAttribute('data-routine');
      activeRoutineId = activeRoutineId === id ? null : id;
      renderRoutineBar();
    });
    $('routineExerciseChips').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-exercise]');
      if (chip) selectExercise(chip.getAttribute('data-exercise'));
    });

    // Clear today / all
    btnClearTodayBtn.addEventListener('click', () => {
      if (confirm('本日の記録をすべて削除しますか？')) {
        logs = logs.filter(item => item.dateKey !== todayKey());
        saveLogs();
        refreshAll();
      }
    });
    btnClearAllHistoryBtn.addEventListener('click', () => {
      if (confirm('すべてのトレーニング履歴を削除しますか？この操作は取り消せません。')) {
        logs = [];
        saveLogs();
        refreshAll();
      }
    });

    // Backup banner
    $('btnBackupNow').addEventListener('click', exportData);

    // Chart controls
    chartExerciseSelect.addEventListener('change', renderProgressChart);
    document.querySelectorAll('#chartMetricSeg .seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        chartMetric = b.getAttribute('data-metric');
        document.querySelectorAll('#chartMetricSeg .seg-btn').forEach(x => x.classList.toggle('active', x === b));
        renderProgressChart();
      });
    });
    document.querySelectorAll('#chartPeriodSeg .seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        chartPeriod = b.getAttribute('data-period');
        document.querySelectorAll('#chartPeriodSeg .seg-btn').forEach(x => x.classList.toggle('active', x === b));
        renderProgressChart();
      });
    });

    // Calendar
    $('calPrev').addEventListener('click', () => {
      calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar();
    });
    $('calNext').addEventListener('click', () => {
      calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar();
    });
    $('calGrid').addEventListener('click', (e) => {
      const cell = e.target.closest('.cal-cell[data-key]');
      if (!cell) return;
      selectedDay = cell.getAttribute('data-key');
      renderCalendar();
    });

    // Report
    document.querySelectorAll('#reportSeg .seg-btn').forEach(b => {
      b.addEventListener('click', () => { reportMode = b.getAttribute('data-report'); renderReport(); });
    });

    // Body weight
    $('bwDateInput').value = todayKey();
    $('btnSaveBw').addEventListener('click', saveBodyweight);
    $('bwList').addEventListener('click', (e) => {
      const btn = e.target.closest('.bw-delete-btn');
      if (!btn) return;
      bodyweights = bodyweights.filter(b => b.id !== btn.getAttribute('data-id'));
      saveBodyweights();
      renderBodyweight();
    });

    // Settings: exercises & routines
    $('exerciseManageList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const name = btn.getAttribute('data-name');
      const act = btn.getAttribute('data-action');
      if (act === 'up') moveExercise(name, -1);
      else if (act === 'down') moveExercise(name, 1);
      else if (act === 'del') removeExercise(name);
    });
    $('btnRestoreExercises').addEventListener('click', () => {
      settings.hiddenExercises = [];
      saveSettings();
      renderExerciseSelect();
      renderExerciseManage();
      renderRoutinePicker();
      showToast('標準種目を元に戻しました');
    });
    $('routineExercisePicker').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) chip.classList.toggle('selected');
    });
    $('btnAddRoutine').addEventListener('click', addRoutine);
    $('routineManageList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="del-routine"]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const r = settings.routines.find(x => x.id === id);
      if (!r || !confirm('ルーティン「' + r.name + '」を削除しますか？')) return;
      settings.routines = settings.routines.filter(x => x.id !== id);
      if (activeRoutineId === id) activeRoutineId = null;
      saveSettings();
      renderRoutineManage();
      renderRoutineBar();
    });

    // Settings: toggles
    autoStartTimerToggle.addEventListener('change', () => { settings.autoTimer = autoStartTimerToggle.checked; saveSettings(); });
    wakeLockToggle.addEventListener('change', () => {
      settings.wakeLock = wakeLockToggle.checked;
      saveSettings();
      if (!settings.wakeLock) releaseWakeLock(); else if (isTimerRunning) requestWakeLock();
    });
    $('backupReminderToggle').addEventListener('change', () => {
      settings.backupReminder = $('backupReminderToggle').checked;
      saveSettings();
      updateBackupBanner();
    });
    notifyToggle.addEventListener('change', () => {
      if (!notifyToggle.checked) { settings.notify = false; saveSettings(); return; }
      if (!('Notification' in window)) {
        notifyToggle.checked = false;
        showToast('この端末では通知を使えません');
        return;
      }
      Notification.requestPermission().then(p => {
        settings.notify = p === 'granted';
        notifyToggle.checked = settings.notify;
        saveSettings();
        if (p !== 'granted') showToast('通知が許可されませんでした');
      });
    });

    // Data management
    btnExportData.addEventListener('click', exportData);
    btnImportData.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', handleImportFile);

    // Timer
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const sec = parseInt(btn.getAttribute('data-sec'), 10);
        setTimerDuration(sec);
        syncPresetButtons();
      });
    });
    btnTimerStart.addEventListener('click', toggleTimer);
    btnTimerReset.addEventListener('click', resetTimer);
    floatingStopBtn.addEventListener('click', () => { stopTimer(); updateFloatingPillVisibility(); });

    // Edit modal
    $('btnEditCancel').addEventListener('click', closeEditModal);
    $('btnEditSave').addEventListener('click', saveEdit);
    $('editModal').addEventListener('click', (e) => { if (e.target === $('editModal')) closeEditModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && editingId) closeEditModal();
      if (e.key === 'Enter' && editingId && e.target.tagName === 'INPUT') saveEdit();
    });

    // Visibility: タイマーはバックグラウンドから戻ったときに再計算
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        tickTimer();
        if (isTimerRunning && !wakeLock) requestWakeLock();
      }
    });

    // PWA install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if ($('tab-settings').classList.contains('active')) renderInstallInfo();
    });
  }

  function initDateHeader() {
    const dateStr = new Date().toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' });
    const badge = $('todayDateBadge');
    if (badge) badge.textContent = dateStr;
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.log('SW registration failed', err));
    });
  }

  // =====================================================
  // Boot
  // =====================================================
  applyTheme();
  initDateHeader();
  renderCustomPartSelect();
  renderExerciseSelect();
  syncPresetButtons();
  updateAutoTimerLabel();
  autoStartTimerToggle.checked = !!settings.autoTimer;
  wakeLockToggle.checked = !!settings.wakeLock;
  initEventListeners();
  updateTimerDisplay();
  updateExerciseReference(true);
  renderTodayStats();
  renderRoutineBar();
  renderHistoryView();
  updateBackupBanner();
  registerServiceWorker();
})();

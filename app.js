// AegisLift - AI-Driven Workout Tracker Logic
(function () {
  'use strict';

  // --- State & Storage Keys ---
  const STORAGE_KEY = 'aegislift_workout_logs_v1';
  let logs = loadLogs();

  // Timer State
  let timerInterval = null;
  let timerDuration = 90; // Default seconds
  let timerRemaining = 90;
  let isTimerRunning = false;

  // --- DOM Elements ---
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  const exerciseSelect = document.getElementById('exerciseSelect');
  const customExerciseWrapper = document.getElementById('customExerciseWrapper');
  const customExerciseInput = document.getElementById('customExerciseInput');

  const previousBestText = document.getElementById('previousBestText');
  const weightInput = document.getElementById('weightInput');
  const repsInput = document.getElementById('repsInput');
  const autoStartTimerToggle = document.getElementById('autoStartTimerToggle');
  const btnSaveSet = document.getElementById('btnSaveSet');

  const todayVolumeElem = document.getElementById('todayVolume');
  const todaySetsElem = document.getElementById('todaySets');
  const todaySetsList = document.getElementById('todaySetsList');
  const btnClearTodayBtn = document.getElementById('btnClearTodayBtn');

  // Steppers
  const btnWeightMinus5 = document.getElementById('btnWeightMinus5');
  const btnWeightMinus = document.getElementById('btnWeightMinus');
  const btnWeightPlus = document.getElementById('btnWeightPlus');
  const btnWeightPlus5 = document.getElementById('btnWeightPlus5');
  const btnRepsMinus = document.getElementById('btnRepsMinus');
  const btnRepsPlus = document.getElementById('btnRepsPlus');

  // Timer Elements
  const timerDigits = document.getElementById('timerDigits');
  const timerStatus = document.getElementById('timerStatus');
  const timerProgressCircle = document.getElementById('timerProgressCircle');
  const presetButtons = document.querySelectorAll('.preset-btn');
  const btnTimerStart = document.getElementById('btnTimerStart');
  const btnTimerReset = document.getElementById('btnTimerReset');

  // Floating Timer Pill
  const floatingTimerPill = document.getElementById('floatingTimerPill');
  const floatingTimerSec = document.getElementById('floatingTimerSec');
  const floatingStopBtn = document.getElementById('floatingStopBtn');

  // History & Max
  const maxRecordsContainer = document.getElementById('maxRecordsContainer');
  const allHistoryList = document.getElementById('allHistoryList');
  const btnClearAllHistoryBtn = document.getElementById('btnClearAllHistoryBtn');

  // Chart & Data management
  const chartExerciseSelect = document.getElementById('chartExerciseSelect');
  const progressChart = document.getElementById('progressChart');
  const btnExportData = document.getElementById('btnExportData');
  const btnImportData = document.getElementById('btnImportData');
  const importFileInput = document.getElementById('importFileInput');

  // Circle circumference: 2 * PI * 45 ≈ 282.74
  const CIRCLE_CIRCUMFERENCE = 282.74;

  // --- Initial Setup ---
  initDateHeader();
  initEventListeners();
  updateExerciseReference(true);
  renderTodayStats();
  renderHistoryView();

  function initDateHeader() {
    const today = new Date();
    const options = { month: 'short', day: 'numeric', weekday: 'short' };
    const dateStr = today.toLocaleDateString('ja-JP', options);
    const dateBadge = document.getElementById('todayDateBadge');
    if (dateBadge) dateBadge.textContent = dateStr;
  }

  // --- Tab Navigation ---
  function initEventListeners() {
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        tabButtons.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const targetPane = document.getElementById(targetTab);
        if (targetPane) targetPane.classList.add('active');

        // Refresh analytics tab if activated
        if (targetTab === 'tab-history') {
          renderHistoryView();
        }

        // Toggle floating pill visibility (hide when on timer tab)
        updateFloatingPillVisibility();
      });
    });

    // Exercise Selection Change
    exerciseSelect.addEventListener('change', () => {
      if (exerciseSelect.value === '__custom__') {
        customExerciseWrapper.classList.remove('hidden');
        customExerciseInput.focus();
      } else {
        customExerciseWrapper.classList.add('hidden');
        updateExerciseReference(true);
      }
    });

    customExerciseInput.addEventListener('input', () => {
      updateExerciseReference(true);
    });

    // Stepper Handlers
    btnWeightMinus5.addEventListener('click', () => changeNumberInput(weightInput, -5, 0));
    btnWeightMinus.addEventListener('click', () => changeNumberInput(weightInput, -1, 0));
    btnWeightPlus.addEventListener('click', () => changeNumberInput(weightInput, 1, 0));
    btnWeightPlus5.addEventListener('click', () => changeNumberInput(weightInput, 5, 0));

    btnRepsMinus.addEventListener('click', () => changeNumberInput(repsInput, -1, 1));
    btnRepsPlus.addEventListener('click', () => changeNumberInput(repsInput, 1, 1));

    // Save Set
    btnSaveSet.addEventListener('click', handleSaveSet);

    // Clear Today's Log
    btnClearTodayBtn.addEventListener('click', () => {
      if (confirm('本日の記録をすべて削除しますか？')) {
        const todayStr = getTodayDateKey();
        logs = logs.filter(item => item.dateKey !== todayStr);
        saveLogs();
        renderTodayStats();
        renderHistoryView();
        updateExerciseReference(false);
      }
    });

    // Clear All History
    btnClearAllHistoryBtn.addEventListener('click', () => {
      if (confirm('すべてのトレーニング履歴を削除しますか？この操作は取り消せません。')) {
        logs = [];
        saveLogs();
        renderTodayStats();
        renderHistoryView();
        updateExerciseReference(false);
      }
    });

    // Chart exercise selection
    chartExerciseSelect.addEventListener('change', renderProgressChart);

    // Export / Import
    btnExportData.addEventListener('click', exportData);
    btnImportData.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', handleImportFile);

    // Delete from history (event delegation)
    allHistoryList.addEventListener('click', (e) => {
      const btn = e.target.closest('.set-delete-btn');
      if (!btn) return;
      deleteSetById(btn.getAttribute('data-id'));
    });

    // Timer Preset Buttons
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        presetButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const sec = parseInt(btn.getAttribute('data-sec'), 10);
        setTimerDuration(sec);
      });
    });

    // Timer Controls
    btnTimerStart.addEventListener('click', toggleTimer);
    btnTimerReset.addEventListener('click', resetTimer);

    // Floating Pill Close
    floatingStopBtn.addEventListener('click', () => {
      stopTimer();
      updateFloatingPillVisibility();
    });
  }

  function changeNumberInput(input, delta, min = 0) {
    let val = parseFloat(input.value) || 0;
    val = Math.max(min, val + delta);
    // If float, keep 1 decimal place, else integer
    input.value = delta % 1 === 0 && val % 1 === 0 ? val : val.toFixed(1);
  }

  function getCurrentExerciseName() {
    if (exerciseSelect.value === '__custom__') {
      return customExerciseInput.value.trim() || 'カスタム種目';
    }
    return exerciseSelect.value;
  }

  // --- Reference & Auto-Fill ---
  // autoFill: true のときだけ入力欄を前回値で上書きする(ユーザー入力を壊さないため)
  function updateExerciseReference(autoFill) {
    const exercise = getCurrentExerciseName();
    const exerciseLogs = logs.filter(l => l.exercise === exercise);

    if (exerciseLogs.length === 0) {
      previousBestText.textContent = `前回記録: なし (最初のセットを記録しよう)`;
      return;
    }

    // Get the most recent log
    const lastLog = exerciseLogs[exerciseLogs.length - 1];
    // Find highest weight
    const maxWeight = Math.max(...exerciseLogs.map(l => l.weight));

    previousBestText.innerHTML = `前回: <strong>${lastLog.weight}kg × ${lastLog.reps}回</strong> (MAX: ${maxWeight}kg)`;

    // Auto-fill only when explicitly requested (exercise change / initial load)
    if (autoFill) {
      weightInput.value = lastLog.weight;
      repsInput.value = lastLog.reps;
    }
  }

  // --- Save Set Logic ---
  function handleSaveSet() {
    const exercise = getCurrentExerciseName();
    const weight = parseFloat(weightInput.value);
    const reps = parseInt(repsInput.value, 10);

    if (!exercise) {
      alert('種目名を入力してください');
      return;
    }
    if (isNaN(weight) || weight < 0 || isNaN(reps) || reps <= 0) {
      alert('重量と回数を正しく入力してください');
      return;
    }

    const now = new Date();
    const newEntry = {
      id: 'set_' + Date.now(),
      dateKey: getTodayDateKey(),
      timeStr: now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
      exercise: exercise,
      weight: weight,
      reps: reps,
      volume: Math.round(weight * reps)
    };

    logs.push(newEntry);
    saveLogs();

    // Trigger visual feedback on button
    btnSaveSet.innerHTML = '<span>✅ 記録完了！</span>';
    setTimeout(() => {
      btnSaveSet.innerHTML = '<span>⚡ セットを完了して記録</span>';
    }, 1200);

    renderTodayStats();
    updateExerciseReference(false);

    // Auto-start Timer if checked
    if (autoStartTimerToggle.checked) {
      resetTimer();
      startTimer();
      // Show floating pill notification
      updateFloatingPillVisibility();
    }
  }

  // --- Render Today Stats ---
  function renderTodayStats() {
    const todayStr = getTodayDateKey();
    const todayLogs = logs.filter(l => l.dateKey === todayStr);

    let totalVolume = 0;
    todayLogs.forEach(l => totalVolume += (l.volume || 0));

    todayVolumeElem.innerHTML = `${totalVolume.toLocaleString()} <span class="unit">kg</span>`;
    todaySetsElem.innerHTML = `${todayLogs.length} <span class="unit">sets</span>`;

    if (todayLogs.length === 0) {
      todaySetsList.innerHTML = '<div class="empty-state">まだ本日の記録はありません</div>';
      return;
    }

    todaySetsList.innerHTML = '';
    // Reverse to show latest set first
    todayLogs.slice().reverse().forEach(log => {
      const row = document.createElement('div');
      row.className = 'set-row';
      row.innerHTML = `
        <div>
          <div class="set-info-primary">${escapeHtml(log.exercise)}</div>
          <div class="set-info-sub">${log.timeStr} • ボリューム: ${(log.volume || 0)}kg</div>
        </div>
        <div style="display:flex; align-items:center;">
          <span class="set-badge">${log.weight}kg × ${log.reps}回</span>
          <button class="set-delete-btn" data-id="${log.id}" title="削除">×</button>
        </div>
      `;
      todaySetsList.appendChild(row);
    });

    // Add delete listeners
    todaySetsList.querySelectorAll('.set-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        deleteSetById(e.currentTarget.getAttribute('data-id'));
      });
    });
  }

  function deleteSetById(id) {
    logs = logs.filter(l => l.id !== id);
    saveLogs();
    renderTodayStats();
    renderHistoryView();
    updateExerciseReference(false);
  }

  // --- Render History & Analytics View ---
  function renderHistoryView() {
    renderChartOptions();
    renderProgressChart();

    // 1. Max Records
    const maxMap = {};
    logs.forEach(l => {
      if (!maxMap[l.exercise] || l.weight > maxMap[l.exercise].weight) {
        maxMap[l.exercise] = l;
      }
    });

    maxRecordsContainer.innerHTML = '';
    const exercises = Object.keys(maxMap);
    if (exercises.length === 0) {
      maxRecordsContainer.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;">記録がありません</div>';
    } else {
      exercises.forEach(ex => {
        const card = document.createElement('div');
        card.className = 'max-card';
        card.innerHTML = `
          <div class="max-exercise-name">${escapeHtml(ex)}</div>
          <div class="max-exercise-val">${maxMap[ex].weight}<span style="font-size:12px;color:var(--text-muted);font-weight:400;">kg</span> <span style="font-size:12px;color:var(--text-sub);font-weight:500;">(${maxMap[ex].reps}回)</span></div>
        `;
        maxRecordsContainer.appendChild(card);
      });
    }

    // 2. Full History Grouped by Date
    allHistoryList.innerHTML = '';
    if (logs.length === 0) {
      allHistoryList.innerHTML = '<div class="empty-state">履歴はありません</div>';
      return;
    }

    const grouped = {};
    logs.forEach(l => {
      if (!grouped[l.dateKey]) grouped[l.dateKey] = [];
      grouped[l.dateKey].push(l);
    });

    // Sort dates descending
    const sortedDates = Object.keys(grouped).sort().reverse();
    sortedDates.forEach(dateKey => {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'history-date-group';

      let totalDayVol = 0;
      grouped[dateKey].forEach(l => totalDayVol += (l.volume || 0));

      groupDiv.innerHTML = `
        <div class="history-date-header">📅 ${dateKey} (合計 ${totalDayVol.toLocaleString()}kg)</div>
      `;

      const listDiv = document.createElement('div');
      listDiv.className = 'sets-list';

      grouped[dateKey].forEach(log => {
        const row = document.createElement('div');
        row.className = 'set-row';
        row.innerHTML = `
          <div>
            <div class="set-info-primary">${escapeHtml(log.exercise)}</div>
            <div class="set-info-sub">${log.timeStr}</div>
          </div>
          <div class="set-row-actions">
            <span class="set-badge">${log.weight}kg × ${log.reps}回</span>
            <button class="set-delete-btn" data-id="${log.id}" title="削除">×</button>
          </div>
        `;
        listDiv.appendChild(row);
      });

      groupDiv.appendChild(listDiv);
      allHistoryList.appendChild(groupDiv);
    });
  }

  // --- Progress Chart (SVG) ---
  function renderChartOptions() {
    const prev = chartExerciseSelect.value;
    const names = [];
    logs.forEach(l => { if (!names.includes(l.exercise)) names.push(l.exercise); });

    chartExerciseSelect.innerHTML = '';
    if (names.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = '記録なし';
      opt.value = '';
      chartExerciseSelect.appendChild(opt);
      return;
    }
    names.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      chartExerciseSelect.appendChild(opt);
    });
    chartExerciseSelect.value = names.includes(prev) ? prev : names[0];
  }

  function renderProgressChart() {
    const exercise = chartExerciseSelect.value;
    if (!exercise) {
      progressChart.innerHTML = '<div class="empty-state">記録がありません</div>';
      return;
    }

    // 日付ごとのMAX重量
    const byDate = {};
    logs.filter(l => l.exercise === exercise).forEach(l => {
      if (!byDate[l.dateKey] || l.weight > byDate[l.dateKey]) byDate[l.dateKey] = l.weight;
    });
    const dates = Object.keys(byDate).sort();
    const values = dates.map(d => byDate[d]);

    if (dates.length < 2) {
      progressChart.innerHTML = '<div class="empty-state">グラフは2日以上の記録で表示されます</div>';
      return;
    }

    const W = 320, H = 180, padL = 34, padR = 12, padT = 14, padB = 26;
    const minV = Math.min(...values), maxV = Math.max(...values);
    const range = maxV - minV || 1;
    const lo = minV - range * 0.15, hi = maxV + range * 0.15;
    const x = i => padL + (i * (W - padL - padR)) / (dates.length - 1);
    const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

    let grid = '';
    for (let i = 0; i < 4; i++) {
      const v = lo + ((hi - lo) * i) / 3;
      const yy = y(v);
      grid += `<line class="chart-grid" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>` +
              `<text class="chart-axis-text" x="${padL - 4}" y="${yy + 3}" text-anchor="end">${Math.round(v * 10) / 10}</text>`;
    }

    const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const baseY = H - padB;
    const area = `${x(0)},${baseY} ${points.join(' ')} ${x(dates.length - 1)},${baseY}`;
    const dots = values.map((v, i) =>
      `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5"><title>${dates[i]}: ${v}kg</title></circle>`
    ).join('');

    const shortDate = d => d.slice(5).replace('-', '/');
    const labels =
      `<text class="chart-axis-text" x="${padL}" y="${H - 8}" text-anchor="start">${shortDate(dates[0])}</text>` +
      `<text class="chart-axis-text" x="${W - padR}" y="${H - 8}" text-anchor="end">${shortDate(dates[dates.length - 1])}</text>`;

    progressChart.innerHTML = `
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(exercise)}の重量推移">
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#00f2fe"/>
            <stop offset="100%" stop-color="#8b5cf6"/>
          </linearGradient>
        </defs>
        ${grid}
        <polygon class="chart-area" points="${area}"/>
        <polyline class="chart-line" points="${points.join(' ')}"/>
        ${dots}
        ${labels}
      </svg>`;
  }

  // --- Export / Import ---
  function exportData() {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aegislift-backup-${getTodayDateKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    importFileInput.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('invalid');
        const valid = data.filter(l =>
          l && typeof l.id === 'string' && typeof l.dateKey === 'string' &&
          typeof l.exercise === 'string' && Number.isFinite(l.weight) && Number.isFinite(l.reps));
        if (valid.length === 0) throw new Error('empty');

        const merge = confirm(`${valid.length}件の記録を読み込みます。\nOK: 現在の記録に統合(重複は除外)\nキャンセル: 中止`);
        if (!merge) return;

        const ids = new Set(logs.map(l => l.id));
        valid.forEach(l => {
          if (!ids.has(l.id)) {
            logs.push({ timeStr: '', volume: Math.round(l.weight * l.reps), ...l });
            ids.add(l.id);
          }
        });
        logs.sort((a, b) => (a.dateKey + a.timeStr).localeCompare(b.dateKey + b.timeStr));
        saveLogs();
        renderTodayStats();
        renderHistoryView();
        updateExerciseReference(false);
        alert('インポートが完了しました');
      } catch (err) {
        alert('読み込めないファイルです。エクスポートしたJSONを選択してください。');
      }
    };
    reader.readAsText(file);
  }

  // --- Timer Engine ---
  function setTimerDuration(seconds) {
    stopTimer();
    timerDuration = seconds;
    timerRemaining = seconds;
    updateTimerDisplay();
  }

  function toggleTimer() {
    if (isTimerRunning) {
      stopTimer();
    } else {
      startTimer();
    }
  }

  function startTimer() {
    if (timerRemaining <= 0) timerRemaining = timerDuration;
    isTimerRunning = true;
    btnTimerStart.textContent = '一時停止';
    btnTimerStart.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
    timerStatus.textContent = 'RESTING';
    timerStatus.style.color = 'var(--accent-cyan)';

    timerInterval = setInterval(() => {
      timerRemaining--;
      updateTimerDisplay();

      if (timerRemaining <= 0) {
        completeTimer();
      }
    }, 1000);

    updateFloatingPillVisibility();
  }

  function stopTimer() {
    isTimerRunning = false;
    clearInterval(timerInterval);
    btnTimerStart.textContent = '再開';
    btnTimerStart.style.background = 'var(--accent-gradient)';
    timerStatus.textContent = 'PAUSED';
    timerStatus.style.color = 'var(--text-sub)';
    updateFloatingPillVisibility();
  }

  function resetTimer() {
    stopTimer();
    timerRemaining = timerDuration;
    btnTimerStart.textContent = 'タイマースタート';
    timerStatus.textContent = 'READY';
    updateTimerDisplay();
    updateFloatingPillVisibility();
  }

  function completeTimer() {
    stopTimer();
    timerStatus.textContent = 'READY TO LIFT!';
    timerStatus.style.color = 'var(--accent-emerald)';
    btnTimerStart.textContent = 'スタート';
    playBeepSound();

    if ('vibrate' in navigator) {
      navigator.vibrate([200, 100, 200, 100, 400]);
    }
  }

  function updateTimerDisplay() {
    const mins = Math.floor(timerRemaining / 60);
    const secs = timerRemaining % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    timerDigits.textContent = formatted;
    floatingTimerSec.textContent = timerRemaining;

    // Progress circle stroke offset
    const fraction = timerRemaining / timerDuration;
    const offset = CIRCLE_CIRCUMFERENCE * (1 - fraction);
    timerProgressCircle.style.strokeDashoffset = offset;
  }

  function updateFloatingPillVisibility() {
    const activeTab = document.querySelector('.tab-pane.active');
    const isTimerTab = activeTab && activeTab.id === 'tab-timer';

    if (isTimerRunning && !isTimerTab) {
      floatingTimerPill.classList.remove('hidden');
    } else {
      floatingTimerPill.classList.add('hidden');
    }
  }

  // Audio tone notification using Web Audio API (no external asset needed)
  function playBeepSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.8);
    } catch (e) {
      console.log('Audio playback prevented or unsupported', e);
    }
  }

  // --- Utility Functions ---
  function getTodayDateKey() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function loadLogs() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function saveLogs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    } catch (e) {
      console.error('Failed to save to localStorage', e);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function (m) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[m];
    });
  }

})();

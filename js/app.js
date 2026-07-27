/**
 * Diner Shift Scheduler — App Controller
 * Wires toolbar, grid, output, and call-out mode.
 */

const App = {
  employees: [],
  timeProfiles: [],
  calloutMode: false,
  calloutTarget: null,
  preCalloutState: null,
  editingEmployeeId: null,

  // ─── Preset Roster ──────────────────────────────────────────────

  ROSTER: [
    { name: 'Manager', nickname: 'Manager', roleCode: 'LP', isChef: false, startSubSlot: 0, endSubSlot: 35, lunchStartSubSlot: 8 },
    { name: 'Rikki J', nickname: 'Rikki', roleCode: 'Ba', isChef: true, startSubSlot: 0, endSubSlot: 35, lunchStartSubSlot: 12 },
    { name: 'Eden O', nickname: 'Eden', roleCode: 'Ba', isChef: true, startSubSlot: 0, endSubSlot: 35, lunchStartSubSlot: 12 },
    { name: 'Antonella F', nickname: 'Ant', roleCode: 'LP', isChef: true, startSubSlot: 0, endSubSlot: 31, lunchStartSubSlot: 12 },
    { name: 'Margarita D', nickname: 'Marc', roleCode: 'LP', isChef: true, startSubSlot: 0, endSubSlot: 35, lunchStartSubSlot: 16 },
    { name: 'Hilary B', nickname: 'Hilary', roleCode: '', isChef: true, startSubSlot: 16, endSubSlot: 43, lunchStartSubSlot: 24 },
    { name: 'Joshua I', nickname: 'Josh', roleCode: '', isChef: true, startSubSlot: 16, endSubSlot: 43, lunchStartSubSlot: 24 },
    { name: 'Londyn M', nickname: 'Maddy', roleCode: '', isChef: true, startSubSlot: 16, endSubSlot: 43, lunchStartSubSlot: 28 },
    { name: 'Madison W', nickname: 'Madi', roleCode: '', isChef: true, startSubSlot: 16, endSubSlot: 43, lunchStartSubSlot: 28 },
    { name: 'Gregory P', nickname: 'Greg', roleCode: '', isChef: true, startSubSlot: 16, endSubSlot: 43, lunchStartSubSlot: 24 },
    { name: 'Maddy A', nickname: 'Maddie', roleCode: '', isChef: true, startSubSlot: 16, endSubSlot: 43, lunchStartSubSlot: 28 },
  ],

  // ─── Init ───────────────────────────────────────────────────────

  init() {
    this._bindToolbar();
    this._bindModals();
    this._bindGridCallbacks();

    // Try loading saved state first (skip if ?fresh param)
    const params = new URLSearchParams(window.location.search);
    if (params.has('fresh')) {
      this.employees = [];
    } else {
      const saved = this._loadFromStorage();
      if (saved) {
        this.employees = saved;
      } else {
        this.employees = [];
      }
    }
    Grid.render(document.getElementById('schedule-grid'), this.employees);
    this._loadProfiles();
  },

  // ─── Persistence ────────────────────────────────────────────────

  _autoSave() {
    // Debounced auto-save — waits 2 seconds after last change
    if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(() => {
      this._saveSilent();
    }, 2000);
  },

  _loadFromStorage() {
    try {
      const raw = localStorage.getItem('diner-scheduler');
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.employees && Array.isArray(data.employees)) {
        return data.employees;
      }
    } catch (e) {
      // Corrupted data — ignore
    }
    return null;
  },

  _saveSilent() {
    try {
      const data = {
        employees: this.employees,
        version: 1,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem('diner-scheduler', JSON.stringify(data));
    } catch (e) {
      // Storage full or unavailable — silently ignore
    }
  },

  // ─── Toolbar ────────────────────────────────────────────────────

  _bindToolbar() {
    document.getElementById('btn-add-employee').addEventListener('click', () => this._openEmployeeModal(null));
    document.getElementById('btn-roster').addEventListener('click', () => this._openRosterModal());
    document.getElementById('btn-callout-mode').addEventListener('click', () => this._toggleCallout());
    document.getElementById('btn-validate').addEventListener('click', () => this._validate());
    document.getElementById('btn-show-list').addEventListener('click', () => this._toggleList());
    document.getElementById('btn-save').addEventListener('click', () => this._save());
    document.getElementById('btn-load').addEventListener('click', () => this._load());
    document.getElementById('btn-import').addEventListener('click', () => this._importCSV());
    document.getElementById('btn-export').addEventListener('click', () => this._exportCSV());
    document.getElementById('btn-copy-list').addEventListener('click', () => this._copyListToClipboard());
    document.getElementById('btn-reset').addEventListener('click', () => this._reset());
    document.getElementById('btn-auto-assign').addEventListener('click', () => this._autoAssign());
    document.getElementById('btn-print').addEventListener('click', () => window.print());
  },

  // ─── Modals ─────────────────────────────────────────────────────

  _bindModals() {
    document.getElementById('btn-modal-save').addEventListener('click', () => this._saveEmployee());
    document.getElementById('btn-modal-delete').addEventListener('click', () => this._deleteEmployee());
    document.getElementById('btn-modal-cancel').addEventListener('click', () => this._closeModal());

    // Roster modal
    document.getElementById('btn-roster-add').addEventListener('click', () => this._addRosterChecked());
    document.getElementById('btn-roster-cancel').addEventListener('click', () => this._closeRosterModal());

    // Callout accept/undo
    document.getElementById('btn-accept-callout').addEventListener('click', () => this._acceptCallout());
    document.getElementById('btn-undo-callout').addEventListener('click', () => this._undoCallout());

    // Time profile panel
    document.getElementById('btn-toggle-profiles').addEventListener('click', () => this._toggleProfilePanel());
    document.getElementById('btn-save-profile').addEventListener('click', () => this._saveTimeProfile());
  },

  // ─── Grid Callbacks ─────────────────────────────────────────────

  _bindGridCallbacks() {
    Grid.onCellClick = (empId, subSlot) => this._handleCellClick(empId, subSlot);
    Grid.onNameClick = (empId) => this._handleNameClick(empId);
  },

  _handleCellClick(empId, subSlot) {
    if (this.calloutMode) return;

    const emp = this.employees.find(e => e.id === empId);
    if (!emp) return;

    const role = getRole(emp, subSlot);
    if (role === null) return; // off-shift

    // Lunch is static — only changeable via employee edit, not by tapping
    if (role === 'L') return;

    // Click-to-cycle: HST → SRV → CK → BK → L → HST
    const next = ROLE_CYCLE_ORDER[(ROLE_CYCLE_ORDER.indexOf(role) + 1) % ROLE_CYCLE_ORDER.length];

    // Handle multi-slot fills
    if (next === 'CK') {
      // Auto-fill: CK normally covers 2 sub-slots (30 min).
      // But DON'T overwrite a break or lunch in the next slot.
      if (subSlot + 1 <= emp.endSubSlot) {
        var nextRole = getRole(emp, subSlot + 1);
        var nextIsProtected = nextRole === 'BK' || nextRole === 'L';
        if (nextRole !== null && !nextIsProtected) {
          emp.schedule[subSlot] = 'CK';
          emp.schedule[subSlot + 1] = 'CK';
        } else {
          // Next slot is off-shift, break, or lunch — only set this one
          emp.schedule[subSlot] = 'CK';
        }
      } else {
        // Not enough room — just set this one
        emp.schedule[subSlot] = 'CK';
      }
    } else {
      emp.schedule[subSlot] = next;
    }

    // Clear errors and re-validate
    this._clearErrors();
    Grid.render(document.getElementById('schedule-grid'), this.employees);
    this._updateOutput();
    this._autoSave();
  },

  _handleNameClick(empId) {
    const emp = this.employees.find(e => e.id === empId);
    if (!emp) return;

    if (this.calloutMode) {
      // In callout mode: mark/unmark absent
      this._toggleCalloutEmployee(emp);
    } else {
      // Normal mode: edit employee
      this._openEmployeeModal(emp);
    }
  },

  // ─── Employee Management ────────────────────────────────────────

  _openEmployeeModal(emp) {
    const modal = document.getElementById('employee-modal');
    const title = document.getElementById('modal-title');

    if (emp) {
      title.textContent = 'Edit Employee';
      document.getElementById('emp-name').value = emp.name;
      document.getElementById('emp-nickname').value = emp.nickname;
      document.getElementById('emp-role').value = emp.roleCode || '';
      document.getElementById('emp-start-hour').value = emp.startSubSlot;
      document.getElementById('emp-end-hour').value = emp.endSubSlot;
      document.getElementById('emp-lunch-hour').value = emp.lunchStartSubSlot !== null && emp.lunchStartSubSlot !== undefined ? emp.lunchStartSubSlot : '';
      document.getElementById('emp-can-cook').checked = emp.isChef !== false; // default true
      document.getElementById('btn-modal-delete').style.display = '';
      this.editingEmployeeId = emp.id;
    } else {
      title.textContent = 'Add Employee';
      document.getElementById('emp-name').value = '';
      document.getElementById('emp-nickname').value = '';
      document.getElementById('emp-role').value = '';
      document.getElementById('emp-start-hour').value = 0;
      document.getElementById('emp-end-hour').value = TOTAL_SUB_SLOTS - 1;
      document.getElementById('emp-lunch-hour').value = '';
      document.getElementById('emp-can-cook').checked = true;
      document.getElementById('btn-modal-delete').style.display = 'none';
      this.editingEmployeeId = null;
    }

    modal.classList.remove('hidden');
    document.getElementById('emp-name').focus();
  },

  _closeModal() {
    document.getElementById('employee-modal').classList.add('hidden');
    this.editingEmployeeId = null;
  },

  _deleteEmployee() {
    if (!this.editingEmployeeId) return;
    var emp = this.employees.find(e => e.id === this.editingEmployeeId);
    if (!emp) return;
    if (!confirm('Delete ' + (emp.name || emp.nickname) + '? This cannot be undone.')) return;
    this.employees = this.employees.filter(function(e) { return e.id !== emp.id; });
    this._closeModal();
    this._clearErrors();
    Grid.render(document.getElementById('schedule-grid'), this.employees);
    this._updateOutput();
  },

  _saveEmployee() {
    const name = document.getElementById('emp-name').value.trim();
    const nickname = document.getElementById('emp-nickname').value.trim();
    const roleCode = document.getElementById('emp-role').value.trim();
    const startSubSlot = parseInt(document.getElementById('emp-start-hour').value);
    const endSubSlot = parseInt(document.getElementById('emp-end-hour').value);
    const lunchVal = document.getElementById('emp-lunch-hour').value;
    const lunchStartSubSlot = lunchVal !== '' ? parseInt(lunchVal) : undefined;

    if (!name || !nickname) return;

    // Check for duplicate full name (case-insensitive)
    const nameLower = name.toLowerCase();
    const duplicate = this.employees.find(function(e) {
      return e.name.toLowerCase() === nameLower && e.id !== this.editingEmployeeId;
    }.bind(this));
    if (duplicate) {
      alert('An employee named "' + name + '" already exists. Full names must be unique.');
      return;
    }

    if (this.editingEmployeeId) {
      const emp = this.employees.find(e => e.id === this.editingEmployeeId);
      if (emp) {
        emp.name = name;
        emp.nickname = nickname;
        emp.roleCode = roleCode;
        emp.isChef = document.getElementById('emp-can-cook').checked;
        emp.startSubSlot = startSubSlot;
        emp.endSubSlot = endSubSlot;
        emp.lunchStartSubSlot = lunchStartSubSlot;
        // Truncate schedule to new range
        emp.schedule = emp.schedule.map((role, i) =>
          i >= startSubSlot && i <= endSubSlot ? role : null
        );
        // Default new range to HST
        for (let i = startSubSlot; i <= endSubSlot; i++) {
          if (emp.schedule[i] === null) emp.schedule[i] = 'HST';
        }
      }
    } else {
      const isChef = document.getElementById('emp-can-cook').checked;
      const emp = createEmployee(name, nickname, roleCode, startSubSlot, endSubSlot, isChef, lunchStartSubSlot);
      this.employees.push(emp);
    }

    this._closeModal();
    this._clearErrors();
    Grid.render(document.getElementById('schedule-grid'), this.employees);
    this._updateOutput();
  },

  // ─── Roster Quick-Add ────────────────────────────────────────────

  _openRosterModal() {
    const list = document.getElementById('roster-list');
    list.innerHTML = '';

    const existingNames = new Set(this.employees.map(function(e) { return e.name; }));

    this.ROSTER.forEach(function(emp) {
      const exists = existingNames.has(emp.name);
      const div = document.createElement('div');
      div.className = 'roster-item' + (exists ? '' : '');
      div.innerHTML =
        '<input type="checkbox"' + (exists ? ' disabled' : '') + '>' +
        '<span class="ri-name">' + emp.nickname + '</span>' +
        '<span class="ri-detail">' + emp.name + ' · ' +
        Engine.subSlotToSimpleTime(emp.startSubSlot) + '–' + Engine.subSlotToSimpleTime(emp.endSubSlot) +
        (emp.isChef ? ' · 🧑‍🍳' : '') + (emp.roleCode ? ' · ' + emp.roleCode : '') +
        (exists ? ' · ✅ Already added' : '') +
        '</span>';

      div.addEventListener('click', function(e) {
        if (exists) return;
        // Don't double-toggle — if user clicked the checkbox itself, native behavior handles it
        if (e.target.tagName === 'INPUT') return;
        const cb = div.querySelector('input[type="checkbox"]');
        cb.checked = !cb.checked;
        div.classList.toggle('selected', cb.checked);
      });

      list.appendChild(div);
    });

    document.getElementById('roster-modal').classList.remove('hidden');
  },

  _addRosterChecked() {
    const self = this;
    const checks = document.querySelectorAll('#roster-list input[type="checkbox"]:checked:not([disabled])');
    var added = 0;

    checks.forEach(function(cb) {
      const item = cb.closest('.roster-item');
      const nickname = item.querySelector('.ri-name').textContent;
      const preset = self.ROSTER.find(function(r) { return r.nickname === nickname; });
      if (!preset) return;
      // Check not already in list (belt-and-suspenders)
      if (self.employees.some(function(e) { return e.name === preset.name; })) return;

      const emp = createEmployee(
        preset.name, preset.nickname, preset.roleCode,
        preset.startSubSlot, preset.endSubSlot,
        preset.isChef, preset.lunchStartSubSlot
      );
      self.employees.push(emp);
      added++;
    });

    document.getElementById('roster-modal').classList.add('hidden');
    if (added > 0) {
      this._clearErrors();
      Grid.render(document.getElementById('schedule-grid'), this.employees);
      this._updateOutput();
    }
  },

  _closeRosterModal() {
    document.getElementById('roster-modal').classList.add('hidden');
  },

  // ─── Callout Mode ───────────────────────────────────────────────

  _toggleCallout() {
    this.calloutMode = !this.calloutMode;
    const btn = document.getElementById('btn-callout-mode');
    const logPanel = document.getElementById('callout-log-panel');

    if (this.calloutMode) {
      btn.classList.add('active');
      btn.textContent = '📞 Exit Call-Out';
      document.body.classList.add('callout-mode');
    } else {
      btn.classList.remove('active');
      btn.textContent = '📞 Call-Out';
      document.body.classList.remove('callout-mode');
      logPanel.classList.add('hidden');
      this.calloutTarget = null;
      this.preCalloutState = null;
    }
  },

  // ─── Helpers ────────────────────────────────────────────────────

  _deepCloneEmployees(emps) {
    return emps.map(e => ({
      ...e,
      schedule: [...e.schedule]
    }));
  },

  _toggleCalloutEmployee(emp) {
    emp.calledOut = !emp.calledOut;

    if (emp.calledOut) {
      // Save pre-callout state
      this.preCalloutState = this._deepCloneEmployees(this.employees);

      // Redistribute CK blocks using full handleCallOut (uncovered tracking + CK counts)
      const result = Engine.handleCallOut(this.employees, emp.id);
      this.employees = result.employees;
      this._showCalloutLog_v2(result, emp);
    } else {
      // Undo callout
      if (this.preCalloutState) {
        this.employees = this.preCalloutState;
        this.preCalloutState = null;
      }
      this._hideCalloutLog();
    }

    this._clearErrors();
    Grid.render(document.getElementById('schedule-grid'), this.employees);
    this._updateOutput();
    this._autoSave();
  },

  _showCalloutLog_v2(result, emp) {
    const panel = document.getElementById('callout-log-panel');
    const log = document.getElementById('callout-log');

    log.textContent = result.log.join('\n');
    panel.classList.remove('hidden');
  },

  _showCalloutLog(result, emp) {
    const panel = document.getElementById('callout-log-panel');
    const log = document.getElementById('callout-log');

    let text = `${emp.nickname} called out. CK blocks redistributed:\n\n`;
    for (const change of result.changes) {
      text += `• ${change.employee.nickname}: added CK at ${change.subSlotRange} (now ${change.newCKCount}/30min blocks)\n`;
    }
    if (result.changes.length === 0) {
      text += '(No CK blocks to redistribute — or no one else was on shift.)\n';
    }
    if (result.uncovered && result.uncovered.length > 0) {
      text += '\n⚠️ Uncovered CK blocks:\n';
      for (const uc of result.uncovered) {
        text += `• ${uc.subSlotRange} — no eligible replacement\n`;
      }
    }

    log.textContent = text;
    panel.classList.remove('hidden');
  },

  _hideCalloutLog() {
    document.getElementById('callout-log-panel').classList.add('hidden');
  },

  _acceptCallout() {
    this.preCalloutState = null;
    this._hideCalloutLog();
    this._clearErrors();
    Grid.render(document.getElementById('schedule-grid'), this.employees);
    this._updateOutput();
  },

  _undoCallout() {
    if (this.preCalloutState) {
      this.employees = this.preCalloutState;
      this.preCalloutState = null;
    }
    // Unmark all callouts
    for (const emp of this.employees) emp.calledOut = false;
    this._hideCalloutLog();
    this._clearErrors();
    Grid.render(document.getElementById('schedule-grid'), this.employees);
    this._updateOutput();
  },

  // ─── Validation ─────────────────────────────────────────────────

  _validate() {
    const errors = validateAll(this.employees);
    Grid.highlightErrors(errors);
    this._showErrors(errors);
  },

  _showErrors(errors) {
    const panel = document.getElementById('errors-panel');
    const list = document.getElementById('errors-list');

    if (errors.length === 0) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    list.innerHTML = '';

    for (const err of errors) {
      const li = document.createElement('li');
      li.className = err.severity === 'warning' ? 'warning' : '';
      const time = subSlotToClockTime(err.subSlot);
      li.textContent = `${err.employee.nickname} @ ${time}: ${err.message}`;
      list.appendChild(li);
    }
  },

  _clearErrors() {
    document.getElementById('errors-panel').classList.add('hidden');
    document.getElementById('errors-list').innerHTML = '';
    Grid.errorSubSlots.clear();
  },

  // ─── Output ─────────────────────────────────────────────────────

  _updateOutput() {
    const isVisible = !document.getElementById('list-panel').classList.contains('hidden');
    if (isVisible) {
      Output.render(this.employees);
    }
  },

  _toggleList() {
    const panel = document.getElementById('list-panel');
    const errorsPanel = document.getElementById('errors-panel');
    const btn = document.getElementById('btn-show-list');

    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      btn.classList.add('active');
      errorsPanel.classList.add('hidden');
      Output.render(this.employees);
    } else {
      btn.classList.remove('active');
    }
  },

  _copyListToClipboard() {
    // Collect all rows from the three sections, find the max name width,
    // and pad with spaces for clean alignment (tabs are unreliable —
    // they jump to tab stops, not to a fixed position).

    function collectRows(containerId) {
      var container = document.getElementById(containerId);
      if (!container) return [];
      var rows = container.querySelectorAll('.cook-row, .lunch-row, .break-row');
      var result = [];
      for (var i = 0; i < rows.length; i++) {
        var n = rows[i].querySelector('.name');
        var name = n ? n.textContent.trim() : '';
        var t = rows[i].querySelector('.time, .times');
        var time = t ? t.textContent.trim() : '';
        if (name) result.push({ name: name, time: time });
      }
      return result;
    }

    var cookRows = collectRows('cook-list');
    var lunchRows = collectRows('lunch-list');
    var breakRows = collectRows('break-list');

    // Find the longest name across all sections
    var maxLen = 0;
    var allRows = cookRows.concat(lunchRows).concat(breakRows);
    for (var i = 0; i < allRows.length; i++) {
      if (allRows[i].name.length > maxLen) maxLen = allRows[i].name.length;
    }

    // Proportional fonts (like your note app) render 'i' narrower than 'M'.
    // Tabs jump to pixel-based stops that shift unpredictably with different
    // letter widths. Space characters have a consistent width in all fonts,
    // so we pad every name to the same length with spaces, then add one tab
    // for visual separation.
    var padWidth = maxLen + 4;  // longest name + 4-space buffer

    function padName(name) {
      var s = name;
      while (s.length < padWidth) s += ' ';
      return s + '\t';  // spaces for alignment, one tab for consistent gap
    }

    function buildSection(heading, rows) {
      if (rows.length === 0) return '';
      var text = heading + '\n';
      for (var i = 0; i < rows.length; i++) {
        text += padName(rows[i].name) + rows[i].time + '\n';
      }
      return text;
    }

    var cookText = buildSection('===== COOK =====', cookRows);
    var lunchText = buildSection('===== LUNCH =====', lunchRows);
    var breakText = buildSection('===== 15s =====', breakRows);

    var fullText = (cookText + '\n' + lunchText + '\n' + breakText).trim();

    if (!fullText) {
      alert('No list content to copy. Add employees and build a schedule first.');
      return;
    }

    var btn = document.getElementById('btn-copy-list');

    // Create a visible textarea — iOS requires selected text to be in viewport
    var textarea = document.createElement('textarea');
    textarea.value = fullText;
    textarea.readOnly = true;
    textarea.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);' +
      'width:90%;max-width:400px;height:120px;font-size:12px;padding:8px;' +
      'border:2px solid #4a6cf7;border-radius:4px;z-index:99999;opacity:0.01;' +
      'pointer-events:none';
    document.body.appendChild(textarea);

    // Select and copy
    textarea.select();
    textarea.setSelectionRange(0, 99999);

    var copied = false;
    try {
      // Modern Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fullText).then(function() {
          copied = true;
          done();
        }).catch(function() {
          fallbackExec();
        });
      } else {
        fallbackExec();
      }
    } catch (e) {
      fallbackExec();
    }

    function fallbackExec() {
      try {
        document.execCommand('copy');
        copied = true;
      } catch (e) {}
      done();
    }

    function done() {
      document.body.removeChild(textarea);
      if (copied) {
        btn.textContent = '✓ Copied!';
        setTimeout(function() { btn.textContent = '📋 Copy'; }, 2000);
      } else {
        // Last resort: show the text for manual copy
        textarea.style.opacity = '1';
        textarea.style.pointerEvents = 'auto';
        textarea.readOnly = false;
        document.body.appendChild(textarea);
        textarea.select();
        setTimeout(function() {
          if (textarea.parentNode) document.body.removeChild(textarea);
        }, 10000);
      }
    }
  },

  // ─── Persistence ────────────────────────────────────────────────

  _save() {
    try {
      const data = {
        employees: this.employees,
        version: 1,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem('diner-scheduler', JSON.stringify(data));
      alert('Schedule saved to browser storage.');
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  },

  _load() {
    try {
      const raw = localStorage.getItem('diner-scheduler');
      if (!raw) { alert('No saved schedule found.'); return; }

      const data = JSON.parse(raw);
      if (data.employees && Array.isArray(data.employees)) {
        this.employees = data.employees;
        this._clearErrors();
        Grid.refresh();
        this._updateOutput();
      }
    } catch (e) {
      alert('Load failed: ' + e.message);
    }
  },

  _reset() {
    if (!confirm('Reset all shift times and schedules? Employee names and records will be preserved.')) return;
    this.employees.forEach(function(emp) {
      emp.startSubSlot = undefined;
      emp.endSubSlot = undefined;
      emp.schedule = new Array(TOTAL_SUB_SLOTS).fill(null);
    });
    this._clearErrors();
    Grid.render(document.getElementById('schedule-grid'), this.employees);
    document.getElementById('cook-list').innerHTML = '';
    document.getElementById('lunch-list').innerHTML = '';
    document.getElementById('break-list').innerHTML = '';
  },

  // ─── CSV Import / Export ─────────────────────────────────────────

  /**
   * Convert subSlot index to an export-friendly clock time like "10:00 AM".
   * Uses engine.js helpers which are globally available.
   */
  _subSlotToTime(idx) {
    if (idx === undefined || idx === null || idx === '') return '';
    return subSlotToClockTime(idx);
  },

  /**
   * Parse a clock time string like "10:00 AM" or "2:30 PM" back to a subSlot index.
   * Returns -1 on parse failure.
   */
  _timeToSubSlot(timeStr) {
    if (!timeStr || !timeStr.trim()) return -1;
    timeStr = timeStr.trim().toUpperCase();
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (!match) return -1;

    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const ampm = match[3];

    if (hour === 12 && ampm === 'AM') hour = 0;
    else if (hour !== 12 && ampm === 'PM') hour += 12;

    // Convert to minutes from midnight
    const totalMinutes = hour * 60 + minute;

    // Base offset: 10:00 AM = subSlot 0 = 600 minutes from midnight
    const baseMinutes = 10 * 60; // 10:00 AM
    const offset = totalMinutes - baseMinutes;

    if (offset < 0) return 0;
    const subSlot = Math.round(offset / 15);
    return Math.min(subSlot, TOTAL_SUB_SLOTS - 1);
  },

  _exportCSV() {
    if (this.employees.length === 0) {
      alert('No employees to export. Add some employees first.');
      return;
    }

    // CSV header
    const headers = ['Full Name', 'Nickname', 'Role', 'Shift Start', 'Shift End', 'Lunch Start', 'Can Cook'];
    let csv = headers.join(',') + '\n';

    // One row per employee
    for (const emp of this.employees) {
      const row = [
        this._csvEscape(emp.name),
        this._csvEscape(emp.nickname),
        emp.roleCode || '',
        this._subSlotToTime(emp.startSubSlot),
        this._subSlotToTime(emp.endSubSlot),
        emp.lunchStartSubSlot !== undefined && emp.lunchStartSubSlot !== null
          ? this._subSlotToTime(emp.lunchStartSubSlot) : '',
        emp.isChef !== false ? 'Yes' : 'No',
      ];
      csv += row.join(',') + '\n';
    }

    // Trigger download — use data URI approach (most reliable on mobile)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const reader = new FileReader();
    const self = this;
    reader.onload = function() {
      // Try anchor click first
      const anchor = document.getElementById('export-anchor');
      anchor.href = reader.result;
      anchor.click();

      // Fallback: if anchor click didn't trigger, navigate to data URI
      // (mobile browsers will offer to download)
      setTimeout(function() {
        // No reliable way to detect success — the setTimeout fallback
        // ensures at least something happens on strict browsers
      }, 500);
    };
    reader.readAsDataURL(blob);

    console.log('Exported ' + this.employees.length + ' employees to CSV.');
  },

  _importCSV() {
    // Create file input in the viewport (iOS Safari requires it to be in-bounds).
    // Use opacity:0 + tiny size rather than off-screen positioning.
    var self = this;
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv,text/plain,application/csv';
    input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;z-index:99999';
    document.body.appendChild(input);

    input.addEventListener('change', function(e) {
      self._handleImportFile(e);
      // Clean up
      setTimeout(function() {
        if (input.parentNode) input.parentNode.removeChild(input);
      }, 500);
    });

    // Trigger immediately while still in the user's click event chain
    input.click();
  },

  _handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const result = this._parseCSV(text);

      if (result.newCount + result.updateCount > 0) {
        this._clearErrors();
        Grid.render(document.getElementById('schedule-grid'), this.employees);
        this._updateOutput();
        this._autoSave();
        var msg = '';
        if (result.newCount > 0) msg += result.newCount + ' added. ';
        if (result.updateCount > 0) msg += result.updateCount + ' updated. ';
        if (result.errors.length > 0) msg += '\nErrors:\n' + result.errors.join('\n');
        alert(msg.trim() + '\nTotal on schedule: ' + this.employees.length);
      } else if (result.errors.length > 0) {
        alert('Errors:\n' + result.errors.join('\n'));
      } else {
        alert('Nothing to import.');
      }
    };
    reader.readAsText(file);

    // Reset the file input so the same file can be re-imported
    event.target.value = '';
  },

  _parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    var newCount = 0;
    var updateCount = 0;
    const errors = [];

    if (lines.length < 2) {
      errors.push('CSV file is empty or has no data rows.');
      return { newCount: 0, updateCount: 0, errors };
    }

    // Parse header
    const header = this._parseCSVLine(lines[0]);
    const colMap = {};
    for (let i = 0; i < header.length; i++) {
      colMap[header[i].toLowerCase().trim()] = i;
    }

    // Check required columns
    const required = ['full name', 'nickname'];
    for (const col of required) {
      if (!(col in colMap)) {
        errors.push('Missing required column: "' + col + '". Expected columns: Full Name, Nickname, Role, Shift Start, Shift End, Lunch Start, Can Cook');
        return { newCount: 0, updateCount: 0, errors };
      }
    }

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const row = this._parseCSVLine(lines[i]);
      if (row.length === 0) continue;

      const name = (row[colMap['full name']] || '').trim();
      const nickname = (row[colMap['nickname']] || '').trim();

      if (!name || !nickname) {
        errors.push('Row ' + (i + 1) + ': missing name or nickname — skipped.');
        continue;
      }

      const roleCode = colMap['role'] !== undefined ? (row[colMap['role']] || '').trim() : '';
      const shiftStartStr = colMap['shift start'] !== undefined ? (row[colMap['shift start']] || '').trim() : '';
      const shiftEndStr = colMap['shift end'] !== undefined ? (row[colMap['shift end']] || '').trim() : '';
      const lunchStartStr = colMap['lunch start'] !== undefined ? (row[colMap['lunch start']] || '').trim() : '';
      const canCookStr = colMap['can cook'] !== undefined ? (row[colMap['can cook']] || '').trim() : 'Yes';

      const startSubSlot = shiftStartStr ? this._timeToSubSlot(shiftStartStr) : 0;
      const endSubSlot = shiftEndStr ? this._timeToSubSlot(shiftEndStr) : (TOTAL_SUB_SLOTS - 1);
      const lunchStartSubSlot = lunchStartStr ? this._timeToSubSlot(lunchStartStr) : undefined;
      const isChef = canCookStr.toLowerCase() !== 'no' && canCookStr !== '0' && canCookStr.toLowerCase() !== 'false';

      if (shiftStartStr && startSubSlot < 0) {
        errors.push('Row ' + (i + 1) + ' (' + nickname + '): could not parse Shift Start "' + shiftStartStr + '" — using default.');
      }
      if (shiftEndStr && endSubSlot < 0) {
        errors.push('Row ' + (i + 1) + ' (' + nickname + '): could not parse Shift End "' + shiftEndStr + '" — using default.');
      }
      if (lunchStartStr && lunchStartSubSlot < 0) {
        errors.push('Row ' + (i + 1) + ' (' + nickname + '): could not parse Lunch Start "' + lunchStartStr + '" — skipped lunch.');
      }

      // Check for existing employee by full name (case-insensitive)
      const nameLower = name.toLowerCase();
      const existing = this.employees.find(function(e) {
        return e.name.toLowerCase() === nameLower;
      });

      if (existing) {
        // Update existing employee's schedule times only
        existing.nickname = nickname;
        existing.roleCode = roleCode || existing.roleCode;
        existing.isChef = isChef;
        existing.startSubSlot = startSubSlot;
        existing.endSubSlot = endSubSlot;
        existing.lunchStartSubSlot = lunchStartSubSlot >= 0 ? lunchStartSubSlot : undefined;
        // Truncate schedule to new range
        existing.schedule = existing.schedule.map(function(role, i) {
          return i >= startSubSlot && i <= endSubSlot ? role : null;
        });
        // Default new range to HST
        for (var si = startSubSlot; si <= endSubSlot; si++) {
          if (existing.schedule[si] === null) existing.schedule[si] = 'HST';
        }
        updateCount++;
      } else {
        const emp = createEmployee(name, nickname, roleCode, startSubSlot, endSubSlot, isChef,
          lunchStartSubSlot >= 0 ? lunchStartSubSlot : undefined);
        this.employees.push(emp);
        newCount++;
      }
    }

    return { newCount: newCount, updateCount: updateCount, errors };
  },

  /**
   * Parse a single CSV line, respecting quoted fields.
   */
  _parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  },

  /**
   * Escape a value for CSV output — wrap in quotes if it contains commas or quotes.
   */
  _csvEscape(val) {
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  },

  // ─── Time Profiles ────────────────────────────────────────────────

  _loadProfiles() {
    try {
      const raw = localStorage.getItem('diner-time-profiles');
      if (raw) {
        this.timeProfiles = JSON.parse(raw);
      } else {
        // Seed default profiles on first use
        this.timeProfiles = [
          { name: 'Opening (10:00–6:30)', startSubSlot: 0, endSubSlot: 33, lunchStartSubSlot: 12 },
          { name: 'Mid-Morning (10:00–5:00)', startSubSlot: 0, endSubSlot: 27, lunchStartSubSlot: 12 },
          { name: 'Lunch (11:30–7:30)', startSubSlot: 6, endSubSlot: 39, lunchStartSubSlot: 24 },
          { name: 'Afternoon (12:30–8:30)', startSubSlot: 10, endSubSlot: 41, lunchStartSubSlot: 20 },
          { name: 'Late (1:30–8:45)', startSubSlot: 14, endSubSlot: 43, lunchStartSubSlot: 24 },
          { name: 'Closer (4:00–8:45)', startSubSlot: 24, endSubSlot: 43, lunchStartSubSlot: 28 },
        ];
        this._saveProfiles();
      }
    } catch (e) {
      this.timeProfiles = [];
    }
  },

  _saveProfiles() {
    try {
      localStorage.setItem('diner-time-profiles', JSON.stringify(this.timeProfiles));
    } catch (e) {}
  },

  _toggleProfilePanel() {
    const panel = document.getElementById('time-profile-panel');
    const btn = document.getElementById('btn-toggle-profiles');
    const isHidden = panel.classList.contains('hidden');

    if (isHidden) {
      panel.classList.remove('hidden');
      btn.textContent = '⏱ Time Profiles ▴';
      this._renderProfileList();
    } else {
      panel.classList.add('hidden');
      btn.textContent = '⏱ Time Profiles ▾';
    }
    // Clear any previous message
    const msg = document.getElementById('profile-save-msg');
    msg.classList.add('hidden');
    msg.textContent = '';
  },

  _renderProfileList() {
    const list = document.getElementById('profile-list');
    list.innerHTML = '';

    if (this.timeProfiles.length === 0) {
      list.innerHTML = '<div class="profile-empty">No time profiles yet. Save one below.</div>';
      return;
    }

    const self = this;
    this.timeProfiles.forEach(function(profile, idx) {
      const item = document.createElement('div');
      item.className = 'profile-item';

      const nameEl = document.createElement('span');
      nameEl.className = 'profile-item-name';
      nameEl.textContent = profile.name;

      const timesEl = document.createElement('span');
      timesEl.className = 'profile-item-times';
      timesEl.textContent = self._subSlotToTime(profile.startSubSlot) + '–' +
        self._subSlotToTime(profile.endSubSlot) +
        (profile.lunchStartSubSlot !== undefined ? ' · L ' + self._subSlotToTime(profile.lunchStartSubSlot) : '');

      const delBtn = document.createElement('button');
      delBtn.className = 'profile-item-del';
      delBtn.textContent = '×';
      delBtn.title = 'Delete profile';
      delBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (confirm('Delete profile "' + profile.name + '"?')) {
          self.timeProfiles.splice(idx, 1);
          self._saveProfiles();
          self._renderProfileList();
        }
      });

      item.appendChild(nameEl);
      item.appendChild(timesEl);
      item.appendChild(delBtn);

      // Click on the item body applies the profile
      item.addEventListener('click', function() {
        self._applyProfile(profile);
        // Close the panel after selection
        document.getElementById('time-profile-panel').classList.add('hidden');
        document.getElementById('btn-toggle-profiles').textContent = '⏱ Time Profiles ▾';
      });

      list.appendChild(item);
    });
  },

  _applyProfile(profile) {
    document.getElementById('emp-start-hour').value = profile.startSubSlot;
    document.getElementById('emp-end-hour').value = profile.endSubSlot;
    if (profile.lunchStartSubSlot !== undefined) {
      document.getElementById('emp-lunch-hour').value = profile.lunchStartSubSlot;
    }
  },

  _saveTimeProfile() {
    const nameInput = document.getElementById('profile-save-name');
    const name = nameInput.value.trim();
    const msg = document.getElementById('profile-save-msg');

    if (!name) {
      msg.textContent = 'Please enter a name for the profile.';
      msg.className = 'profile-msg error';
      msg.classList.remove('hidden');
      return;
    }

    // Check for duplicate name
    const exists = this.timeProfiles.some(function(p) {
      return p.name.toLowerCase() === name.toLowerCase();
    });
    if (exists) {
      msg.textContent = 'A profile with this name already exists.';
      msg.className = 'profile-msg error';
      msg.classList.remove('hidden');
      return;
    }

    const startSubSlot = parseInt(document.getElementById('emp-start-hour').value) || 0;
    const endSubSlot = parseInt(document.getElementById('emp-end-hour').value) || (TOTAL_SUB_SLOTS - 1);
    const lunchVal = document.getElementById('emp-lunch-hour').value;
    const lunchStartSubSlot = lunchVal !== '' ? parseInt(lunchVal) : undefined;

    this.timeProfiles.push({
      name: name,
      startSubSlot: startSubSlot,
      endSubSlot: endSubSlot,
      lunchStartSubSlot: lunchStartSubSlot,
    });

    this._saveProfiles();
    this._renderProfileList();

    nameInput.value = '';
    msg.textContent = '✓ Profile "' + name + '" saved!';
    msg.className = 'profile-msg success';
    msg.classList.remove('hidden');

    // Auto-hide the message after 3 seconds
    setTimeout(function() {
      msg.classList.add('hidden');
    }, 3000);
  },

  // ─── Auto-Assign ─────────────────────────────────────────────────

  _autoAssign() {
    if (!confirm('Auto-assign will replace the current schedule. Continue?')) return;

    var result = AutoEngine.generate(this.employees);

    var errorList = document.getElementById('errors-list');
    errorList.innerHTML = '';

    // Show errors
    if (result.errors.length > 0) {
      result.errors.forEach(function(e) {
        var li = document.createElement('li');
        li.textContent = e;
        li.style.color = '#cc0000';
        errorList.appendChild(li);
      });
      document.getElementById('errors-panel').classList.remove('hidden');
    }

    // Show warnings
    if (result.warnings.length > 0) {
      result.warnings.forEach(function(w) {
        var li = document.createElement('li');
        li.textContent = w;
        li.style.color = w.indexOf('RED FLAG') !== -1 ? '#cc0000' : '#cc8800';
        errorList.appendChild(li);
      });
      document.getElementById('errors-panel').classList.remove('hidden');
    }

    // Apply results (even with warnings — only skip if truly blocked, e.g. no chefs)
    if (result.success || result.errors.length === 0) {
      this.employees = result.employees;
      Grid.render(document.getElementById('schedule-grid'), this.employees);
      this._updateOutput();
      this._autoSave();
    }

    // Log to console for debugging
    console.log('Auto-assign log:', result.log);
    if (result.warnings.length > 0) console.warn('Auto-assign warnings:', result.warnings);
    if (result.errors.length > 0) console.error('Auto-assign errors:', result.errors);
  },

  // ─── Demo Data ──────────────────────────────────────────────────

  loadDemoData() {
    // ─── Employees from the real schedule ───
    // Shifts mapped to sub-slots: 10AM=0, each hour=4 sub-slots, ends 8:45PM=43
    this.employees = [
      createEmployee('Antonella F', 'Ant',  'LP', 0, 33),   // 10:00-6:30
      createEmployee('Rikki J',     'Rikki','Ba', 0, 27),   // 10:00-5:00
      createEmployee('Margarita D', 'Marg', 'LP', 0, 33),   // 10:00-6:30
      createEmployee('Hilary B',    'Hilary','',  6, 39),   // 11:30-7:30
      createEmployee('Joshua I',    'Josh',  '',  10, 41),  // 12:30-8:30
      createEmployee('Madison W',   'Madi',  '',  14, 43),  // 1:30-8:45
      createEmployee('Gregory P',   'Greg',  '',  14, 43),  // 1:30-8:45
      createEmployee('Maddy A',     'Maddy', '',  18, 43),  // 2:30-8:45
      createEmployee('Londyn M',    'Madeline','',14, 43),  // 1:30-8:45
      createEmployee('Bibi',        'Bibi',  '',   0, 7),   // 10:00-12:00 lunch only
    ];

    // Helper: set SRV then CK (CK=2 sub-slots, SRV=1-2 before it)
    const setCK = (nick, ckStart) => {
      if (ckStart > 0) this._setBlock(nick, 'SRV', ckStart - 1, ckStart + 1); // 2 SRV before CK
      this._setBlock(nick, 'CK', ckStart, ckStart + 2);
    };

    //Helper: set BK (1 sub-slot)
    const setBK = (nick, bkSlot) => {
      this._setBlock(nick, 'BK', bkSlot, bkSlot + 1);
    };

    // Helper: set Lunch (4 sub-slots)
    const setLunch = (nick, lStart) => {
      this._setBlock(nick, 'L', lStart, lStart + 4);
    };

    // ─── Cook assignments from real sticky note ───
    setCK('Ant', 0);     // 10:00-10:30
    setCK('Ant', 4);     // 11:00-11:30
    setCK('Ant', 18);    // 2:30-3:00

    setCK('Rikki', 2);   // 10:30-11:00
    setCK('Rikki', 10);  // 12:30-1:00
    setCK('Rikki', 14);  // 1:30-2:00

    setCK('Marg', 6);    // 11:30-12:00
    setCK('Marg', 12);   // 1:00-1:30
    setLunch('Marg', 16);    // 2:00-3:00 — before CK(20) so SRV at slot 19 overwrites lunch
    setCK('Marg', 20);   // 3:00-3:30

    setCK('Hilary', 8);  // 12:00-12:30
    setCK('Hilary', 24); // 4:00-4:30

    setCK('Greg', 16);   // 2:00-2:30
    setCK('Greg', 34);   // 6:30-7:00
    setCK('Greg', 40);   // 8:00-8:30

    setCK('Madi', 22);   // 3:30-4:00
    setCK('Madi', 30);   // 5:30-6:00
    setCK('Madi', 38);   // 7:30-8:00

    setCK('Josh', 26);   // 4:30-5:00
    setCK('Josh', 32);   // 6:00-6:30

    setCK('Maddy', 36);  // 7:00-7:30
    setCK('Maddy', 42);  // 8:30-9:00

    setCK('Madeline', 28); // 5:00-5:30

    // ─── Breaks (BK) from real sticky note ───
    setBK('Ant', 6);     // 11:30
    setBK('Ant', 22);    // 3:30

    setBK('Rikki', 12);  // 1:00
    setBK('Rikki', 18);  // 2:30

    setBK('Marg', 8);    // 12:00
    setBK('Marg', 26);   // 4:30

    // Hilary and Josh: BK times marked '?' on sticky note — skip

    setBK('Greg', 21);   // 3:15
    setBK('Greg', 36);   // 7:00

    setBK('Madi', 18);   // 2:30
    setBK('Madi', 34);   // 6:30

    setBK('Maddy', 24);  // 4:00
    setBK('Maddy', 38);  // 7:30

    // ─── Lunch assignments from real sticky note ───
    setLunch('Bibi', 4);     // 11:00-12:00
    setLunch('Ant', 12);     // 1:00-2:00
    setLunch('Hilary', 18);  // 2:30-3:30
    setLunch('Josh', 20);    // 3:00-4:00
    setLunch('Madi', 24);    // 4:00-5:00
    setLunch('Greg', 28);    // 5:00-6:00
    setLunch('Maddy', 30);   // 5:30-6:30

    // Fill remaining working hours with HST (done in-place via engine defaults)
    // engine.js defaults HST for unscheduled slots in on-shift range

    Grid.render(document.getElementById('schedule-grid'), this.employees);
    this._updateOutput();
  },

  _setBlock(nickname, role, startSubSlot, endSubSlotOverride) {
    const emp = this.employees.find(e => e.nickname === nickname);
    if (!emp) return;

    // endSubSlotOverride is exclusive end index
    for (let i = startSubSlot; i < endSubSlotOverride && i < TOTAL_SUB_SLOTS; i++) {
      if (i >= emp.startSubSlot && i <= emp.endSubSlot) {
        emp.schedule[i] = role;
      }
    }
  },
};

// ─── Bootstrap ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => App.init());

// ═══════════════════════════════════════════════════════════════════
// MODE TOGGLE — Panel ↔ App
// ═══════════════════════════════════════════════════════════════════

(function() {
  var MODE_KEY = 'diner-app-mode';

  function applyMode(mode) {
    var body = document.body;
    var toggle = document.getElementById('btn-mode-toggle');
    if (!toggle) return;
    if (mode === 'app') {
      body.classList.add('app-mode');
      toggle.textContent = '\uD83D\uDDA5\uFE0F Panel';
      toggle.title = 'Switch to Control Panel Mode';
      if (typeof App !== 'undefined' && App.employees) syncAppSchedule();
    } else {
      body.classList.remove('app-mode');
      toggle.textContent = '\uD83D\uDCF1 App';
      toggle.title = 'Switch to App Mode';
    }
    try { localStorage.setItem(MODE_KEY, mode); } catch(e) {}
  }

  function toggleMode() {
    var current = document.body.classList.contains('app-mode') ? 'app' : 'panel';
    applyMode(current === 'app' ? 'panel' : 'app');
  }

  document.addEventListener('DOMContentLoaded', function() {
    var saved;
    try { saved = localStorage.getItem(MODE_KEY); } catch(e) {}
    applyMode(saved === 'app' ? 'app' : 'panel');
    var toggle = document.getElementById('btn-mode-toggle');
    if (toggle) toggle.addEventListener('click', toggleMode);
    initAppNavigation();
  });

  window._applyMode = applyMode;
  window._toggleMode = toggleMode;
})();

// ═══════════════════════════════════════════════════════════════════
// APP MODE NAVIGATION
// ═══════════════════════════════════════════════════════════════════

function initAppNavigation() {
  document.querySelectorAll('.app-card[data-screen]').forEach(function(card) {
    card.addEventListener('click', function() { navigateTo(this.dataset.screen); });
  });
  document.querySelectorAll('.app-back-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { navigateTo(this.dataset.target || 'landing'); });
  });
  document.querySelectorAll('.app-nav-item').forEach(function(item) {
    item.addEventListener('click', function() { navigateTo(this.dataset.screen); });
  });

  var bind = function(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('app-btn-auto-assign', function() { if (typeof App !== 'undefined') App._autoAssign(); });
  bind('app-btn-validate', function() { if (typeof App !== 'undefined') App._validate(); });
  bind('app-btn-save', function() { if (typeof App !== 'undefined') App._save(); });
  bind('app-btn-export', function() { if (typeof App !== 'undefined') App._exportCSV(); });
  bind('app-btn-copy-list', function() { if (typeof App !== 'undefined') App._copyListToClipboard(); });
  bind('app-btn-add-employee', function() { if (typeof App !== 'undefined') App._openEmployeeModal(null); });
  bind('app-btn-open-roster', function() { if (typeof App !== 'undefined') App._openRosterModal(); });
  bind('app-btn-import-csv', function() { if (typeof App !== 'undefined') App._importCSV(); });
  bind('app-btn-export-csv', function() { if (typeof App !== 'undefined') App._exportCSV(); });
}

function navigateTo(screen) {
  document.querySelectorAll('.app-screen').forEach(function(s) { s.classList.remove('active'); });
  var target = document.getElementById('app-screen-' + screen);
  if (target) target.classList.add('active');
  document.querySelectorAll('.app-nav-item').forEach(function(n) { n.classList.remove('active'); });
  var navItem = document.querySelector('.app-nav-item[data-screen="' + screen + '"]');
  if (navItem) navItem.classList.add('active');
  if (screen === 'schedule') syncAppSchedule();
  if (screen === 'employees') renderAppEmployeeList();
}

function syncAppSchedule() {
  if (typeof App === 'undefined' || !App.employees) return;
  var appGrid = document.getElementById('app-schedule-grid');
  if (appGrid && typeof Grid !== 'undefined') Grid.render(appGrid, App.employees);
  if (typeof Output === 'undefined') return;
  Output.render(App.employees);
  var mirror = function(srcId, dstId) {
    var src = document.getElementById(srcId), dst = document.getElementById(dstId);
    if (src && dst) dst.innerHTML = src.innerHTML;
  };
  mirror('cook-list', 'app-cook-list');
  mirror('lunch-list', 'app-lunch-list');
  mirror('break-list', 'app-break-list');
}

function renderAppEmployeeList() {
  if (typeof App === 'undefined' || !App.employees) return;
  var list = document.getElementById('app-employee-list');
  if (!list) return;
  list.innerHTML = '';
  App.employees.forEach(function(emp) {
    var item = document.createElement('div');
    item.className = 'app-emp-item';
    var info = document.createElement('div');
    var times = '';
    if (typeof subSlotToClockTime !== 'undefined') {
      times = subSlotToClockTime(emp.startSubSlot) + '-' + subSlotToClockTime(emp.endSubSlot);
    }
    info.innerHTML = '<div class="app-emp-item-name">' + emp.nickname + '</div>' +
      '<div class="app-emp-item-detail">' + emp.name + ' &middot; ' + times + '</div>';
    item.appendChild(info);
    item.addEventListener('click', function() { App._openEmployeeModal(emp); });
    var del = document.createElement('button');
    del.className = 'app-emp-item-del';
    del.textContent = '\u00D7';
    del.addEventListener('click', function(e) {
      e.stopPropagation();
      if (confirm('Remove ' + emp.nickname + '?')) {
        App.employees = App.employees.filter(function(e) { return e.id !== emp.id; });
        App._autoSave();
        renderAppEmployeeList();
        syncAppSchedule();
      }
    });
    item.appendChild(del);
    list.appendChild(item);
  });
}

// ─── App Edit Toggle ──────────────────────────────────────────────

(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var btn = document.getElementById('app-btn-edit-toggle');
    if (!btn) return;

    btn.addEventListener('click', function() {
      var wrapper = document.querySelector('.app-grid-wrapper');
      var isEditing = wrapper && wrapper.classList.contains('editing');
      if (isEditing) {
        if (wrapper) wrapper.classList.remove('editing');
        btn.classList.remove('active');
        btn.textContent = '\u270F\uFE0F Edit';
      } else {
        if (wrapper) wrapper.classList.add('editing');
        btn.classList.add('active');
        btn.textContent = '\u2705 Editing';
      }
    });
  });
})();

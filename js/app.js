/**
 * Diner Shift Scheduler — App Controller
 * Wires toolbar, grid, output, and call-out mode.
 */

const App = {
  employees: [],
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

    // Click-to-cycle: HST → SRV → CK → BK → L → HST
    const next = ROLE_CYCLE_ORDER[(ROLE_CYCLE_ORDER.indexOf(role) + 1) % ROLE_CYCLE_ORDER.length];

    // Handle multi-slot fills
    if (next === 'CK') {
      // Auto-fill: CK = 2 sub-slots. Check if there's room.
      if (subSlot + 1 <= emp.endSubSlot) {
        // Check both slots are CK-able
        if (getRole(emp, subSlot) !== null && getRole(emp, subSlot + 1) !== null) {
          emp.schedule[subSlot] = 'CK';
          emp.schedule[subSlot + 1] = 'CK';
        }
      } else {
        // Not enough room — just set this one
        emp.schedule[subSlot] = 'CK';
      }
    } else if (next === 'L') {
      // Lunch = 4 sub-slots (1 hour)
      let start = subSlot;
      // Extend backward if possible to make a full block
      while (start > emp.startSubSlot &&
             getRole(emp, start - 1) !== null &&
             subSlot - start < 3) {
        start--;
      }
      // Fill up to 4 slots
      for (let i = 0; i < 4; i++) {
        const idx = start + i;
        if (idx <= emp.endSubSlot && getRole(emp, idx) !== null) {
          emp.schedule[idx] = 'L';
        }
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

/**
 * Diner Shift Scheduler — Grid Renderer
 * Renders the 15-minute granularity schedule grid.
 * Depends on: engine.js (global scope)
 */

const Grid = {
  errorSubSlots: new Set(),  // subSlot indices with errors, keyed as "empId:subSlot"
  employees: [],
  onCellClick: null,         // callback(employeeId, subSlotIndex)
  onNameClick: null,         // callback(employeeId) — for call-out mode

  render(container, employees) {
    this.employees = employees;
    this.errorSubSlots.clear();

    const table = document.createElement('table');
    table.id = 'schedule-grid';

    // ─── Header ───
    const thead = document.createElement('thead');
    const headerRow1 = document.createElement('tr');
    const headerRow2 = document.createElement('tr');

    // Empty corner cell
    const cornerTh = document.createElement('th');
    cornerTh.textContent = 'Name';
    cornerTh.rowSpan = 2;
    cornerTh.className = 'name-cell';
    headerRow1.appendChild(cornerTh);

    for (let h = 0; h < TOTAL_HOURS; h++) {
      const hourTh = document.createElement('th');
      hourTh.textContent = HOUR_LABELS[h];
      hourTh.className = 'hour-header';
      hourTh.colSpan = SUB_SLOTS_PER_HOUR;
      headerRow1.appendChild(hourTh);

      for (let q = 0; q < SUB_SLOTS_PER_HOUR; q++) {
        const subTh = document.createElement('th');
        subTh.textContent = q === 0 ? ':00' : q === 1 ? ':15' : q === 2 ? ':30' : ':45';
        subTh.className = 'sub-header';
        headerRow2.appendChild(subTh);
      }
    }

    thead.appendChild(headerRow1);
    thead.appendChild(headerRow2);
    table.appendChild(thead);

    // ─── Body ───
    const tbody = document.createElement('tbody');
    for (const emp of employees) {
      const row = this._renderRow(emp);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);

    container.innerHTML = '';
    container.appendChild(table);
  },

  _renderRow(employee) {
    const row = document.createElement('tr');

    // Name cell
    const nameCell = document.createElement('td');
    nameCell.className = 'name-cell';
    if (employee.calledOut) nameCell.classList.add('called-out');

    const nickname = document.createElement('span');
    nickname.className = 'nickname';
    nickname.textContent = employee.nickname;

    const fullname = document.createElement('span');
    fullname.className = 'fullname';
    fullname.textContent = employee.name;

    nameCell.appendChild(nickname);
    nameCell.appendChild(fullname);

    nameCell.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.onNameClick) this.onNameClick(employee.id);
    });

    nameCell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Right-click on name = edit employee (future)
    });

    row.appendChild(nameCell);

    // Grid cells
    for (let i = 0; i < TOTAL_SUB_SLOTS; i++) {
      const cell = document.createElement('td');
      cell.className = 'grid-cell';
      cell.dataset.subSlot = i;
      cell.dataset.employeeId = employee.id;

      const role = getRole(employee, i);

      if (!role) {
        // Off-shift (not working)
        cell.classList.add('off-shift');
        cell.textContent = '——';
        cell.title = 'Not on shift';
      } else {
        cell.classList.add(`role-${role}`);
        cell.textContent = role;
        cell.title = `${employee.nickname} · ${subSlotToClockTime(i)} · ${ROLES[role]?.label || '[role]'}`;

        // Error highlight
        const errorKey = `${employee.id}:${i}`;
        if (this.errorSubSlots.has(errorKey)) {
          cell.classList.add('has-error');
        }

        // Click handler
        cell.addEventListener('click', (e) => {
          e.preventDefault();
          if (this.onCellClick) this.onCellClick(employee.id, i);
        });

        // Right-click = clear
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          clearRole(employee, i);

          // If clearing CK or L, also clear adjacent auto-filled slots
          // Find and clear adjacent same-role blocks
          this._clearAdjacentBlock(employee, i, role);

          this.refresh();
        });
      }

      // Hour boundary marker
      if (i % SUB_SLOTS_PER_HOUR === 0) {
        cell.classList.add('hour-boundary-start');
      }

      row.appendChild(cell);
    }

    return row;
  },

  _clearAdjacentBlock(employee, subSlot, role) {
    if (role === 'CK') {
      // Clear the other CK slot (they come in pairs)
      if (subSlot > employee.startSubSlot && getRole(employee, subSlot - 1) === 'CK') {
        clearRole(employee, subSlot - 1);
      }
      if (subSlot < employee.endSubSlot && getRole(employee, subSlot + 1) === 'CK') {
        clearRole(employee, subSlot + 1);
      }
    } else if (role === 'L') {
      // Clear all adjacent L slots
      for (let i = subSlot - 3; i <= subSlot + 3; i++) {
        if (i >= employee.startSubSlot && i <= employee.endSubSlot && getRole(employee, i) === 'L') {
          clearRole(employee, i);
        }
      }
    }
  },

  highlightErrors(errors) {
    this.errorSubSlots.clear();
    for (const err of errors) {
      const key = `${err.employee.id}:${err.subSlot}`;
      this.errorSubSlots.add(key);
      // Also highlight adjacent sub-slots for CK blocks
      const role = getRole(err.employee, err.subSlot);
      if (role === 'CK') {
        if (err.subSlot > 0 && getRole(err.employee, err.subSlot - 1) === 'CK') {
          this.errorSubSlots.add(`${err.employee.id}:${err.subSlot - 1}`);
        }
        if (err.subSlot < TOTAL_SUB_SLOTS - 1 && getRole(err.employee, err.subSlot + 1) === 'CK') {
          this.errorSubSlots.add(`${err.employee.id}:${err.subSlot + 1}`);
        }
      }
    }
    this.refresh();
  },

  refresh() {
    const container = document.getElementById('schedule-grid');
    if (container) {
      // Always render from App.employees — Grid.this.employees is stale after first render
      this.render(container, App.employees);
    }
  },
};

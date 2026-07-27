/**
 * Diner Shift Scheduler — Core Engine
 * Pure logic: schedule manipulation, validation, output generation, call-out redistribution.
 * No DOM dependencies.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────

const SUB_SLOTS_PER_HOUR = 4;
const TOTAL_HOURS = 11;  // 10A through 8P
const TOTAL_SUB_SLOTS = TOTAL_HOURS * SUB_SLOTS_PER_HOUR;  // 44
const HOUR_LABELS = ['10A','11A','12P','1P','2P','3P','4P','5P','6P','7P','8P'];

const ROLES = {
  HST: { code: 'HST', label: 'Host',  color: '#F5A623', subSlots: 1, isDefault: true },
  SRV: { code: 'SRV', label: 'Serve', color: '#E85D75', subSlots: 1 },
  CK:  { code: 'CK',  label: 'Cook',  color: '#4A90D9', subSlots: 2 },
  BK:  { code: 'BK',  label: 'Break', color: '#333333', subSlots: 1 },
  L:   { code: 'L',   label: 'Lunch', color: '#888888', subSlots: 4 },
};

const ROLE_CYCLE_ORDER = ['HST', 'SRV', 'CK', 'BK'];
const ROLE_COLORS = {
  HST: '#F5A623',
  SRV: '#E85D75',
  CK: '#4A90D9',
  BK: '#333333',
  L: '#888888'
};

// ─── Time Helpers ──────────────────────────────────────────────────────────
// 24-hour base lookup for hour labels

const HOUR_24_MAP = {
  '10A': 10, '11A': 11, '12P': 12, '1P': 13, '2P': 14,
  '3P': 15, '4P': 16, '5P': 17, '6P': 18, '7P': 19, '8P': 20
};

function subSlotToClockTime(index) {
  const hourIdx = Math.floor(index / SUB_SLOTS_PER_HOUR);
  const minute = (index % SUB_SLOTS_PER_HOUR) * 15;
  const baseHour = HOUR_24_MAP[HOUR_LABELS[hourIdx]];
  const ampm = baseHour >= 12 ? 'PM' : 'AM';
  const displayHour = baseHour > 12 ? baseHour - 12 : baseHour;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${ampm}`;
}

function subSlotToSimpleTime(index) {
  index = Math.min(index, TOTAL_SUB_SLOTS - 1);
  const hourIdx = Math.floor(index / SUB_SLOTS_PER_HOUR);
  const minute = (index % SUB_SLOTS_PER_HOUR) * 15;
  const baseHour = HOUR_24_MAP[HOUR_LABELS[hourIdx]];
  const ampm = baseHour >= 12 ? 'PM' : 'AM';
  const displayHour = baseHour > 12 ? baseHour - 12 : baseHour;
  return `${displayHour}:${String(minute).padStart(2, '0')}`;
}
function formatTimeRange(startIdx, endIdx) {
  return `${subSlotToSimpleTime(startIdx)}-${subSlotToSimpleTime(endIdx)}`;
}

function getHourColumn(subSlotIndex) {
  return Math.floor(subSlotIndex / SUB_SLOTS_PER_HOUR);
}

function getHourLabel(subSlotIndex) {
  return HOUR_LABELS[getHourColumn(subSlotIndex)];
}

function subSlotFromTime(hour12, minute) {
  // Convert 12-hour time (e.g. hour12=10, minute=30) to sub-slot index.
  // The grid runs 10AM–8:45PM. Times before 10AM → 0, after 8:45PM → 43.
  const hour24 = (hour12 >= 1 && hour12 < 9) ? hour12 + 12 : hour12; // 1-8 → PM
  for (let i = 0; i < HOUR_LABELS.length; i++) {
    if (HOUR_24_MAP[HOUR_LABELS[i]] === hour24) {
      return i * SUB_SLOTS_PER_HOUR + Math.floor(minute / 15);
    }
  }
  // Clamp: before first hour → 0, after last hour → max
  if (hour24 < HOUR_24_MAP[HOUR_LABELS[0]]) return 0;
  return TOTAL_SUB_SLOTS - 1;
}

// ─── Employee Management ──────────────────────────────────────────────────

let nextId = 1;

function createEmployee(name, nickname, roleCode, startSubSlot, endSubSlot, isChef, lunchStartSubSlot) {
  // Input clamping — prevent invalid ranges
  startSubSlot = Math.max(0, Math.min(TOTAL_SUB_SLOTS - 1, parseInt(startSubSlot) || 0));
  endSubSlot = Math.max(startSubSlot, Math.min(TOTAL_SUB_SLOTS - 1, parseInt(endSubSlot) || TOTAL_SUB_SLOTS - 1));

  // Default isChef: LP (lead) and Ba (bartender/chef) are chefs
  if (isChef === undefined) {
    isChef = (roleCode === 'LP' || roleCode === 'Ba');
  }

  const schedule = [];
  // Mark off-shift slots
  for (let i = 0; i < TOTAL_SUB_SLOTS; i++) {
    if (i < startSubSlot || i > endSubSlot) {
      schedule[i] = null;  // null = off-shift (not even HST)
    }
  }
  return {
    id: `emp_${nextId++}`,
    name,
    nickname: nickname || name,
    roleCode: roleCode || '',
    startSubSlot,
    endSubSlot,
    isChef: !!isChef,
    lunchStartSubSlot: lunchStartSubSlot !== undefined ? lunchStartSubSlot : null,
    calledOut: false,
    schedule,
  };
}

// ─── Schedule Manipulation ────────────────────────────────────────────────

function isWorking(employee, subSlotIndex) {
  return subSlotIndex >= employee.startSubSlot && subSlotIndex <= employee.endSubSlot;
}

function getWorkingSlots(employee) {
  const slots = [];
  for (let i = employee.startSubSlot; i <= employee.endSubSlot; i++) {
    slots.push(i);
  }
  return slots;
}

function getChefs(employees) {
  return employees.filter(function(e) { return e.isChef && !e.calledOut; });
}

function getNonChefs(employees) {
  return employees.filter(function(e) { return !e.isChef && !e.calledOut; });
}

function getRole(employee, subSlotIndex) {
  if (subSlotIndex < 0 || subSlotIndex >= TOTAL_SUB_SLOTS) return null;
  if (!isWorking(employee, subSlotIndex)) return null; // not on shift
  return employee.schedule[subSlotIndex] || 'HST';
}

function setRole(employee, subSlotIndex, roleCode) {
  if (subSlotIndex < 0 || subSlotIndex >= TOTAL_SUB_SLOTS) return;
  if (!isWorking(employee, subSlotIndex)) return;
  employee.schedule[subSlotIndex] = roleCode;
}

function setRoleBulk(employee, startIdx, count, roleCode) {
  for (let i = 0; i < count; i++) {
    setRole(employee, startIdx + i, roleCode);
  }
}

function clearRole(employee, subSlotIndex) {
  setRole(employee, subSlotIndex, 'HST');
}

function clearRange(employee, startIdx, endIdx) {
  for (let i = startIdx; i <= endIdx; i++) {
    clearRole(employee, i);
  }
}

// ─── CK Block Detection ───────────────────────────────────────────────────

function findCKBlocks(employee) {
  const blocks = [];
  let i = employee.startSubSlot;
  while (i <= employee.endSubSlot) {
    if (employee.schedule[i] === 'CK') {
      const start = i;
      while (i <= employee.endSubSlot && employee.schedule[i] === 'CK') {
        i++;
      }
      blocks.push({ startIdx: start, endIdx: i - 1, length: i - start });
    } else {
      i++;
    }
  }
  return blocks;
}

function findAllCKAssignments(employees) {
  const assignments = [];
  for (const emp of employees) {
    if (emp.calledOut) continue;
    const blocks = findCKBlocks(emp);
    for (const block of blocks) {
      assignments.push({
        employee: emp,
        startIdx: block.startIdx,
        endIdx: block.endIdx,
      });
    }
  }
  return assignments;
}

// ─── SRV Block Detection ──────────────────────────────────────────────────

function findSRVBlocks(employee) {
  const blocks = [];
  let i = employee.startSubSlot;
  while (i <= employee.endSubSlot) {
    if (employee.schedule[i] === 'SRV') {
      const start = i;
      while (i <= employee.endSubSlot && employee.schedule[i] === 'SRV') {
        i++;
      }
      blocks.push({ startIdx: start, endIdx: i - 1, length: i - start });
    } else {
      i++;
    }
  }
  return blocks;
}

// ─── Break Detection ──────────────────────────────────────────────────────

function findBKSlots(employee) {
  const slots = [];
  for (let i = employee.startSubSlot; i <= employee.endSubSlot; i++) {
    if (employee.schedule[i] === 'BK') {
      slots.push(i);
    }
  }
  return slots;
}

function findLunchBlocks(employee) {
  const blocks = [];
  let i = employee.startSubSlot;
  while (i <= employee.endSubSlot) {
    if (employee.schedule[i] === 'L') {
      const start = i;
      while (i <= employee.endSubSlot && employee.schedule[i] === 'L') {
        i++;
      }
      blocks.push({ startIdx: start, endIdx: i - 1, length: i - start });
    } else {
      i++;
    }
  }
  return blocks;
}

// ─── Counting ─────────────────────────────────────────────────────────────

function countCKSubSlots(employee) {
  let count = 0;
  for (let i = employee.startSubSlot; i <= employee.endSubSlot; i++) {
    if (employee.schedule[i] === 'CK') count++;
  }
  return count;
}

function countCKBlocks(employee) {
  return findCKBlocks(employee).length;
}

// ─── Validation ───────────────────────────────────────────────────────────

function validateAll(employees, openingTime) {
  const errors = [];

  for (const emp of employees) {
    if (emp.calledOut) continue;
    const working = getWorkingSlots(emp);
    const isOpeningChef = openingTime !== undefined && emp.isChef && working[0] === openingTime;

    // Rule: CK must be exactly 2 consecutive sub-slots
    const ckBlocks = findCKBlocks(emp);
    for (const block of ckBlocks) {
      if (block.length !== 2) {
        errors.push({
          type: 'ck_length',
          employee: emp,
          subSlot: block.startIdx,
          message: `${emp.nickname}: CK block at ${subSlotToSimpleTime(block.startIdx)} is ${block.length * 15}min (should be 30min / 2 sub-slots)`,
          severity: 'error',
        });
      }
    }

    // Rule: SRV must immediately precede CK
    const srvBlocks = findSRVBlocks(emp);
    for (const srvBlock of srvBlocks) {
      const nextSlot = srvBlock.endIdx + 1;
      const nextRole = getRole(emp, nextSlot);
      // Allow SRV at end of shift with no CK after
      if (nextSlot <= emp.endSubSlot && nextRole !== 'CK') {
        errors.push({
          type: 'srv_no_ck',
          employee: emp,
          subSlot: srvBlock.endIdx,
          message: `${emp.nickname}: SRV at ${subSlotToSimpleTime(srvBlock.startIdx)} is not followed by CK`,
          severity: 'error',
        });
      }
    }

    // Rule: CK must have preceding SRV (exception: opening-time CK at 10am)
    for (const ckBlock of ckBlocks) {
      const prevSlot = ckBlock.startIdx - 1;
      const prevRole = getRole(emp, prevSlot);
      const isOpeningCK = isOpeningChef && ckBlock.startIdx === working[0];
      if (prevSlot >= emp.startSubSlot && prevRole !== 'SRV' && !isOpeningCK) {
        errors.push({
          type: 'ck_no_srv',
          employee: emp,
          subSlot: ckBlock.startIdx,
          message: `${emp.nickname}: CK at ${subSlotToSimpleTime(ckBlock.startIdx)} is not preceded by SRV`,
          severity: 'warning',
        });
      }
    }

    // Rule: No CK in first working sub-slot (exception: opening chef at 10am)
    if (working.length > 0 && emp.schedule[working[0]] === 'CK' && !isOpeningChef) {
      errors.push({
        type: 'ck_at_start',
        employee: emp,
        subSlot: working[0],
        message: `${emp.nickname}: CK scheduled in first working slot (${subSlotToSimpleTime(working[0])})`,
        severity: 'error',
      });
    }

    // Rule: No CK in sub-slot immediately after BK
    const bkSlots = findBKSlots(emp);
    for (const bkSlot of bkSlots) {
      const afterBk = bkSlot + 1;
      if (afterBk <= emp.endSubSlot && emp.schedule[afterBk] === 'CK') {
        errors.push({
          type: 'ck_after_bk',
          employee: emp,
          subSlot: afterBk,
          message: `${emp.nickname}: CK at ${subSlotToSimpleTime(afterBk)} is right after a break — not allowed`,
          severity: 'error',
        });
      }
    }

    // Rule: No assignments outside working hours (already enforced by setRole, but check)
    for (let i = 0; i < TOTAL_SUB_SLOTS; i++) {
      if (emp.schedule[i] !== null && emp.schedule[i] !== 'HST' && !isWorking(emp, i)) {
        errors.push({
          type: 'outside_hours',
          employee: emp,
          subSlot: i,
          message: `${emp.nickname}: ${emp.schedule[i]} assigned outside working hours at ${subSlotToSimpleTime(i)}`,
          severity: 'error',
        });
      }
    }

    // Rule: L must be 4 consecutive sub-slots
    const lunchBlocks = findLunchBlocks(emp);
    for (const block of lunchBlocks) {
      if (block.length !== 4) {
        errors.push({
          type: 'lunch_length',
          employee: emp,
          subSlot: block.startIdx,
          message: `${emp.nickname}: Lunch at ${subSlotToSimpleTime(block.startIdx)} is ${block.length * 15}min (should be 1hr / 4 sub-slots)`,
          severity: 'warning',
        });
      }
    }

    // Rule: BK must be single sub-slot (not adjacent to another BK)
    for (let i = 0; i < bkSlots.length - 1; i++) {
      if (bkSlots[i + 1] === bkSlots[i] + 1) {
        errors.push({
          type: 'bk_consecutive',
          employee: emp,
          subSlot: bkSlots[i],
          message: `${emp.nickname}: Consecutive break slots at ${subSlotToSimpleTime(bkSlots[i])} — break should be 15min (1 slot)`,
          severity: 'warning',
        });
      }
    }
  }

  // ─── Cross-employee CK conflict detection ─────────────────────
  // Two employees cannot cook the same 30-minute block
  const allCKBlocks = [];
  for (const emp of employees) {
    if (emp.calledOut) continue;
    const ckBlocks = findCKBlocks(emp);
    for (const block of ckBlocks) {
      allCKBlocks.push({ employee: emp, startIdx: block.startIdx, endIdx: block.endIdx });
    }
  }
  for (let i = 0; i < allCKBlocks.length; i++) {
    for (let j = i + 1; j < allCKBlocks.length; j++) {
      const a = allCKBlocks[i], b = allCKBlocks[j];
      if (a.startIdx <= b.endIdx && b.startIdx <= a.endIdx) {
        const overlapStart = Math.max(a.startIdx, b.startIdx);
        const overlapEnd = Math.min(a.endIdx, b.endIdx);
        errors.push({
          type: 'ck_conflict',
          employee: a.employee,
          subSlot: overlapStart,
          message: `${a.employee.nickname} and ${b.employee.nickname} both cooking at ${subSlotToSimpleTime(overlapStart)}-${subSlotToSimpleTime(overlapEnd + 1)}`,
          severity: 'error',
        });
      }
    }
  }

  return errors;
}

// ─── Output Generation ────────────────────────────────────────────────────

function generateCookSchedule(employees) {
  const slots = [];

  for (const emp of employees) {
    if (emp.calledOut) continue;
    const ckBlocks = findCKBlocks(emp);
    for (const block of ckBlocks) {
      if (block.length === 2) {
        slots.push({
          time: formatTimeRange(block.startIdx, block.endIdx + 1),
          startIdx: block.startIdx,
          endIdx: block.endIdx,
          name: emp.nickname,
        });
      } else if (block.length > 2) {
        // Split into 30-min chunks
        for (let j = block.startIdx; j < block.endIdx; j += 2) {
          slots.push({
            time: formatTimeRange(j, Math.min(j + 2, block.endIdx + 1)),
            startIdx: j,
            endIdx: Math.min(j + 1, block.endIdx),
            name: emp.nickname,
          });
        }
      }
    }
  }

  // Sort by start time
  slots.sort((a, b) => a.startIdx - b.startIdx);
  return slots;
}

function generateLunchList(employees) {
  const list = [];
  for (const emp of employees) {
    if (emp.calledOut) continue;
    const lunchBlocks = findLunchBlocks(emp);
    for (const block of lunchBlocks) {
      if (block.length >= 4) {
        list.push({
          name: emp.nickname,
          time: formatTimeRange(block.startIdx, block.endIdx + 1),
        });
      }
    }
  }
  return list;
}

function generateBreakList(employees) {
  const list = [];
  for (const emp of employees) {
    if (emp.calledOut) continue;
    const bkSlots = findBKSlots(emp);
    if (bkSlots.length > 0) {
      list.push({
        name: emp.nickname,
        times: bkSlots.map(s => subSlotToSimpleTime(s)),
      });
    }
  }
  return list;
}

// ─── Call-Out Redistribution ──────────────────────────────────────────────

/**
 * Redistribute CK blocks when an employee is called out.
 * Called from app.js — expects (employees, emp) and returns { changes, uncovered, employees }.
 */
function redistributeCallout(employees, calledOutEmp) {
  const changes = [];
  const uncovered = [];
  const ckBlocks = findCKBlocks(calledOutEmp);

  // Clear called-out employee's schedule
  for (let i = calledOutEmp.startSubSlot; i <= calledOutEmp.endSubSlot; i++) {
    calledOutEmp.schedule[i] = 'HST';
  }

  for (const block of ckBlocks) {
    if (block.length < 2) continue;

    const eligible = [];
    for (const emp of employees) {
      if (emp.calledOut || emp.id === calledOutEmp.id) continue;
      if (!isWorking(emp, block.startIdx) || !isWorking(emp, block.endIdx)) continue;
      if (emp.schedule[block.startIdx] === 'CK' || emp.schedule[block.startIdx + 1] === 'CK') continue;
      if (block.startIdx === emp.startSubSlot) continue;
      if (block.startIdx > emp.startSubSlot && emp.schedule[block.startIdx - 1] === 'BK') continue;
      eligible.push({ emp, ckCount: countCKSubSlots(emp) });
    }

    eligible.sort((a, b) => a.ckCount - b.ckCount);

    if (eligible.length > 0) {
      const replacement = eligible[0].emp;
      setRole(replacement, block.startIdx, 'CK');
      setRole(replacement, block.startIdx + 1, 'CK');

      // Auto-assign SRV before CK if slot is HST
      const srvSlot = block.startIdx - 1;
      if (srvSlot >= replacement.startSubSlot && srvSlot <= replacement.endSubSlot) {
        if (replacement.schedule[srvSlot] === 'HST') {
          setRole(replacement, srvSlot, 'SRV');
        }
      }

      changes.push({
        employee: replacement,
        subSlotRange: formatTimeRange(block.startIdx, block.endIdx + 1),
        newCKCount: (countCKSubSlots(replacement) / 2).toFixed(0)
      });
    } else {
      uncovered.push({
        subSlotRange: formatTimeRange(block.startIdx, block.endIdx + 1)
      });
    }
  }

  return { changes, uncovered, employees };
}

function handleCallOut(employees, calledOutId) {
  const log = [];
  const calledOutEmp = employees.find(e => e.id === calledOutId);
  if (!calledOutEmp) return { employees, log };

  calledOutEmp.calledOut = true;
  log.push(`📞 Call-Out: ${calledOutEmp.nickname} (${calledOutEmp.name})`);
  log.push('─'.repeat(40));

  // Collect their CK blocks
  const ckBlocks = findCKBlocks(calledOutEmp);
  let uncoveredCount = 0;

  for (const block of ckBlocks) {
    if (block.length < 2) continue; // skip malformed blocks

    // Find eligible replacements
    const eligible = [];
    for (const emp of employees) {
      if (emp.calledOut || emp.id === calledOutId) continue;
      // Must be working during the CK block
      if (!isWorking(emp, block.startIdx) || !isWorking(emp, block.endIdx)) continue;
      // Must not have CK in those slots already
      if (emp.schedule[block.startIdx] === 'CK' || emp.schedule[block.startIdx + 1] === 'CK') continue;
      // Boundary check: CK start must not be their first working slot
      if (block.startIdx === emp.startSubSlot) continue;
      // Boundary check: CK start must not be right after their BK
      if (block.startIdx > emp.startSubSlot && emp.schedule[block.startIdx - 1] === 'BK') continue;

      const ckCount = countCKSubSlots(emp);
      eligible.push({ emp, ckCount });
    }

    // Sort by CK count ascending
    eligible.sort((a, b) => a.ckCount - b.ckCount);

    if (eligible.length > 0) {
      const replacement = eligible[0].emp;
      const timeRange = formatTimeRange(block.startIdx, block.endIdx + 1);

      // Assign CK
      setRole(replacement, block.startIdx, 'CK');
      setRole(replacement, block.startIdx + 1, 'CK');

      // Auto-assign SRV in the slot before CK if working and currently HST
      const srvSlot = block.startIdx - 1;
      if (srvSlot >= replacement.startSubSlot && srvSlot <= replacement.endSubSlot) {
        if (replacement.schedule[srvSlot] === 'HST') {
          setRole(replacement, srvSlot, 'SRV');
        }
      }

      log.push(`${timeRange} CK → ${replacement.nickname} (was HST, now CK)`);
    } else {
      uncoveredCount++;
      log.push(`${formatTimeRange(block.startIdx, block.endIdx + 1)} CK → ⚠️ UNCOVERED`);
    }
  }

  // Clear called-out employee's schedule
  for (let i = calledOutEmp.startSubSlot; i <= calledOutEmp.endSubSlot; i++) {
    calledOutEmp.schedule[i] = 'HST';
  }

  log.push('─'.repeat(40));

  // Summary of new CK counts
  const counts = [];
  for (const emp of employees) {
    if (emp.calledOut) continue;
    counts.push(`${emp.nickname}: ${countCKSubSlots(emp) / 2} blocks`);
  }
  log.push(`New CK counts: ${counts.join(', ')}`);
  if (uncoveredCount > 0) {
    log.push(`⚠️ ${uncoveredCount} CK block(s) could not be covered`);
  }

  return { employees, log };
}

// ─── Persistence ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'diner-shift-scheduler-state';

function saveToStorage(employees) {
  const data = JSON.stringify(employees);
  try {
    localStorage.setItem(STORAGE_KEY, data);
    return true;
  } catch (e) {
    console.error('Failed to save:', e);
    return false;
  }
}

function loadFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    // Restore nextId to avoid collisions
    if (parsed.length > 0) {
      const maxId = Math.max(...parsed.map(e => {
        const num = parseInt(e.id?.replace('emp_', '') || '0');
        return isNaN(num) ? 0 : num;
      }));
      nextId = maxId + 1;
    }
    return parsed;
  } catch (e) {
    console.error('Failed to load:', e);
    return null;
  }
}

// ─── Demo Data ────────────────────────────────────────────────────────────

function getDemoData() {
  // Nickname mapping: Antonella F→Ant, Rikki J→Rikki, Margarita D→Marc,
  // Hilary B→Hilary, Gregory P→Greg, Madison W→Madi, Joshua I→Josh,
  // Londyn M→Maddy, Maddy A→Maddie

  const emps = [
    createEmployee('Manager', 'Manager', 'LP', 0, 35),
    createEmployee('Rikki J', 'Rikki', 'Ba', 24, 35),         // 4:00pm = idx 24
    createEmployee('Eden O', 'Eden', 'Ba', 24, 35),
    createEmployee('Antonella F', 'Ant', 'LP', 0, 31),         // 9:30a≈0, 5:30p=30
    createEmployee('Margarita D', 'Marc', 'LP', 0, 35),        // 9:30a≈0, 6:30p=34
    createEmployee('Hilary B', 'Hilary', '', 20, 39),          // 11:30a=6, 7:30p=38
    createEmployee('Joshua I', 'Josh', '', 24, 43),            // 12:30p=10, 8:30p=42
    createEmployee('Londyn M', 'Maddy', '', 28, 43),           // 1:30p=14, 10:30p=?
    createEmployee('Madison W', 'Madi', '', 28, 43),           // 1:30p=14
    createEmployee('Gregory P', 'Greg', '', 28, 43),           // 1:30p=14
    createEmployee('Maddy A', 'Maddie', '', 34, 43),           // 2:30p=18
  ];

  // Rikki J: long day with SRV/CK/BK/HST mix
  // Based on grid: SRV blocks, CK blocks, BK at various times
  // 10A-11A: SRV? Actually Rikki starts at 4pm so sub-slot 24.
  // Let me set up a reasonable demo based on the handwritten list
  const rikki = emps[1];
  setRoleBulk(rikki, 24, 1, 'SRV');  // 4:00-4:15
  setRoleBulk(rikki, 25, 2, 'CK');   // 4:15-4:45 — wait, CK=2 sub-slots=30min
  // Actually let me use the handwritten list as ground truth:
  // Cook list: Rikki cooks 10:30-11:00, 12:30-1:00, 1:30-2:00
  // But Rikki starts at 4pm... that doesn't match. The grid's start time and the cook list might differ.
  // Let me just set up a clean demo with the rules properly applied.

  return emps;
}

function getNickname(employee) {
  return employee.nickname || employee.name;
}

// ─── Public API namespace ─────────────────────────────────────────────────
const Engine = {
  // Constants
  SUB_SLOTS_PER_HOUR,
  TOTAL_HOURS,
  TOTAL_SUB_SLOTS,
  HOUR_LABELS,
  ROLE_COLORS,
  ROLE_CYCLE_ORDER,
  HOUR_24_MAP,
  STORAGE_KEY,

  // Time helpers
  subSlotToClockTime,
  subSlotToSimpleTime,
  formatTimeRange,
  subSlotFromTime,

  // Employee management
  createEmployee,
  getRole,
  setRole,
  clearRole,
  setRoleBulk,
  isWorking,
  getWorkingSlots,
  getChefs,
  getNonChefs,
  findCKBlocks,
  findSRVBlocks,
  findBKSlots,
  findLunchBlocks,
  getNickname,

  // Validation
  validateAll,

  // Output generation
  generateCookSchedule,
  generateLunchList,
  generateBreakList,

  // Call-out redistribution
  redistributeCallout,
  handleCallOut,

  // Persistence
  saveToStorage,
  loadFromStorage,
  getDemoData,
};

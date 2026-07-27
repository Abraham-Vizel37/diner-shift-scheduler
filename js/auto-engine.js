/**
 * Diner Shift Scheduler — Auto-Assign Engine
 * Rule-based schedule generation from shift start/end/lunch inputs.
 * Multi-pass constructive algorithm with single-level backtracking.
 * One-directional dependency on Engine (engine.js).
 */
'use strict';

var AutoEngine = (function() {
  var T = Engine.TOTAL_SUB_SLOTS; // 44

  // ─── Configuration ─────────────────────────────────────────────────────

  var DEFAULT_CONFIG = {
    openingTime: 0,       // sub-slot for restaurant opening (0 = 10:00 AM)
    minShiftLength: 9,    // minimum sub-slots for a viable shift (2.25 hrs)
    lunchEarlyThreshold: 10, // sub-slots from start to trigger R13 (2.5 hrs)
    postLunchGap: 2,      // sub-slots a chef must wait after own lunch before CK (30 min)
  };

  // ─── Public API ─────────────────────────────────────────────────────────

  function generate(employees, config) {
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    var errors = [];
    var warnings = [];
    var log = [];

    // Clone employees so we don't mutate originals
    var cloned = cloneEmployees(employees);

    // Reset all schedules (clear existing manual assignments)
    cloned.forEach(function(emp) {
      for (var i = 0; i < T; i++) {
        emp.schedule[i] = (i < emp.startSubSlot || i > emp.endSubSlot) ? null : undefined;
      }
    });

    // Pre-assignment validation
    var preCheck = validateInputs(cloned, config);
    errors = errors.concat(preCheck.errors);
    warnings = warnings.concat(preCheck.warnings);

    // Remove employees with critical validation failures from the pool
    if (preCheck.invalidIds && preCheck.invalidIds.length > 0) {
      cloned = cloned.filter(function(emp) {
        if (preCheck.invalidIds.indexOf(emp.id) !== -1) return false;
        return true;
      });
    }

    if (preCheck.blocked) {
      return { employees: cloned, errors: errors, warnings: warnings, log: log, success: false };
    }

    // Phase 1: Place lunches
    errors = errors.concat(placeLunches(cloned));

    // Phase 2: Place breaks for chefs
    var chefs = Engine.getChefs(cloned);
    var nonChefs = Engine.getNonChefs(cloned);
    chefs.forEach(function(chef) {
      warnings = warnings.concat(placeBreaks(chef, config));
    });

    // Place breaks for non-chefs (simpler — just two 15-min breaks)
    nonChefs.forEach(function(emp) {
      placeSimpleBreaks(emp);
    });

    // Phase 3: Compute coverage window
    var coverage = computeCoverageWindow(chefs, cloned);
    log.push({ phase: 'coverage', start: coverage.start, end: coverage.end });

    // Phase 4: Allocate CK blocks to chefs
    var allocations = allocateCKBlocks(chefs, coverage);
    log.push({ phase: 'allocation', allocations: allocations });

    // Phase 5: Schedule CK blocks chronologically
    var ckResult = scheduleCKBlocks(chefs, allocations, coverage, config);
    errors = errors.concat(ckResult.errors);
    warnings = warnings.concat(ckResult.warnings);
    log = log.concat(ckResult.log);

    // Phase 6: Assign SRV and HST
    assignSRVandHST(cloned, coverage, config);
    warnings = warnings.concat(checkCoverageGaps(cloned, chefs, coverage));

    // Fill non-chef schedules with HST
    nonChefs.forEach(function(emp) {
      for (var i = emp.startSubSlot; i <= emp.endSubSlot; i++) {
        if (!emp.schedule[i] || emp.schedule[i] === 'HST') {
          emp.schedule[i] = 'HST';
        }
      }
    });

    // Mark red flags for solo chef gaps
    var soloFlags = markSoloChefGaps(cloned, chefs);
    warnings = warnings.concat(soloFlags);

    // Post-validation
    var postErrors = Engine.validateAll(cloned, config.openingTime);
    if (postErrors && postErrors.length) {
      postErrors.forEach(function(e) {
        var msg = typeof e === 'string' ? e : (e.message || JSON.stringify(e));
        if (msg.indexOf('ERROR') !== -1) errors.push(msg);
        else if (msg.indexOf('WARNING') !== -1 || msg.indexOf('RED FLAG') !== -1 || msg.indexOf('INFO') !== -1) warnings.push(msg);
        else warnings.push(msg); // default: treat as warning
      });
    }

    return {
      employees: cloned,
      errors: errors,
      warnings: warnings,
      log: log,
      success: errors.length === 0
    };
  }

  // ─── Clone ──────────────────────────────────────────────────────────────

  function cloneEmployees(employees) {
    return employees.map(function(emp) {
      return {
        id: emp.id,
        name: emp.name,
        nickname: emp.nickname,
        roleCode: emp.roleCode,
        startSubSlot: emp.startSubSlot,
        endSubSlot: emp.endSubSlot,
        isChef: emp.isChef,
        lunchStartSubSlot: emp.lunchStartSubSlot,
        calledOut: emp.calledOut,
        schedule: emp.schedule.map(function(s) { return s; })
      };
    });
  }

  // ─── Phase 1: Lunch Placement ──────────────────────────────────────────

  function placeLunches(employees) {
    var errors = [];
    employees.forEach(function(emp) {
      if (emp.lunchStartSubSlot === null || emp.lunchStartSubSlot === undefined) return;
      var ls = emp.lunchStartSubSlot;
      if (ls < emp.startSubSlot || ls + 3 > emp.endSubSlot) {
        errors.push('ERROR: ' + emp.name + ' — lunch outside shift bounds');
        return;
      }
      for (var i = 0; i < 4; i++) {
        emp.schedule[ls + i] = 'L';
      }
    });
    return errors;
  }

  // ─── Phase 2: Break Placement ──────────────────────────────────────────

  function placeBreaks(employee, config) {
    var warnings = [];
    var ls = employee.lunchStartSubSlot;
    if (ls === null || ls === undefined) {
      // No lunch specified — place two breaks evenly across shift
      return placeEvenBreaks(employee);
    }

    var preLunchSlots = ls - employee.startSubSlot;
    var lunchEnd = ls + 4;
    var postLunchSlots = employee.endSubSlot - lunchEnd + 1;

    if (preLunchSlots < config.lunchEarlyThreshold) {
      // R13: lunch too early → no break before, 2 breaks after
      placePostLunchBreaks(employee, lunchEnd, postLunchSlots, 2);
    } else {
      // R12: 1 break before + 1 break after lunch
      // Pre-lunch break at midpoint of pre-lunch zone
      var preMid = employee.startSubSlot + Math.floor(preLunchSlots / 2);
      placeBreakAt(employee, preMid, warnings);

      // Post-lunch break
      placePostLunchBreaks(employee, lunchEnd, postLunchSlots, 1);
    }
    return warnings;
  }

  function placeSimpleBreaks(employee) {
    // Non-chef: two breaks evenly spaced across shift
    placeEvenBreaks(employee);
  }

  function placeEvenBreaks(employee) {
    var working = employee.endSubSlot - employee.startSubSlot + 1;
    if (working < 5) return []; // too short for breaks
    var bk1 = employee.startSubSlot + Math.floor(working / 3);
    var bk2 = employee.startSubSlot + Math.floor(2 * working / 3);
    employee.schedule[bk1] = 'BK';
    employee.schedule[bk2] = 'BK';
    return [];
  }

  function placePostLunchBreaks(employee, lunchEnd, postLunchSlots, count) {
    var warnings = [];
    if (count === 0) return warnings;

    // 3-segment spacing algorithm (clarified rule #4):
    // Divide post-lunch window into 3 equal segments
    // Breaks go at segment boundaries
    var segSize = Math.floor(postLunchSlots / 3);
    var remainder = postLunchSlots % 3;
    // Segment sizes: [segSize, segSize, segSize]
    // +remainder: add to center segment (between the two breaks)
    // -1 slot: last segment is shortest

    if (count === 2) {
      var bk1Pos = lunchEnd + segSize;           // after segment 1
      var bk2Pos = bk1Pos + 1 + segSize + remainder; // after segment 2 (with remainder added to center)
      // Clamp
      if (bk1Pos < employee.endSubSlot) {
        placeBreakAt(employee, bk1Pos, warnings);
      }
      if (bk2Pos < employee.endSubSlot) {
        placeBreakAt(employee, bk2Pos, warnings);
      }
    } else if (count === 1) {
      var midPos = lunchEnd + Math.floor(postLunchSlots / 2);
      placeBreakAt(employee, midPos, warnings);
    }

    return warnings;
  }

  function placeBreakAt(employee, slot, warnings) {
    if (slot < employee.startSubSlot || slot > employee.endSubSlot) {
      warnings.push('WARNING: ' + employee.name + ' — break slot out of bounds, clamped');
      slot = Math.max(employee.startSubSlot, Math.min(employee.endSubSlot, slot));
    }
    // Don't overwrite lunch
    if (employee.schedule[slot] === 'L') {
      // Find nearest available slot
      for (var offset = 1; offset < 4; offset++) {
        if (slot + offset <= employee.endSubSlot && !employee.schedule[slot + offset]) {
          employee.schedule[slot + offset] = 'BK';
          return;
        }
        if (slot - offset >= employee.startSubSlot && !employee.schedule[slot - offset]) {
          employee.schedule[slot - offset] = 'BK';
          return;
        }
      }
      warnings.push('WARNING: ' + employee.name + ' — could not place break (lunch overlap)');
      return;
    }
    employee.schedule[slot] = 'BK';
  }

  // ─── Phase 3: Coverage Window ──────────────────────────────────────────

  function computeCoverageWindow(chefs, allEmployees) {
    if (chefs.length === 0) {
      // Use all employees as fallback
      chefs = allEmployees;
    }
    var minStart = Infinity;
    var maxEnd = -Infinity;
    chefs.forEach(function(c) {
      if (c.startSubSlot < minStart) minStart = c.startSubSlot;
      if (c.endSubSlot > maxEnd) maxEnd = c.endSubSlot;
    });
    if (minStart === Infinity) { minStart = 0; maxEnd = T - 1; }
    return { start: minStart, end: maxEnd };
  }

  // ─── Phase 4: CK Block Allocation ──────────────────────────────────────

  function allocateCKBlocks(chefs, coverage) {
    var totalCKBlocks = Math.ceil((coverage.end - coverage.start + 1) / 2);
    if (chefs.length === 0) return {};

    // Proportional allocation by shift length
    var totalWorkingSlots = 0;
    chefs.forEach(function(c) {
      totalWorkingSlots += (c.endSubSlot - c.startSubSlot + 1);
    });

    var allocations = {};
    var allocated = 0;
    chefs.forEach(function(c, idx) {
      var workingSlots = c.endSubSlot - c.startSubSlot + 1;
      var share = Math.round(totalCKBlocks * (workingSlots / totalWorkingSlots));
      // Ensure at least 1 if chef present
      if (share === 0 && totalCKBlocks > 0) share = 1;
      allocations[c.id] = { target: share };
      allocated += share;
    });

    // Adjust for rounding: add/remove from longest-shift chefs
    var diff = totalCKBlocks - allocated;
    var sorted = chefs.slice().sort(function(a, b) {
      return (b.endSubSlot - b.startSubSlot) - (a.endSubSlot - a.startSubSlot);
    });
    var i = 0;
    while (diff > 0) {
      allocations[sorted[i % sorted.length].id].target++;
      diff--;
      i++;
    }
    while (diff < 0) {
      // Don't go below 1 if chef has at least one block originally
      var chefId = sorted[i % sorted.length].id;
      if (allocations[chefId].target > 1) {
        allocations[chefId].target--;
        diff++;
      }
      i++;
    }

    // Initialize counters
    chefs.forEach(function(c) {
      allocations[c.id].used = 0;
      allocations[c.id].lastCookSlot = -Infinity;
    });

    return allocations;
  }

  // ─── Phase 5: CK Block Scheduling ──────────────────────────────────────

  function scheduleCKBlocks(chefs, allocations, coverage, config) {
    var errors = [];
    var warnings = [];
    var log = [];
    var cookHistory = []; // [{ chefId, startSlot }]
    var hasBacktracked = false;  // only one backtrack per pass

    // For each 30-min block in the coverage window
    var blockStart = coverage.start;
    while (blockStart <= coverage.end) {
      var blockEnd = blockStart + 1;
      if (blockEnd > coverage.end) break;

      // Find eligible chefs
      var eligible = findEligibleChefs(chefs, allocations, blockStart, blockEnd, config);

      if (eligible.length === 0 && !hasBacktracked) {
        // Try backtracking one block
        var result = backtrack(chefs, allocations, cookHistory, coverage, config, blockStart);
        if (result) {
          log.push({ slot: blockStart, action: 'backtracked', chef: result.name });
          hasBacktracked = true;
          // Rewind to re-evaluate the undone block
          blockStart = result.undoneSlot;
          continue;
        }
      }

      var relaxed = false;
      if (eligible.length === 0) {
        // Priority-ordered fallback: relax soft constraints (allocation cap,
        // post-break gap, post-lunch gap, shift-start rule) rather than gapping.
        eligible = findEligibleChefsRelaxed(chefs, allocations, blockStart, blockEnd, config, cookHistory);
        relaxed = true;
      }

      if (eligible.length === 0) {
        var msg = 'WARNING: No eligible chef for CK at slot ' + blockStart + ' (' + Engine.subSlotToSimpleTime(blockStart) + ')';
        warnings.push(msg);
        log.push({ slot: blockStart, action: 'gap', reason: 'no eligible chef' });
        blockStart += 2;
        continue;
      }

      // Pick chef: fewest cooking slots → longest since last cook
      var chosen = pickNextCook(eligible, allocations);

      if (relaxed) {
        warnings.push('WARNING: Relaxed constraints for CK at ' + Engine.subSlotToSimpleTime(blockStart) +
          ' — assigned to ' + (chosen.name || chosen.nickname));
      }

      // Assign CK
      chosen.schedule[blockStart] = 'CK';
      chosen.schedule[blockStart + 1] = 'CK';
      allocations[chosen.id].used += 1;
      allocations[chosen.id].lastCookSlot = blockStart;

      cookHistory.push({ chefId: chosen.id, startSlot: blockStart });
      log.push({ slot: blockStart, action: 'assign', chef: chosen.name || chosen.nickname });
      blockStart += 2;
    }

    // Check fairness — max-min should be ≤1 for even distribution
    var counts = chefs.map(function(c) { return allocations[c.id].used; });
    var maxCount = Math.max.apply(null, counts);
    var minCount = Math.min.apply(null, counts);
    if (maxCount - minCount > 1) {
      var maxChef = chefs[counts.indexOf(maxCount)];
      var minChef = chefs[counts.indexOf(minCount)];
      warnings.push('WARNING: Uneven cooking distribution — ' + (maxChef.nickname || maxChef.name) +
        ' has ' + maxCount + ' blocks, ' + (minChef.nickname || minChef.name) +
        ' has ' + minCount + ' (diff=' + (maxCount - minCount) + ')');
    }

    return { errors: errors, warnings: warnings, log: log };
  }

  function findEligibleChefs(chefs, allocations, blockStart, blockEnd, config) {
    return chefs.filter(function(chef) {
      // Must be working during this block
      if (blockStart < chef.startSubSlot || blockEnd > chef.endSubSlot) return false;
      // Not on lunch during this block
      for (var s = blockStart; s <= blockEnd; s++) {
        if (chef.schedule[s] === 'L' || chef.schedule[s] === 'BK') return false;
      }
      // R3: No CK at shift start unless opening chef
      if (blockStart === chef.startSubSlot && chef.startSubSlot !== config.openingTime) return false;
      // R4: No CK within postLunchGap after own lunch
      if (chef.lunchStartSubSlot !== null && chef.lunchStartSubSlot !== undefined) {
        var lunchEnd = chef.lunchStartSubSlot + 3;
        if (blockStart <= lunchEnd + config.postLunchGap && blockStart > lunchEnd) return false;
      }
      // R-new: No CK within 2 slots (30 min) after any break
      for (var bs = blockStart - 1; bs >= Math.max(blockStart - 2, chef.startSubSlot); bs--) {
        if (chef.schedule[bs] === 'BK') return false;
      }
      return true;
    });
  }

  function findEligibleChefsRelaxed(chefs, allocations, blockStart, blockEnd, config, cookHistory) {
    // Relaxed eligibility: drops soft constraints when strict pass fails.
    // Hard constraints retained: shift bounds, lunch/BK during the block.
    // Soft constraints dropped: allocation cap, shift-start rule, post-lunch gap, post-break gap.
    // Still prefers chefs who haven't cooked at this slot recently (avoid adjacent CK).
    return chefs.filter(function(chef) {
      if (blockStart < chef.startSubSlot || blockEnd > chef.endSubSlot) return false;
      for (var s = blockStart; s <= blockEnd; s++) {
        if (chef.schedule[s] === 'L' || chef.schedule[s] === 'BK') return false;
      }
      // Avoid the chef who just cooked (if any) to prevent adjacent CK blocks
      if (cookHistory.length > 0) {
        var lastCook = cookHistory[cookHistory.length - 1];
        if (lastCook.chefId === chef.id && lastCook.startSlot >= blockStart - 4) return false;
      }
      return true;
    });
  }

  function pickNextCook(eligible, allocations) {
    // (b) fewest cooking slots → (c) longest since last cook
    return eligible.sort(function(a, b) {
      var usedA = allocations[a.id].used;
      var usedB = allocations[b.id].used;
      if (usedA !== usedB) return usedA - usedB; // fewer slots first

      var lastA = allocations[a.id].lastCookSlot;
      var lastB = allocations[b.id].lastCookSlot;
      if (lastA === -Infinity) return -1; // never cooked → prioritized
      if (lastB === -Infinity) return 1;
      return lastA - lastB; // cooked longer ago → prioritized
    })[0];
  }

  function backtrack(chefs, allocations, cookHistory, coverage, config, stuckBlock) {
    if (cookHistory.length === 0) return null;

    // Undo the most recent CK assignment and try a different chef
    var last = cookHistory.pop();
    var lastChef = null;
    for (var i = 0; i < chefs.length; i++) {
      if (chefs[i].id === last.chefId) { lastChef = chefs[i]; break; }
    }
    if (!lastChef) return null;

    // Undo assignment
    lastChef.schedule[last.startSlot] = undefined;
    lastChef.schedule[last.startSlot + 1] = undefined;
    allocations[last.chefId].used -= 1;
    allocations[last.chefId].lastCookSlot = -Infinity;

    // Restore lastCookSlot from remaining history
    for (var j = cookHistory.length - 1; j >= 0; j--) {
      if (cookHistory[j].chefId === last.chefId) {
        allocations[last.chefId].lastCookSlot = cookHistory[j].startSlot;
        break;
      }
    }

    return { name: lastChef.name || lastChef.nickname, undoneSlot: last.startSlot };
  }

  // ─── Phase 6: SRV and HST Assignment ───────────────────────────────────

  function assignSRVandHST(employees, coverage, config) {
    var chefs = Engine.getChefs(employees);
    if (chefs.length === 0) return;

    // Phase 6a: SRV prefix for each cooking chef (best-effort, relaxed constraint)
    for (var blockStart = coverage.start; blockStart <= coverage.end; blockStart += 2) {
      var cook = findCookAt(chefs, blockStart);
      if (!cook) continue;
      var srvStart = blockStart - 2;
      if (srvStart >= cook.startSubSlot) {
        var blocked = false;
        for (var s = srvStart; s < blockStart; s++) {
          if (cook.schedule[s] === 'BK' || cook.schedule[s] === 'L' || cook.schedule[s] === 'CK') {
            blocked = true; break;
          }
        }
        if (!blocked) {
          cook.schedule[srvStart] = 'SRV';
          cook.schedule[srvStart + 1] = 'SRV';
        }
      }
    }

    // Phase 6b: For each CK block, assign HST to non-cooking chefs
    for (var blockStart = coverage.start; blockStart <= coverage.end; blockStart += 2) {
      var blockEnd = blockStart + 1;
      var currentCook = findCookAt(chefs, blockStart);
      if (!currentCook) continue;

      if (chefs.length === 2) {
        // R14: 2-chef mode — cook is also server, other chef = HST
        assign2ChefMode(chefs, currentCook, blockStart, blockEnd, config);
      } else if (chefs.length >= 3) {
        // R8: next-up chef = SRV, others = HST
        assign3PlusMode(chefs, currentCook, blockStart, blockEnd, config);
      }
    }

    // Fill remaining working slots with HST
    chefs.forEach(function(chef) {
      for (var s = chef.startSubSlot; s <= chef.endSubSlot; s++) {
        if (!chef.schedule[s] || chef.schedule[s] === 'HST') {
          chef.schedule[s] = 'HST';
        }
      }
    });
  }

    function findCookAt(chefs, blockStart) {
    for (var i = 0; i < chefs.length; i++) {
      if (chefs[i].schedule[blockStart] === 'CK') return chefs[i];
    }
    return null;
  }

  function assign2ChefMode(chefs, currentCook, blockStart, blockEnd, config) {
    // R14: current cook = CK (already set by scheduling), other chef = HST
    var otherChef = null;
    for (var i = 0; i < chefs.length; i++) {
      if (chefs[i].id !== currentCook.id) { otherChef = chefs[i]; break; }
    }
    if (!otherChef) return;

    // Other chef gets HST during this block (unless on lunch/break)
    for (var s = blockStart; s <= blockEnd; s++) {
      if (s >= otherChef.startSubSlot && s <= otherChef.endSubSlot) {
        if (!otherChef.schedule[s] || otherChef.schedule[s] === 'HST') {
          otherChef.schedule[s] = 'HST';
        }
      }
    }
  }

  function assign3PlusMode(chefs, currentCook, blockStart, blockEnd, config) {
    // R8: 3+ chefs — current cook's SRV prefix set in Phase 6a above.
    // Non-cooking chefs = HST during this block.
    for (var i = 0; i < chefs.length; i++) {
      var other = chefs[i];
      if (other.id === currentCook.id) continue; // skip the cook
      for (var s = blockStart; s <= blockEnd; s++) {
        if (s >= other.startSubSlot && s <= other.endSubSlot) {
          if (!other.schedule[s] || other.schedule[s] === 'HST') {
            other.schedule[s] = 'HST';
          }
        }
      }
    }
  }

  // ─── Coverage Gap Check ────────────────────────────────────────────────

  function checkCoverageGaps(employees, chefs, coverage) {
    var warnings = [];
    if (chefs.length <= 1) return warnings; // solo chef gaps handled separately

    for (var s = coverage.start; s <= coverage.end; s++) {
      var hasCook = false;
      for (var i = 0; i < chefs.length; i++) {
        if (chefs[i].schedule[s] === 'CK') { hasCook = true; break; }
      }
      if (!hasCook) {
        warnings.push('WARNING: Cooking gap at ' + Engine.subSlotToSimpleTime(s));
      }
    }
    return warnings;
  }

  // ─── Solo Chef Red Flags ───────────────────────────────────────────────

  function markSoloChefGaps(employees, chefs) {
    var warnings = [];
    if (chefs.length !== 1) return warnings;

    var chef = chefs[0];
    for (var s = chef.startSubSlot; s <= chef.endSubSlot; s++) {
      if (chef.schedule[s] === 'L' || chef.schedule[s] === 'BK') {
        warnings.push('RED FLAG: ' + chef.name + ' — no cooking coverage at ' + Engine.subSlotToSimpleTime(s) + ' (lunch/break)');
      }
    }

    // Count solo-chef-only hours
    var soloGaps = 0;
    for (var s2 = chef.startSubSlot; s2 <= chef.endSubSlot; s2++) {
      if (chef.schedule[s2] !== 'CK') soloGaps++;
    }
    if (soloGaps > 0) {
      warnings.push('INFO: 1-chef mode — ' + soloGaps + ' sub-slots without cooking coverage. "Need support from management."');
    }

    return warnings;
  }

  // ─── Pre-Assignment Validation (V1-V8) ─────────────────────────────────

  function validateInputs(employees, config) {
    var errors = [];
    var warnings = [];
    var blocked = false;
    var invalidIds = [];
    var chefs = Engine.getChefs(employees);

    // V1: Each employee has a viable shift length
    employees.forEach(function(emp) {
      var len = emp.endSubSlot - emp.startSubSlot + 1;
      if (len < config.minShiftLength) {
        errors.push('SKIPPED: ' + emp.name + ' — shift too short (' + len + ' slots, minimum ' + config.minShiftLength + ')');
        invalidIds.push(emp.id);
      }
    });

    // V2: At least one chef
    if (chefs.length === 0) {
      errors.push('REJECT: No chefs assigned');
      blocked = true;
    }

    // V3: Input completeness
    employees.forEach(function(emp) {
      if (emp.lunchStartSubSlot === null || emp.lunchStartSubSlot === undefined) {
        warnings.push('WARNING: ' + emp.name + ' — no lunch time specified');
      }
    });

    // V4: Lunch within shift bounds (warn only — don't block auto-assign)
    employees.forEach(function(emp) {
      if (emp.lunchStartSubSlot !== null && emp.lunchStartSubSlot !== undefined) {
        if (emp.lunchStartSubSlot < emp.startSubSlot || emp.lunchStartSubSlot + 3 > emp.endSubSlot) {
          warnings.push('WARNING: ' + emp.name + ' — lunch outside shift bounds (check shift times)');
        }
      }
    });

    // V5: Solo chef warning
    if (chefs.length === 1) {
      warnings.push('WARNING: 1-chef mode — expect cooking gaps during lunch and breaks');
    }

    // V6: All lunches overlap
    if (chefs.length >= 2) {
      var lunchRanges = chefs.map(function(c) {
        return { start: c.lunchStartSubSlot, end: c.lunchStartSubSlot !== null ? c.lunchStartSubSlot + 3 : null };
      });
      var allOverlap = true;
      for (var i = 0; i < lunchRanges.length; i++) {
        for (var j = i + 1; j < lunchRanges.length; j++) {
          if (lunchRanges[i].start === null || lunchRanges[j].start === null) { allOverlap = false; break; }
          if (lunchRanges[i].end < lunchRanges[j].start || lunchRanges[j].end < lunchRanges[i].start) {
            allOverlap = false;
            break;
          }
        }
        if (!allOverlap) break;
      }
      if (allOverlap && lunchRanges[0].start !== null) {
        errors.push('REJECT: All chefs have overlapping lunch — cannot maintain cooking coverage');
        blocked = true;
      }
    }

    // V7: Tight post-lunch break window
    chefs.forEach(function(chef) {
      if (chef.lunchStartSubSlot === null) return;
      var lunchEnd = chef.lunchStartSubSlot + 3;
      var postSlots = chef.endSubSlot - lunchEnd;
      if (postSlots < 4) {
        warnings.push('WARNING: ' + chef.name + ' — tight post-lunch window, break spacing may degrade');
      }
    });

    // V8: Any zero-chef coverage windows?
    if (chefs.length >= 2) {
      for (var s = 0; s < T; s++) {
        var chefsWorking = 0;
        for (var c = 0; c < chefs.length; c++) {
          if (s >= chefs[c].startSubSlot && s <= chefs[c].endSubSlot) chefsWorking++;
        }
        if (chefsWorking === 0) {
          // Check if any employee is working at this slot
          var anyoneWorking = false;
          for (var e = 0; e < employees.length; e++) {
            if (s >= employees[e].startSubSlot && s <= employees[e].endSubSlot) { anyoneWorking = true; break; }
          }
          if (anyoneWorking) {
            warnings.push('WARNING: No chef coverage at ' + Engine.subSlotToSimpleTime(s));
          }
        }
      }
    }

    return { errors: errors, warnings: warnings, blocked: blocked, invalidIds: invalidIds };
  }

  // ─── Mid-Cook Departure Handler ────────────────────────────────────────

  function handleMidCookDeparture(employees, chefs) {
    var warnings = [];
    if (chefs.length < 2) return warnings;

    // Check each chef: if shift ends during a CK block
    chefs.forEach(function(chef) {
      // Find CK block that ends at or after their shift end
      for (var s = chef.endSubSlot; s >= chef.startSubSlot; s--) {
        if (chef.schedule[s] === 'CK') {
          // Chef was cooking at shift end
          // Check if there's a server (next-up chef) available
          var server = findServerAt(chefs, s, chef.id);
          if (server) {
            // Server inherits the CK
            server.schedule[s] = 'CK';
            if (s < T - 1) server.schedule[s + 1] = 'CK';
            warnings.push('INFO: ' + chef.name + ' mid-cook departure — ' + server.name + ' inherits cooking');
          } else {
            // R15: solo chef remaining — red flag
            // Host (non-chef) steps up as emergency cook
            var host = findHost(employees, s);
            if (host) {
              host.schedule[s] = 'CK';
              warnings.push('RED FLAG: ' + chef.name + ' departed mid-cook — ' + host.name + ' (Host) steps up as emergency cook');
            } else {
              warnings.push('RED FLAG: ' + chef.name + ' departed mid-cook — no coverage available');
            }
          }
          break;
        }
      }
    });

    return warnings;
  }

  function findServerAt(chefs, slot, excludeId) {
    for (var i = 0; i < chefs.length; i++) {
      if (chefs[i].id === excludeId) continue;
      if (chefs[i].schedule[slot] === 'SRV' || chefs[i].schedule[slot] === 'HST') {
        return chefs[i];
      }
    }
    return null;
  }

  function findHost(employees, slot) {
    for (var i = 0; i < employees.length; i++) {
      if (employees[i].isChef) continue;
      if (employees[i].schedule[slot] === 'HST' || !employees[i].schedule[slot]) {
        return employees[i];
      }
    }
    return null;
  }

  // ─── Debug Helpers ──────────────────────────────────────────────────────

  function dumpSchedule(employees) {
    var lines = [];
    employees.forEach(function(emp) {
      var row = (emp.nickname || emp.name).padEnd(10);
      for (var i = 0; i < T; i++) {
        var val = emp.schedule[i] || (i < emp.startSubSlot || i > emp.endSubSlot ? '.' : '-');
        row += val.padEnd(3);
      }
      lines.push(row);
    });
    return lines.join('\n');
  }

  // ─── Exports ────────────────────────────────────────────────────────────

  return {
    generate: generate,
    validateInputs: validateInputs,
    dumpSchedule: dumpSchedule,
    handleMidCookDeparture: handleMidCookDeparture,
  };
})();

/**
 * Diner Shift Scheduler — Output Renderer
 * Generates the three-section daily list: Cook / Lunch / 15s.
 * Depends on: engine.js (global scope)
 */

const Output = {

  render(employees) {
    const cookData = Engine.generateCookSchedule(employees);
    const lunchData = Engine.generateLunchList(employees);
    const breakData = Engine.generateBreakList(employees);

    this._renderCook(cookData);
    this._renderLunch(lunchData);
    this._renderBreak(breakData);
  },

  _renderCook(data) {
    const container = document.getElementById('cook-list');
    if (!container) return;

    const frag = document.createDocumentFragment();

    for (const entry of data) {
      const row = document.createElement('div');
      row.className = 'cook-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = entry.name;

      row.appendChild(nameSpan);
      row.appendChild(document.createTextNode(' '));

      const timeSpan = document.createElement('span');
      timeSpan.className = 'time';
      timeSpan.textContent = entry.time;

      row.appendChild(timeSpan);
      frag.appendChild(row);
    }

    container.innerHTML = '';
    container.appendChild(frag);
  },

  _renderLunch(data) {
    const container = document.getElementById('lunch-list');
    if (!container) return;

    const frag = document.createDocumentFragment();

    for (const entry of data) {
      const row = document.createElement('div');
      row.className = 'lunch-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = entry.name;

      row.appendChild(nameSpan);
      row.appendChild(document.createTextNode(': '));

      const timeSpan = document.createElement('span');
      timeSpan.className = 'time';
      timeSpan.textContent = entry.time;

      row.appendChild(timeSpan);
      frag.appendChild(row);
    }

    container.innerHTML = '';
    container.appendChild(frag);
  },

  _renderBreak(data) {
    const container = document.getElementById('break-list');
    if (!container) return;

    const frag = document.createDocumentFragment();

    for (const entry of data) {
      const row = document.createElement('div');
      row.className = 'break-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = entry.name;

      row.appendChild(nameSpan);
      row.appendChild(document.createTextNode(': '));

      const timesSpan = document.createElement('span');
      timesSpan.className = 'times';
      timesSpan.textContent = entry.times.join(', ');

      row.appendChild(timesSpan);
      frag.appendChild(row);
    }

    container.innerHTML = '';
    container.appendChild(frag);
  },
};

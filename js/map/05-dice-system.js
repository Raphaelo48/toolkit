// ============ DICE SYSTEM ============
function selectDice(sides) {
  state.selectedDice = sides;
  updateDiceButtons();
}

function updateDiceButtons() {
  document.querySelectorAll('.dice-btn').forEach(btn => {
    const d = parseInt(btn.dataset.dice);
    btn.classList.toggle('selected', d === state.selectedDice);
  });
}

function parseModifier(str) {
  if (!str) return { fixed: 0, dice: [] };
  str = str.replace(/\s+/g, '').toLowerCase();
  if (str === '' || str === '+' || str === '-') return { fixed: 0, dice: [] };
  let fixed = 0;
  const dice = [];
  const tokens = str.match(/[+-]?[^+-]+/g) || [];
  for (const tok of tokens) {
    const m = tok.match(/^([+-]?)(\d*)d(\d+)(.*)$/);
    if (m) {
      const sign = m[1] === '-' ? -1 : 1;
      const count = m[2] ? parseInt(m[2]) : 1;
      const sides = parseInt(m[3]);
      if (count > 0 && sides > 0 && count <= 100 && sides <= 1000) dice.push({ sign, count, sides });
    } else {
      const n = parseInt(tok);
      if (!isNaN(n)) fixed += n;
    }
  }
  return { fixed, dice };
}

function rollDiceSet(count, sides) {
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(Math.floor(Math.random() * sides) + 1);
  return rolls;
}

function performRoll(sides, modifierStr) {
  const mod = parseModifier(modifierStr);
  const mainRolls = rollDiceSet(1, sides);
  const mainTotal = mainRolls.reduce((a, b) => a + b, 0);
  const extraDiceResults = [];
  let extraTotal = 0;
  mod.dice.forEach(d => {
    const rolls = rollDiceSet(d.count, d.sides);
    const sum = rolls.reduce((a, b) => a + b, 0);
    extraTotal += sum * d.sign;
    extraDiceResults.push({ sign: d.sign, count: d.count, sides: d.sides, rolls, sum: sum * d.sign });
  });
  const total = mainTotal + extraTotal + mod.fixed;
  return {
    sides, mainRolls, mainTotal, extraDiceResults, fixed: mod.fixed,
    modifierStr: modifierStr || '', total,
    isCrit: sides === 20 && mainTotal === 20,
    isFail: sides === 20 && mainTotal === 1,
  };
}

function formatRollResult(result) {
  const parts = [];
  parts.push(`<span class="roll-val">d${result.sides}=[${result.mainRolls.join(',')}]</span>`);
  result.extraDiceResults.forEach(ed => {
    const sign = ed.sign > 0 ? '+' : '−';
    parts.push(`${sign}<span class="roll-val">${ed.count}d${ed.sides}=[${ed.rolls.join(',')}]</span>`);
  });
  if (result.fixed !== 0) {
    const sign = result.fixed > 0 ? '+' : '−';
    parts.push(`<span class="mod-val">${sign}${Math.abs(result.fixed)}</span>`);
  }
  return parts.join(' ');
}

function rollSelectedDice() {
  const modStr = document.getElementById('dice-mod').value.trim();
  const result = performRoll(state.selectedDice, modStr);
  showDiceResult(result);
  state.lastDiceRoll = { sides: state.selectedDice, modStr };
  state.diceHistory.unshift({
    time: Date.now(), sides: result.sides, modStr: result.modifierStr,
    total: result.total, isCrit: result.isCrit, isFail: result.isFail,
  });
  if (state.diceHistory.length > 20) state.diceHistory.length = 20;
  let logMsg = `d${result.sides}`;
  if (result.modifierStr) logMsg += ` (${result.modifierStr})`;
  logMsg += ` = ${result.total}`;
  if (result.isCrit) logMsg += ' 🌟 КРИТ!';
  if (result.isFail) logMsg += ' 💀 ПРОВАЛ!';
  logEvent('dice', logMsg);
  window.DND_ONLINE?.sendDice?.(result);
  window.dndOnlineSync?.('dice_roll');
}

function showDiceResult(result) {
  const modal = document.getElementById('dice-modal');
  const icon = document.getElementById('dice-result-icon');
  const total = document.getElementById('dice-result-total');
  const breakdown = document.getElementById('dice-result-breakdown');
  const label = document.getElementById('dice-result-label');
  const historyList = document.getElementById('dice-history-list');

  icon.classList.add('rolling');
  total.textContent = '...';
  breakdown.innerHTML = '';
  label.textContent = '';
  label.className = 'dice-result-label';
  total.className = 'dice-result-total';

  setTimeout(() => {
    icon.classList.remove('rolling');
    total.textContent = result.total;
    if (result.isCrit) {
      total.classList.add('crit');
      label.textContent = '🌟 Критический успех!';
      label.classList.add('crit');
    } else if (result.isFail) {
      total.classList.add('fail');
      label.textContent = '💀 Критический провал!';
      label.classList.add('fail');
    } else {
      label.textContent = `d${result.sides}${result.modifierStr ? ' (' + result.modifierStr + ')' : ''}`;
    }
    breakdown.innerHTML = formatRollResult(result);
    if (state.diceHistory.length > 0) {
      historyList.innerHTML = state.diceHistory.slice(1, 11).map(h => {
        const time = new Date(h.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `
          <div class="dice-history-item">
            <span style="color:var(--text-3); font-size:10px;">${time}</span>
            <span class="dh-dice">d${h.sides}${h.modStr ? '(' + h.modStr + ')' : ''}</span>
            <span class="dh-total" style="${h.isCrit ? 'color:var(--accent)' : h.isFail ? 'color:var(--danger)' : ''}">${h.total}${h.isCrit ? ' 🌟' : h.isFail ? ' 💀' : ''}</span>
          </div>
        `;
      }).join('');
    } else {
      historyList.innerHTML = '';
    }
    modal.style.display = 'flex';
  }, 500);
}

function rerollLastDice() {
  if (!state.lastDiceRoll) { rollSelectedDice(); return; }
  const result = performRoll(state.lastDiceRoll.sides, state.lastDiceRoll.modStr);
  state.diceHistory.unshift({
    time: Date.now(), sides: result.sides, modStr: result.modifierStr,
    total: result.total, isCrit: result.isCrit, isFail: result.isFail,
  });
  if (state.diceHistory.length > 20) state.diceHistory.length = 20;
  let logMsg = `d${result.sides}`;
  if (result.modifierStr) logMsg += ` (${result.modifierStr})`;
  logMsg += ` = ${result.total} (переброс)`;
  if (result.isCrit) logMsg += ' 🌟 КРИТ!';
  if (result.isFail) logMsg += ' 💀 ПРОВАЛ!';
  logEvent('dice', logMsg);
  window.DND_ONLINE?.sendDice?.(result);
  window.dndOnlineSync?.('dice_reroll');
  const icon = document.getElementById('dice-result-icon');
  const total = document.getElementById('dice-result-total');
  const breakdown = document.getElementById('dice-result-breakdown');
  const label = document.getElementById('dice-result-label');
  icon.classList.add('rolling');
  total.textContent = '...';
  setTimeout(() => {
    icon.classList.remove('rolling');
    total.textContent = result.total;
    total.className = 'dice-result-total';
    label.className = 'dice-result-label';
    if (result.isCrit) {
      total.classList.add('crit');
      label.textContent = '🌟 Критический успех!';
      label.classList.add('crit');
    } else if (result.isFail) {
      total.classList.add('fail');
      label.textContent = '💀 Критический провал!';
      label.classList.add('fail');
    } else {
      label.textContent = `d${result.sides}${result.modifierStr ? ' (' + result.modifierStr + ')' : ''}`;
    }
    breakdown.innerHTML = formatRollResult(result);
  }, 500);
}

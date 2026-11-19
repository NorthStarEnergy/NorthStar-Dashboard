'use strict';

(() => {
 const dialog = $('trainingDialog');
 const overview = $('trainingOverview');
 const exercise = $('trainingExercise');
 const status = $('trainingStatus');
 let archive = [], currentHand = null, drills = [], lastDrill = null, requestNumber = 0;
 const finite = Number.isFinite;
 const amount = n => n.toLocaleString(undefined, {maximumFractionDigits: 2});
 const signed = n => (n > 0 ? '+' : '') + amount(n) + ' BB';
 const streetName = street => street[0].toUpperCase() + street.slice(1);
 const cardText = hand => hand.map(c => c[0].replace('T', '10') + suits[c[1]]).join(' ');
 const frequency = n => (n * 100).toLocaleString(undefined, {maximumFractionDigits: 1}) + '%';

 function actionText(action, hand, spot) {
  if (!action.startsWith('raise:')) return streetName(action);
  const verb = spot.street !== 'preflop' && !spot.call_bb ? 'Bet' : 'Raise to';
  return verb + ' ' + amount(Number(action.slice(6)) / hand.big_blind) + ' BB';
 }

 function button(text, callback) {
  const el = node('button', text, 'button neutral');
  el.type = 'button';
  el.addEventListener('click', callback);
  return el;
 }

 function context(hand, spot) {
  const block = node('div', undefined, 'training-context');
  block.append(node('strong', streetName(spot.street) + ' · ' + (spot.board.length ? cardText(spot.board) : 'No board')),
   node('p', amount(spot.pot_bb) + ' BB pot · ' + amount(spot.call_bb) + ' BB to call · ' + amount(spot.stack_bb) + ' BB behind · ' + spot.live + ' players'));
  const prior = hand.history.slice(0, spot.history_index);
  if (prior.length) {
   const line = node('details');
   line.append(node('summary', 'Action leading to this spot'));
   const list = node('ol');
   for (const e of prior) list.append(node('li', streetName(e.street) + ' · ' + hand.positions[e.seat] + ' · ' + leagueAction(e, prior)));
   line.append(list);
   block.append(line);
  }
  return block;
 }

 function comparison(hand, spot, chosen) {
  const block = node('div', undefined, 'training-comparison');
  const entries = Object.entries(spot.mix || {}).sort((a,b) => b[1] - a[1]);
  if (entries.length) {
   const mix = entries.map(([a,p]) => actionText(a, hand, spot) + ' ' + frequency(p)).join(' · ');
   block.append(node('p', 'Reference mix · ' + mix));
  }
  if (spot.ev && finite(spot.ev[chosen])) {
   const delta = spot.ev[chosen] - spot.reference_ev;
   block.append(node('strong', actionText(chosen, hand, spot) + ' · ' + signed(delta) + ' vs mix'),
    node('p', 'Action EV ' + signed(spot.ev[chosen]) + ' · Reference EV ' + signed(spot.reference_ev)));
   const table = node('table');
   table.setAttribute('aria-label', 'Estimated action values and reference frequencies');
   const headings = table.createTHead().insertRow();
   for (const title of ['Action', 'Mix', 'Est. EV']) {
    const th = node('th', title); th.scope = 'col'; headings.append(th);
   }
   const body = table.createTBody();
   for (const [action,ev] of Object.entries(spot.ev).sort((a,b) => b[1] - a[1])) {
    const row = body.insertRow();
    if (action === chosen) row.className = 'training-chosen';
    row.append(node('td', actionText(action, hand, spot) + (action === chosen ? ' ✓' : '')),
     node('td', frequency(spot.mix[action] || 0)), node('td', signed(ev)));
   }
   block.append(table, node('p', spot.samples + ' paired deals' + (chosen === spot.action ?
    ' · Sampling error of the difference (1 SE) ' + amount(spot.standard_error) + ' BB' : ''), 'small'));
  } else block.append(node('p', 'EV unavailable. ' + (spot.unavailable || '')));
  if (spot.source) block.append(node('p', 'Strategy · ' + spot.source, 'small'));
  return block;
 }

 function handEntry(hand, current) {
  const entry = node('details', undefined, 'training-hand');
  const summary = node('summary');
  const result = finite(hand.net_bb) ? 'Result ' + signed(hand.net_bb) :
   hand.number === current ? 'In progress' : 'Ended early';
  summary.append(node('strong', cardText(hand.hole) + ' · ' + hand.position),
   node('span', 'Hand ' + hand.number + ' · ' + result, 'small'));
  entry.append(summary);
  entry.addEventListener('toggle', () => {
   if (!entry.open || entry.children.length > 1) return;
   if (!hand.decisions.length) entry.append(node('p', 'No decisions recorded for this hand.'));
   for (const spot of hand.decisions) {
    const section = node('section', undefined, 'training-spot');
    section.append(context(hand, spot), node('p', (spot.automatic ? 'Automatic action · ' : 'You played · ') + actionText(spot.action, hand, spot)),
     comparison(hand, spot, spot.action));
    entry.append(section);
   }
  });
  return entry;
 }

 function showOverview() {
  exercise.hidden = true;
  overview.hidden = false;
  $('trainingDrill').focus();
 }

 function practice() {
  const options = drills.length > 1 ? drills.filter(d => d !== lastDrill) : drills;
  if (!options.length) return;
  lastDrill = options[Math.floor(Math.random() * options.length)];
  const {hand, spot} = lastDrill;
  overview.hidden = true;
  exercise.hidden = false;
  const title = node('h3', cardText(hand.hole) + ' · ' + hand.position);
  title.tabIndex = -1;
  const actions = node('div', undefined, 'training-tools');
  const feedback = node('div');
  function answer(chosen) {
   actions.replaceChildren();
   feedback.replaceChildren(comparison(hand, spot, chosen));
   feedback.tabIndex = -1;
   feedback.focus();
   if (drills.length > 1) feedback.append(button('Next spot', practice));
  }
  // Keep the answer order independent of EV and frequency.
  for (const a of Object.keys(spot.ev).sort((a,b) => a.localeCompare(b, undefined, {numeric:true}))) {
   actions.append(button(actionText(a, hand, spot), () => answer(a)));
  }
  exercise.replaceChildren(button('← Hand history', showOverview), title, context(hand, spot),
   node('p', 'Which action would you take?'), actions, feedback);
  title.focus();
 }

 function renderHistory() {
   const street = $('trainingStreet').value;
   const hands = street ? archive.map(hand => ({...hand, decisions:hand.decisions.filter(d => d.street === street)}))
    .filter(hand => hand.decisions.length) : archive;
   const spots = hands.flatMap(hand => hand.decisions.map(spot => ({hand, spot})));
   const rated = spots.filter(({spot}) => !spot.automatic && finite(spot.delta));
   drills = spots.filter(({spot}) => spot.ev && Object.keys(spot.ev).length > 1);
   lastDrill = null;
   const metrics = $('trainingMetrics');
   metrics.replaceChildren();
   for (const [label,value] of [['Hands',hands.length], ['Rated decisions',rated.length],
    ['Avg. EV vs mix',rated.length ? signed(rated.reduce((sum,d) => sum + d.spot.delta, 0) / rated.length) : '—']]) {
    const tile = node('div'); tile.append(node('strong', value), node('span', label)); metrics.append(tile);
   }
   $('trainingHands').replaceChildren(...hands.map(hand => handEntry(hand, currentHand)));
   if (!hands.length) $('trainingHands').append(node('p', 'No recorded decisions on this street yet.'));
   $('trainingDrill').disabled = !drills.length;
   overview.hidden = false;
 }

 async function load() {
  const request = ++requestNumber;
  overview.hidden = exercise.hidden = true;
  status.textContent = 'Loading your hands…';
  try {
   const {hands, current} = await api('/api/training');
   if (request !== requestNumber || !dialog.open) return;
   status.textContent = hands.length ? '' : 'Play a cash or study hand to start your training history.';
   archive = hands;
   currentHand = current;
   if (hands.length) renderHistory();
  } catch {
   if (request === requestNumber && dialog.open) status.replaceChildren('Could not load your training history. ', button('Try again', load));
  }
 }

 for (const opener of document.querySelectorAll('[data-open-training]')) opener.addEventListener('click', () => {
  $('mainMenu').open = false;
  dialog.showModal();
  scheduleNext();
  load();
 });
 $('trainingDrill').addEventListener('click', practice);
 $('trainingStreet').addEventListener('change', renderHistory);
 $('trainingClose').addEventListener('click', () => dialog.close());
 dialog.addEventListener('close', () => {
  ++requestNumber;
  archive = []; drills = []; lastDrill = null;
  $('trainingStreet').value = '';
  $('trainingHands').replaceChildren(); exercise.replaceChildren();
  scheduleNext();
 });
 window.addEventListener('northstar:games-account-change', () => { if (dialog.open) dialog.close(); });
})();

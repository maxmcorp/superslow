import {
  COUNTDOWN_FROM,
  DEFAULT_LAST_CALLOUT,
  GOOD_FROM,
  events,
  lastCallout,
  spokenNumbers,
  verdict,
} from './schedule.js';
import { createStore } from './store.js';
import { createVoice } from './audio.js';
import { createWakeLock } from './wakelock.js';

const $ = (id) => document.getElementById(id);

// "10" sounds this long after Start is tapped, so it can be queued on time.
const LEAD_SECONDS = 0.3;
// The track under the clock runs from 0 to this many seconds.
const TRACK_SECONDS = 120;
// Done reacts the moment the finger lands, so the rest of that tap would hit the result
// screen's buttons. Taps there are ignored for this long.
const TAP_GUARD_MS = 700;
// The select options that open the new-exercise, new-group and edit-group forms, and the
// one that lists every exercise.
const NEW_EXERCISE = '\u0000new';
const NEW_GROUP = '\u0000new-group';
const EDIT_GROUP = '\u0000edit-group';
const ALL = '\u0000all';

const VERDICT = { heavy: 'Too heavy', good: 'Good', light: 'Too light' };
const ADVICE = { heavy: 'Go lighter next time.', good: 'Keep this weight.', light: 'Go heavier next time.' };
const LAST_ADVICE = { heavy: 'Too heavy, go lighter.', good: 'Good, keep this weight.', light: 'Too light, go heavier.' };

const store = createStore(localStorage);
const voice = createVoice();
const wakeLock = createWakeLock((held) =>
  showBanner(held ? '' : 'The screen may lock during a set. Set Auto-Lock to Never in Settings, Display & Brightness.'),
);

let screen = 'start';
// The set in progress: { exercise, weightKg, zeroAt, frame }. zeroAt is the performance.now() of "0".
let run = null;
// The set just finished, so the result screen can delete it.
let savedSet = null;
let last = DEFAULT_LAST_CALLOUT;
let tapsAllowedAt = 0;
// The start screen's group: a group's name, or ALL.
let group = ALL;
let historyExercise = null;
// The exercise the weight field is for, so a weight is never carried over to another one.
let weightExercise = null;
// The day the start screen's ticks were drawn for.
let tickedDay = null;

// Formatting

const kgFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, useGrouping: false });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function kg(weightKg) {
  return weightKg === null ? 'no weight' : `${kgFormat.format(weightKg)} kg`;
}

function describe(exercise, weightKg) {
  return weightKg === null ? exercise : `${exercise}, ${kg(weightKg)}`;
}

// '' is no weight (null); text that isn't a weight is undefined. Accepts "42,5" as well as "42.5".
function parseWeight(text) {
  const clean = text.trim().replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
}

function listNumbers(numbers) {
  return numbers.length <= 6 ? numbers.join(', ') : `${numbers.slice(0, 5).join(', ')} and ${numbers.length - 5} more`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// The local calendar day, as 2026-10-20.
function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function doneToday(exercise) {
  const previous = store.lastSet(exercise);
  return Boolean(previous) && dayKey(new Date(previous.at)) === dayKey(new Date());
}

// Screens

function show(name) {
  for (const section of document.querySelectorAll('.screen')) section.hidden = section.id !== `screen-${name}`;
  document.body.dataset.screen = name;
  screen = name;
  window.scrollTo(0, 0);
}

function guarded(handler) {
  return (event) => {
    if (performance.now() >= tapsAllowedAt) handler(event);
  };
}

function showBanner(text) {
  $('banner').textContent = text;
  $('banner').hidden = !text;
}

function setText(id, text) {
  const element = $(id);
  if (element.textContent !== String(text)) element.textContent = text;
}

// The first tap arms a delete button, showing armedText(), and a second tap within 3 s runs
// the action. Returns a function that disarms it, for when what it would delete changes.
function confirmTap(button, armedText, action) {
  const text = button.textContent;
  let timer = 0;
  const disarm = () => {
    clearTimeout(timer);
    button.classList.remove('armed');
    button.textContent = text;
  };
  button.addEventListener('click', () => {
    if (!button.classList.contains('armed')) {
      button.classList.add('armed');
      button.textContent = armedText();
      timer = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    action();
  });
  return disarm;
}

// Start screen

function renderStart({ fillWeight }) {
  const current = store.lastExercise ?? store.exercises[0] ?? null;
  group = store.lastGroup ?? ALL;
  // An exercise can be in several groups: stay in the last one picked if it has the exercise.
  if (current && !groupExercises().includes(current)) group = store.groupsOf(current)[0] ?? ALL;
  renderGroups();
  renderExercises(current);
  if (fillWeight || current !== weightExercise) fillWeightFor(current);
  renderLast(current);
}

function groupExercises() {
  return group === ALL ? store.exercises : store.exercisesIn(group);
}

// The first exercise in the start screen's group not done today, or null if all are.
function nextExercise() {
  return groupExercises().find((name) => !doneToday(name)) ?? null;
}

function renderGroups() {
  $('group').replaceChildren(
    ...store.groups.map((name) => new Option(name, name)),
    new Option('All exercises', ALL),
    new Option('+ Add group', NEW_GROUP),
    ...(group === ALL ? [] : [new Option(`Rename or delete ${group}`, EDIT_GROUP)]),
  );
  $('group').value = group;
  $('group-field').hidden = false;
  $('new-group').hidden = true;
  $('edit-group').hidden = true;
}

// Shows the new-group or edit-group form in place of the group and exercise fields.
function openGroupForm(form) {
  for (const id of ['group-field', 'exercise-field', 'new-exercise', 'new-group', 'edit-group']) {
    $(id).hidden = id !== form;
  }
  $(`${form}-name`).focus();
}

// Exercises done today are ticked. A group without exercises opens the new-exercise form.
function renderExercises(current) {
  const exercises = groupExercises();
  $('exercise').replaceChildren(
    ...exercises.map((name) => new Option(doneToday(name) ? `${name} ✓` : name, name)),
    new Option('+ Add exercise', NEW_EXERCISE),
  );
  tickedDay = dayKey(new Date());
  if (current) $('exercise').value = current;
  $('exercise-field').hidden = exercises.length === 0;
  $('new-exercise').hidden = exercises.length > 0;
  $('new-exercise-cancel').hidden = exercises.length === 0;
}

// Shows a group and selects its first exercise not done today.
function chooseGroup(name) {
  group = name;
  store.selectGroup(name === ALL ? null : name);
  const first = nextExercise() ?? groupExercises()[0] ?? null;
  if (first) store.selectExercise(first);
  renderGroups();
  renderExercises(first);
  fillWeightFor(first);
  renderLast(first);
}

function fillWeightFor(exercise) {
  weightExercise = exercise;
  const weightKg = exercise ? store.lastSet(exercise)?.weightKg : null;
  $('weight').value = weightKg === null || weightKg === undefined ? '' : kgFormat.format(weightKg);
}

function renderLast(exercise) {
  const line = $('last');
  const previous = exercise ? store.lastSet(exercise) : null;
  if (!exercise) {
    line.textContent = 'Add the exercise you are about to do.';
  } else if (!previous) {
    line.textContent = 'First set of this exercise.';
  } else {
    const strong = document.createElement('strong');
    strong.textContent = `${kg(previous.weightKg)}, ${previous.seconds} s`;
    line.replaceChildren('Last time ', strong, `. ${LAST_ADVICE[verdict(previous.seconds)]}`);
  }
}

function showMessage(text) {
  $('start-message').textContent = text;
}

// Adds the exercise typed into the new-exercise form, also to the start screen's group, and
// selects it. An existing exercise keeps its other groups. Returns its name, or null if none was typed.
function addTypedExercise() {
  const name = store.addExercise($('new-exercise-name').value);
  if (!name) return null;
  if (group !== ALL) store.addToGroup(name, group);
  $('new-exercise-name').value = '';
  store.selectExercise(name);
  // The form starts with an empty weight, so one typed there is for this exercise. Without one,
  // an existing exercise gets its last weight.
  if ($('weight').value.trim()) weightExercise = name;
  else fillWeightFor(name);
  return name;
}

// The exercise to start: the selected one, or the one typed into the new-exercise form.
function currentExercise() {
  if (groupFormOpen()) return null;
  if (!$('new-exercise').hidden) {
    const name = addTypedExercise();
    if (name) renderStart({ fillWeight: false });
    return name;
  }
  const value = $('exercise').value;
  return value && value !== NEW_EXERCISE ? value : null;
}

function groupFormOpen() {
  return !$('new-group').hidden || !$('edit-group').hidden;
}

$('group').addEventListener('change', (event) => {
  const value = event.target.value;
  showMessage('');
  if (value === NEW_GROUP) {
    openGroupForm('new-group');
  } else if (value === EDIT_GROUP) {
    $('edit-group-name').value = group;
    disarmDeleteGroup();
    openGroupForm('edit-group');
  } else {
    chooseGroup(value);
  }
});

$('new-group').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = store.addGroup($('new-group-name').value);
  if (!name) {
    showMessage('Type a name for the group.');
    return;
  }
  $('new-group-name').value = '';
  $('new-group-name').blur();
  showMessage('');
  chooseGroup(name);
});

$('new-group-cancel').addEventListener('click', () => {
  $('new-group-name').value = '';
  showMessage('');
  renderStart({ fillWeight: false });
});

$('exercise').addEventListener('change', (event) => {
  const value = event.target.value;
  showMessage('');
  if (value === NEW_EXERCISE) {
    $('exercise-field').hidden = true;
    $('new-exercise').hidden = false;
    // The shown weight and last time were for the previous exercise.
    fillWeightFor(null);
    renderLast(null);
    $('new-exercise-name').focus();
    return;
  }
  store.selectExercise(value);
  fillWeightFor(value);
  renderLast(value);
});

$('new-exercise').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!addTypedExercise()) {
    showMessage('Type a name for the exercise.');
    return;
  }
  $('new-exercise-name').blur();
  showMessage('');
  renderStart({ fillWeight: false });
});

$('new-exercise-cancel').addEventListener('click', () => {
  $('new-exercise-name').value = '';
  showMessage('');
  renderStart({ fillWeight: false });
});

$('edit-group').addEventListener('submit', (event) => {
  event.preventDefault();
  const typed = $('edit-group-name').value;
  const name = store.renameGroup(group, typed);
  if (!name) {
    showMessage(typed.trim() ? 'There is already a group with that name.' : 'Type a name for the group.');
    return;
  }
  $('edit-group-name').blur();
  showMessage('');
  renderStart({ fillWeight: false });
});

$('edit-group-cancel').addEventListener('click', () => {
  showMessage('');
  renderStart({ fillWeight: false });
});

const disarmDeleteGroup = confirmTap(
  $('delete-group'),
  () => 'Tap again to delete',
  () => {
    const name = group;
    store.deleteGroup(name);
    renderStart({ fillWeight: false });
    showMessage(`Deleted ${name}. Its exercises are still in All exercises.`);
  },
);

$('weight').addEventListener('focus', (event) => event.target.select());
$('weight').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') event.target.blur();
});

$('open-history').addEventListener('click', () => openHistory(store.lastExercise));

// Countdown and set

$('start-button').addEventListener('click', () => {
  const exercise = currentExercise();
  if (!exercise) {
    showMessage(groupFormOpen() ? 'Finish the group first, or tap Cancel.' : 'Add an exercise first.');
    return;
  }
  const weightKg = parseWeight($('weight').value);
  if (weightKg === undefined) {
    showMessage('Weight must be a number, like 42.5.');
    return;
  }
  showMessage('');
  document.activeElement?.blur();

  voice.unlock();
  wakeLock.acquire();
  store.selectExercise(exercise);
  savedSet = null;
  run = { exercise, weightKg, zeroAt: performance.now() + (COUNTDOWN_FROM + LEAD_SECONDS) * 1000, frame: 0 };
  voice.start(events(last), run.zeroAt);

  $('countdown-context').textContent = describe(exercise, weightKg);
  $('set-context').textContent = describe(exercise, weightKg);
  setText('countdown-number', COUNTDOWN_FROM);
  setText('set-seconds', 0);
  $('marker').style.setProperty('--progress', 0);
  document.body.dataset.zone = 'none';
  show('countdown');
  frame();
});

function frame() {
  if (!run) return;
  const elapsed = (performance.now() - run.zeroAt) / 1000;
  if (elapsed < 0) {
    setText('countdown-number', Math.min(COUNTDOWN_FROM, Math.ceil(-elapsed)));
  } else {
    if (screen !== 'set') show('set');
    const seconds = Math.floor(elapsed);
    setText('set-seconds', seconds);
    document.body.dataset.zone = seconds < GOOD_FROM ? 'none' : verdict(seconds);
    $('marker').style.setProperty('--progress', Math.min(elapsed / TRACK_SECONDS, 1));
  }
  run.frame = requestAnimationFrame(frame);
}

function endRun() {
  voice.stop();
  wakeLock.release();
  cancelAnimationFrame(run.frame);
  run = null;
  document.body.dataset.zone = 'none';
}

$('cancel-button').addEventListener('click', () => {
  if (run) endRun();
  show('start');
});

// The time is taken the moment the finger lands; click covers keyboards.
function finish() {
  if (!run || screen !== 'set') return;
  const seconds = Math.max(0, Math.floor((performance.now() - run.zeroAt) / 1000));
  const { exercise, weightKg } = run;
  endRun();
  savedSet = store.addSet({ exercise, weightKg, seconds });
  renderResult(savedSet);
  tapsAllowedAt = performance.now() + TAP_GUARD_MS;
  show('result');
}

$('done-button').addEventListener('pointerdown', finish);
$('done-button').addEventListener('click', finish);

// Back in the app. Callouts queued before it went to the background would play late, so the
// rest of the set is scheduled again from "0"; ticks drawn yesterday are redrawn.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (run) {
    voice.resume();
    voice.start(events(last), run.zeroAt);
  } else if (screen === 'start' && tickedDay !== dayKey(new Date())) {
    renderStart({ fillWeight: false });
  }
});

// Result

function renderResult(set) {
  const result = verdict(set.seconds);
  document.body.dataset.verdict = result;
  $('result-seconds').textContent = set.seconds;
  $('result-verdict').textContent = VERDICT[result];
  $('result-context').textContent = describe(set.exercise, set.weightKg);
  $('result-advice').textContent = ADVICE[result];
}

// Moves on to the group's next exercise not done today; any other can still be picked.
$('next-button').addEventListener(
  'click',
  guarded(() => {
    const next = nextExercise();
    if (next) store.selectExercise(next);
    renderStart({ fillWeight: true });
    show('start');
  }),
);

$('delete-button').addEventListener(
  'click',
  guarded(() => {
    if (savedSet) store.deleteSet(savedSet.id);
    savedSet = null;
    renderStart({ fillWeight: true });
    showMessage('Set deleted.');
    show('start');
  }),
);

$('result-history').addEventListener(
  'click',
  guarded(() => openHistory(savedSet?.exercise ?? store.lastExercise)),
);

// History

function openHistory(exercise) {
  historyExercise = exercise ?? store.lastExercise ?? store.exercises[0] ?? null;
  $('backup-status').textContent = '';
  renderHistory();
  show('history');
}

// Every exercise, under its group's name once there are groups.
function exerciseOptions() {
  const options = (names) => names.map((name) => new Option(name, name));
  const groups = store.groups;
  if (!groups.length) return options(store.exercises);
  return [...groups, null]
    .map((name) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = name ?? 'No group';
      optgroup.append(...options(store.exercisesIn(name)));
      return optgroup;
    })
    .filter((optgroup) => optgroup.children.length > 0);
}

function renderHistory() {
  const select = $('history-exercise');
  select.replaceChildren(...exerciseOptions());
  if (historyExercise) select.value = historyExercise;
  $('history-group-list').replaceChildren(...store.groups.map(groupCheck));
  $('history-groups').hidden = !historyExercise || store.groups.length === 0;
  const sets = historyExercise ? store.setsFor(historyExercise) : [];

  const days = new Map();
  for (const set of sets) {
    const when = new Date(set.at);
    const key = dayKey(when);
    if (!days.has(key)) days.set(key, { label: dayFormat.format(when), sets: [] });
    days.get(key).sets.push(set);
  }

  $('history-list').replaceChildren(
    ...[...days.values()].map((day) => {
      const block = document.createElement('section');
      block.className = 'day';
      const heading = document.createElement('h3');
      heading.textContent = day.label;
      const list = document.createElement('ol');
      list.append(...day.sets.map(historyEntry));
      block.append(heading, list);
      return block;
    }),
  );
  $('history-empty').hidden = sets.length > 0;
  $('exercise-actions').hidden = !historyExercise;
  $('rename-form').hidden = true;
  disarmDeleteExercise();
}

// A checkbox that puts the shown exercise in a group or takes it out.
function groupCheck(name) {
  const label = document.createElement('label');
  label.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = store.groupsOf(historyExercise).includes(name);
  box.addEventListener('change', () => {
    if (box.checked) store.addToGroup(historyExercise, name);
    else store.removeFromGroup(historyExercise, name);
    renderHistory();
  });
  label.append(box, name);
  return label;
}

function historyEntry(set) {
  const item = document.createElement('li');
  item.className = `entry ${verdict(set.seconds)}`;
  const when = document.createElement('span');
  when.className = 'when';
  when.textContent = timeFormat.format(new Date(set.at));
  const weight = document.createElement('span');
  weight.textContent = kg(set.weightKg);
  const seconds = document.createElement('span');
  seconds.className = 'secs';
  seconds.textContent = `${set.seconds} s`;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete';
  remove.textContent = '✕';
  remove.setAttribute('aria-label', 'Delete set');
  confirmTap(
    remove,
    () => 'Delete',
    () => {
      store.deleteSet(set.id);
      if (savedSet?.id === set.id) savedSet = null;
      renderHistory();
    },
  );
  item.append(when, weight, seconds, remove);
  return item;
}

$('history-exercise').addEventListener('change', (event) => {
  historyExercise = event.target.value;
  renderHistory();
});

$('rename-exercise').addEventListener('click', () => {
  $('rename-exercise-name').value = historyExercise;
  $('rename-message').textContent = '';
  $('exercise-actions').hidden = true;
  $('rename-form').hidden = false;
  $('rename-exercise-name').focus();
});

// The sets keep their objects, so savedSet follows the new name too.
$('rename-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const typed = $('rename-exercise-name').value;
  const name = store.renameExercise(historyExercise, typed);
  if (!name) {
    $('rename-message').textContent = typed.trim()
      ? 'There is already an exercise with that name.'
      : 'Type a name for the exercise.';
    return;
  }
  $('rename-exercise-name').blur();
  if (weightExercise === historyExercise) weightExercise = name;
  historyExercise = name;
  renderHistory();
});

$('rename-cancel').addEventListener('click', renderHistory);

const disarmDeleteExercise = confirmTap(
  $('delete-exercise'),
  () => {
    const count = store.setsFor(historyExercise).length;
    return count === 0 ? 'Tap again to delete' : `Tap again to delete it and ${count === 1 ? '1 set' : `${count} sets`}`;
  },
  () => {
    store.deleteExercise(historyExercise);
    if (savedSet?.exercise === historyExercise) savedSet = null;
    historyExercise = store.exercises[0] ?? null;
    renderHistory();
  },
);

$('history-back').addEventListener('click', () => {
  renderStart({ fillWeight: false });
  show('start');
});

function today() {
  return dayKey(new Date());
}

function backupStatus(text) {
  $('backup-status').textContent = text;
}

// Hands a file to the iOS share sheet (Save to Files, AirDrop, Mail), or downloads it
// where sharing files isn't supported.
async function exportFile(name, type, text) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      backupStatus(`Exported ${name}.`);
    } catch (error) {
      if (error.name !== 'AbortError') backupStatus(`Export failed: ${error.message}`);
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  backupStatus(`Downloaded ${name}.`);
}

$('export-csv').addEventListener('click', () => exportFile(`superslow-${today()}.csv`, 'text/csv', store.toCSV()));
$('export-json').addEventListener('click', () =>
  exportFile(`superslow-backup-${today()}.json`, 'application/json', store.toJSON()),
);

$('import-json').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const { added } = store.importJSON(await file.text());
    backupStatus(added === 1 ? 'Restored 1 set.' : `Restored ${added} sets.`);
    historyExercise ??= store.exercises[0] ?? null;
    renderHistory();
  } catch {
    backupStatus(`${file.name} is not a Superslow backup.`);
  }
});

// Startup

// iPhones (and iPads, which report themselves as Macs with touch) mute the callouts
// with the ring/silent switch; elsewhere it is the media volume.
const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
if (isApple) $('volume-note').textContent = 'Ring switch on, or the callouts are silent.';

renderStart({ fillWeight: true });
show('start');

voice.load().then((available) => {
  last = lastCallout(available);
  const needed = spokenNumbers(last);
  const missing = needed.filter((n) => !available.includes(n));
  if (!missing.length) return;
  $('sound-note').textContent =
    missing.length === needed.length
      ? 'No recorded numbers yet, so beeps play instead.'
      : `Beeps play for ${listNumbers(missing)}: no recording yet.`;
  $('sound-note').hidden = false;
});

navigator.storage?.persist?.();

// Offline support. Only over https, so local testing always loads fresh files.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('sw.js');
  // A new version took over: reload, but never in the middle of a set.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && screen === 'start' && !run) location.reload();
  });
}

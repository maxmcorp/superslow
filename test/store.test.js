import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../store.js';

function memoryStorage(initial = {}) {
  const items = { ...initial };
  return {
    getItem: (k) => (k in items ? items[k] : null),
    setItem: (k, v) => {
      items[k] = String(v);
    },
  };
}

test('exercises are trimmed and de-duplicated ignoring case', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.addExercise('  Leg   press '), 'Leg press');
  assert.equal(store.addExercise('leg press'), 'Leg press');
  assert.equal(store.addExercise('   '), null);
  assert.deepEqual(store.exercises, ['Leg press']);
});

test('the log survives a reload', () => {
  const storage = memoryStorage();
  const first = createStore(storage);
  first.addExercise('Chest press');
  first.addSet({ exercise: 'Chest press', weightKg: 42.5, seconds: 72 });
  const again = createStore(storage);
  assert.deepEqual(again.exercises, ['Chest press']);
  assert.equal(again.lastExercise, 'Chest press');
  assert.equal(again.lastSet('Chest press').weightKg, 42.5);
});

test('the last set is the newest one for that exercise', () => {
  const store = createStore(memoryStorage());
  store.addExercise('Row');
  store.addExercise('Squat');
  store.addSet({ exercise: 'Row', weightKg: 30, seconds: 50, at: '2026-10-01T10:00:00.000Z' });
  store.addSet({ exercise: 'Row', weightKg: 27.5, seconds: 66, at: '2026-10-08T10:00:00.000Z' });
  store.addSet({ exercise: 'Squat', weightKg: 60, seconds: 95, at: '2026-10-09T10:00:00.000Z' });
  assert.equal(store.lastSet('Row').weightKg, 27.5);
  assert.deepEqual(store.setsFor('Row').map((s) => s.seconds), [66, 50]);
  assert.equal(store.lastSet('Bench'), null);
});

test('a deleted set is gone', () => {
  const store = createStore(memoryStorage());
  store.addExercise('Row');
  const set = store.addSet({ exercise: 'Row', weightKg: 30, seconds: 12 });
  assert.equal(store.deleteSet(set.id), true);
  assert.equal(store.lastSet('Row'), null);
  assert.equal(store.deleteSet(set.id), false);
});

test('a deleted exercise takes its sets and group places with it', () => {
  const store = createStore(memoryStorage());
  store.addGroup('Pull');
  store.addExercise('Row');
  store.addExercise('Pulldown');
  store.addToGroup('Row', 'Pull');
  store.addSet({ exercise: 'Row', weightKg: 30, seconds: 70 });
  store.addSet({ exercise: 'Pulldown', weightKg: 40, seconds: 65 });
  assert.equal(store.deleteExercise('Row'), true);
  assert.equal(store.deleteExercise('Row'), false);
  assert.deepEqual(store.exercises, ['Pulldown']);
  assert.deepEqual(store.setsFor('Row'), []);
  assert.equal(store.lastSet('Pulldown').seconds, 65);
  assert.deepEqual(store.exercisesIn('Pull'), []);
  assert.equal(store.lastExercise, 'Pulldown');
});

test("a renamed exercise keeps its sets and groups, but can't take another exercise's name", () => {
  const store = createStore(memoryStorage());
  store.addGroup('Legs');
  store.addExercise('Legpress');
  store.addExercise('Squat');
  store.addToGroup('Legpress', 'Legs');
  store.addSet({ exercise: 'Legpress', weightKg: 80, seconds: 70 });
  assert.equal(store.renameExercise('Legpress', ' Leg  press '), 'Leg press');
  assert.deepEqual(store.exercises, ['Leg press', 'Squat']);
  assert.equal(store.lastSet('Leg press').weightKg, 80);
  assert.deepEqual(store.setsFor('Legpress'), []);
  assert.deepEqual(store.exercisesIn('Legs'), ['Leg press']);
  assert.equal(store.lastExercise, 'Leg press');
  assert.equal(store.renameExercise('Leg press', 'leg PRESS'), 'leg PRESS');
  assert.equal(store.renameExercise('leg PRESS', 'squat'), null);
  assert.equal(store.renameExercise('leg PRESS', '  '), null);
  assert.equal(store.renameExercise('Bench', 'Row'), null);
  assert.deepEqual(store.exercises, ['leg PRESS', 'Squat']);
});

test('broken saved data starts a fresh log, and a copy of it is kept', () => {
  const storage = memoryStorage({ 'superslow.v1': '{not json' });
  const store = createStore(storage);
  assert.deepEqual(store.exercises, []);
  store.addExercise('Row');
  assert.equal(storage.getItem('superslow.v1.unreadable'), '{not json');
});

test('saved entries that would break the app are dropped, and the original is kept aside', () => {
  const good = { id: 'a', exercise: 'Row', weightKg: 30, seconds: 70, at: '2026-10-01T10:00:00.000Z' };
  const saved = JSON.stringify({
    exercises: [7, 'Row', ' '],
    groups: [null, { name: 'Pull', exercises: ['Row', 7, 'Ghost'] }],
    sets: [good, { ...good, id: 'b', at: 'yesterday' }, null],
    lastExercise: 5,
    lastGroup: 'Pull',
  });
  const storage = memoryStorage({ 'superslow.v1': saved });
  const store = createStore(storage);
  assert.deepEqual(store.exercises, ['Row']);
  assert.deepEqual(store.groups, ['Pull']);
  assert.deepEqual(store.exercisesIn('Pull'), ['Row']);
  assert.deepEqual(store.setsFor('Row').map((s) => s.id), ['a']);
  assert.equal(store.lastExercise, null);
  assert.equal(store.lastGroup, 'Pull');
  assert.equal(storage.getItem('superslow.v1.unreadable'), saved);

  const nullGroups = memoryStorage({ 'superslow.v1': JSON.stringify({ exercises: ['Row'], groups: null, sets: [] }) });
  assert.deepEqual(createStore(nullGroups).groups, []);
});

test('repeats in a saved log are read once, so deleting a set deletes only that one', () => {
  const set = { id: 'x', exercise: 'Row', weightKg: 30, seconds: 70, at: '2026-10-01T10:00:00.000Z' };
  const saved = JSON.stringify({
    exercises: ['Row', 'Row', 'Squat'],
    groups: [
      { name: 'Pull', exercises: ['Row', 'Row'] },
      { name: 'pull', exercises: ['Squat'] },
    ],
    sets: [set, { ...set, seconds: 80 }, { ...set, id: 'y', seconds: 65, at: '2026-10-02T10:00:00.000Z' }],
  });
  const storage = memoryStorage({ 'superslow.v1': saved });
  const store = createStore(storage);
  assert.deepEqual(store.exercises, ['Row', 'Squat']);
  assert.deepEqual(store.groups, ['Pull']);
  assert.deepEqual(store.exercisesIn('Pull'), ['Row']);
  assert.deepEqual(store.setsFor('Row').map((s) => s.seconds), [65, 70]);
  store.deleteSet('x');
  assert.deepEqual(store.setsFor('Row').map((s) => s.id), ['y']);
  assert.equal(storage.getItem('superslow.v1.unreadable'), saved);
});

test('a saved list that is not a list is dropped with a copy kept, but a missing one is not', () => {
  const storage = memoryStorage({ 'superslow.v1': JSON.stringify({ exercises: ['Row'], groups: {}, sets: [] }) });
  assert.deepEqual(createStore(storage).groups, []);
  assert.notEqual(storage.getItem('superslow.v1.unreadable'), null);
});

test('a sound log, old or new, is read as it is with no copy kept aside', () => {
  const old = memoryStorage({ 'superslow.v1': JSON.stringify({ exercises: ['Row'], sets: [], lastExercise: 'Row' }) });
  assert.equal(createStore(old).lastExercise, 'Row');
  assert.equal(old.getItem('superslow.v1.unreadable'), null);
  const storage = memoryStorage();
  const store = createStore(storage);
  store.addGroup('Pull');
  store.addExercise('Row');
  store.addToGroup('Row', 'Pull');
  store.addSet({ exercise: 'Row', weightKg: null, seconds: 61 });
  createStore(storage);
  assert.equal(storage.getItem('superslow.v1.unreadable'), null);
});

test('a backup restores into an empty log, and restoring twice adds nothing', () => {
  const source = createStore(memoryStorage());
  source.addExercise('Row');
  source.addExercise('Pulldown');
  source.addSet({ exercise: 'Row', weightKg: 30, seconds: 70 });
  source.addSet({ exercise: 'Row', weightKg: null, seconds: 81 });
  const backup = source.toJSON();

  const target = createStore(memoryStorage());
  assert.deepEqual(target.importJSON(backup), { added: 2 });
  assert.deepEqual(target.exercises, ['Row', 'Pulldown']);
  assert.deepEqual(target.setsFor('Row').map((s) => s.seconds).sort(), [70, 81]);
  assert.deepEqual(target.importJSON(backup), { added: 0 });
});

test('restoring matches exercise names ignoring case', () => {
  const target = createStore(memoryStorage());
  target.addExercise('Leg press');
  const backup = JSON.stringify({
    app: 'superslow',
    exercises: ['leg press'],
    sets: [{ id: 'a', exercise: 'leg press', weightKg: 80, seconds: 65, at: '2026-10-01T10:00:00.000Z' }],
  });
  target.importJSON(backup);
  assert.deepEqual(target.exercises, ['Leg press']);
  assert.equal(target.lastSet('Leg press').seconds, 65);
});

test('restoring tidies names the way typed names are, so nothing is duplicated or orphaned', () => {
  const target = createStore(memoryStorage());
  target.addExercise('Leg press');
  const backup = JSON.stringify({
    app: 'superslow',
    exercises: [' Leg press ', 'Calf  raise'],
    groups: [{ name: ' Legs ', exercises: [' leg press', 'calf raise '] }],
    sets: [
      { id: 'a', exercise: ' leg  press ', weightKg: 80, seconds: 65, at: '2026-10-01T10:00:00.000Z' },
      { id: 'b', exercise: 'Calf raise', weightKg: 20, seconds: 70, at: '2026-10-01T10:05:00.000Z' },
    ],
  });
  assert.deepEqual(target.importJSON(backup), { added: 2 });
  assert.deepEqual(target.exercises, ['Leg press', 'Calf raise']);
  assert.deepEqual(target.groups, ['Legs']);
  assert.deepEqual(target.exercisesIn('Legs'), ['Leg press', 'Calf raise']);
  assert.equal(target.lastSet('Leg press').seconds, 65);
  assert.equal(target.lastSet('Calf raise').seconds, 70);
});

test('restoring skips sets with bad dates or numbers, and repeated ids', () => {
  const target = createStore(memoryStorage());
  const set = (id, fields) => ({ id, exercise: 'Row', weightKg: 30, seconds: 70, at: '2026-10-01T10:00:00.000Z', ...fields });
  const backup = JSON.stringify({
    app: 'superslow',
    sets: [
      set('ok', {}),
      set('ok', { seconds: 99 }),
      set('date', { at: 'yesterday' }),
      set('secs', { seconds: -5 }),
      set('kg', { weightKg: -1 }),
      set('blank', { exercise: '  ' }),
      set('plain-date', { at: '2026-10-02' }),
    ],
  });
  assert.deepEqual(target.importJSON(backup), { added: 2 });
  assert.deepEqual(target.setsFor('Row').map((s) => s.id), ['plain-date', 'ok']);
  assert.equal(target.lastSet('Row').at, '2026-10-02T00:00:00.000Z');
  assert.deepEqual(target.importJSON(JSON.stringify({ app: 'superslow', exercises: 'Row', sets: [] })), { added: 0 });
});

test('a file that is not a backup is refused', () => {
  const store = createStore(memoryStorage());
  assert.throws(() => store.importJSON('hello'), /not-a-backup/);
  assert.throws(() => store.importJSON('{"sets": []}'), /not-a-backup/);
});

test('CSV has a header and one row per set, oldest first, with quoted names', () => {
  const store = createStore(memoryStorage());
  store.addExercise('Press, seated');
  store.addSet({ exercise: 'Press, seated', weightKg: 20, seconds: 95, at: '2026-10-02T10:00:00.000Z' });
  store.addSet({ exercise: 'Press, seated', weightKg: null, seconds: 55, at: '2026-10-01T10:00:00.000Z' });
  const lines = store.toCSV().trim().split('\n');
  assert.equal(lines[0], 'date,time,exercise,weight_kg,seconds,verdict');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /,"Press, seated",,55,heavy$/);
  assert.match(lines[2], /,"Press, seated",20,95,light$/);
});

test('an exercise can be in several groups, and the rest are in no group', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.addGroup(' Push '), 'Push');
  assert.equal(store.addGroup('push'), 'Push');
  assert.equal(store.addGroup('  '), null);
  store.addGroup('Pull');
  store.addGroup('Legs');
  for (const name of ['Chest press', 'Deadlift', 'Calf raise']) store.addExercise(name);
  store.addToGroup('Chest press', 'Push');
  store.addToGroup('Deadlift', 'Pull');
  store.addToGroup('Deadlift', 'Legs');
  store.addToGroup('Deadlift', 'Legs');
  assert.deepEqual(store.groups, ['Push', 'Pull', 'Legs']);
  assert.deepEqual(store.exercisesIn('Pull'), ['Deadlift']);
  assert.deepEqual(store.exercisesIn('Legs'), ['Deadlift']);
  assert.deepEqual(store.groupsOf('Deadlift'), ['Pull', 'Legs']);
  assert.deepEqual(store.exercisesIn(null), ['Calf raise']);
  store.removeFromGroup('Deadlift', 'Pull');
  assert.deepEqual(store.groupsOf('Deadlift'), ['Legs']);
  store.removeFromGroup('Deadlift', 'Legs');
  assert.deepEqual(store.exercisesIn(null), ['Deadlift', 'Calf raise']);
});

test('the last group picked is remembered, renamed with it, and forgotten when it is deleted', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  assert.equal(store.lastGroup, null);
  store.addGroup('Legs');
  store.selectGroup('Legs');
  assert.equal(createStore(storage).lastGroup, 'Legs');
  store.renameGroup('Legs', 'Lower');
  assert.equal(store.lastGroup, 'Lower');
  store.deleteGroup('Lower');
  assert.equal(store.lastGroup, null);
  store.addGroup('Lower');
  assert.equal(store.lastGroup, null);
});

test("a group can be renamed, but not to blank or to another group's name", () => {
  const store = createStore(memoryStorage());
  store.addGroup('Push');
  store.addGroup('Pull');
  store.addExercise('Chest press');
  store.addToGroup('Chest press', 'Push');
  assert.equal(store.renameGroup('Push', '  Upper  body '), 'Upper body');
  assert.deepEqual(store.exercisesIn('Upper body'), ['Chest press']);
  assert.equal(store.renameGroup('Upper body', 'upper BODY'), 'upper BODY');
  assert.equal(store.renameGroup('upper BODY', 'pull'), null);
  assert.equal(store.renameGroup('upper BODY', ' '), null);
  assert.deepEqual(store.groups, ['upper BODY', 'Pull']);
});

test('deleting a group keeps its exercises and their sets', () => {
  const store = createStore(memoryStorage());
  store.addGroup('Legs');
  store.addExercise('Leg press');
  store.addToGroup('Leg press', 'Legs');
  store.addSet({ exercise: 'Leg press', weightKg: 80, seconds: 70 });
  assert.equal(store.deleteGroup('Legs'), true);
  assert.deepEqual(store.groups, []);
  assert.deepEqual(store.exercisesIn(null), ['Leg press']);
  assert.equal(store.lastSet('Leg press').seconds, 70);
});

test('a log saved before groups loads with its exercises in no group', () => {
  const saved = JSON.stringify({ exercises: ['Row'], sets: [], lastExercise: 'Row' });
  const store = createStore(memoryStorage({ 'superslow.v1': saved }));
  assert.deepEqual(store.groups, []);
  assert.deepEqual(store.exercisesIn(null), ['Row']);
  store.addGroup('Pull');
  store.addToGroup('Row', 'Pull');
  assert.deepEqual(store.exercisesIn('Pull'), ['Row']);
});

test('a backup adds its groups and their exercises to the ones already here', () => {
  const source = createStore(memoryStorage());
  source.addGroup('Pull');
  source.addGroup('Legs');
  for (const name of ['Row', 'Deadlift']) source.addExercise(name);
  source.addToGroup('Row', 'Pull');
  source.addToGroup('Deadlift', 'Pull');
  source.addToGroup('Deadlift', 'Legs');
  const backup = source.toJSON();

  const target = createStore(memoryStorage());
  target.addGroup('pull');
  target.addExercise('deadlift');
  target.addToGroup('deadlift', 'pull');
  target.importJSON(backup);
  assert.deepEqual(target.groups, ['pull', 'Legs']);
  assert.deepEqual(target.exercisesIn('pull'), ['deadlift', 'Row']);
  assert.deepEqual(target.exercisesIn('Legs'), ['deadlift']);
  assert.deepEqual(target.importJSON(backup), { added: 0 });
  assert.deepEqual(target.exercisesIn('pull'), ['deadlift', 'Row']);
});

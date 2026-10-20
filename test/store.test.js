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

test('only an exercise without sets can be removed', () => {
  const store = createStore(memoryStorage());
  store.addExercise('Row');
  store.addExercise('Typo');
  store.addSet({ exercise: 'Row', weightKg: 30, seconds: 70 });
  assert.equal(store.removeExercise('Row'), false);
  assert.equal(store.removeExercise('Typo'), true);
  assert.deepEqual(store.exercises, ['Row']);
});

test('broken saved data starts a fresh log', () => {
  const store = createStore(memoryStorage({ 'superslow.v1': '{not json' }));
  assert.deepEqual(store.exercises, []);
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

test('the last group picked is remembered until it is removed', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  assert.equal(store.lastGroup, null);
  store.addGroup('Legs');
  store.selectGroup('Legs');
  assert.equal(createStore(storage).lastGroup, 'Legs');
  store.removeGroup('Legs');
  assert.equal(store.lastGroup, null);
});

test('only an empty group can be removed, and a removed exercise leaves its groups', () => {
  const store = createStore(memoryStorage());
  store.addGroup('Legs');
  store.addExercise('Leg press');
  store.addToGroup('Leg press', 'Legs');
  assert.equal(store.removeGroup('Legs'), false);
  store.removeExercise('Leg press');
  assert.deepEqual(store.exercisesIn('Legs'), []);
  assert.equal(store.removeGroup('Legs'), true);
  assert.deepEqual(store.groups, []);
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

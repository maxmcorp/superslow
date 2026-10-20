// The training log, kept in the phone's local storage.

import { verdict } from './schedule.js';

const KEY = 'superslow.v1';

function empty() {
  return { exercises: [], groups: [], sets: [], lastExercise: null, lastGroup: null };
}

function tidy(name) {
  return name.trim().replace(/\s+/g, ' ');
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSet(s) {
  return (
    s &&
    typeof s.id === 'string' &&
    typeof s.exercise === 'string' &&
    Number.isFinite(s.seconds) &&
    (s.weightKg === null || Number.isFinite(s.weightKg)) &&
    typeof s.at === 'string'
  );
}

function isGroup(g) {
  return g && typeof g.name === 'string' && tidy(g.name) !== '' && Array.isArray(g.exercises);
}

function newestFirst(a, b) {
  return b.at.localeCompare(a.at);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function createStore(storage, key = KEY) {
  let data = read();

  function read() {
    try {
      const saved = JSON.parse(storage.getItem(key));
      if (saved && Array.isArray(saved.exercises) && Array.isArray(saved.sets)) {
        return { ...empty(), ...saved };
      }
    } catch {
      // Unreadable data starts a fresh log rather than breaking the app.
    }
    return empty();
  }

  function write() {
    storage.setItem(key, JSON.stringify(data));
  }

  function findExercise(name) {
    const wanted = name.toLocaleLowerCase();
    return data.exercises.find((e) => e.toLocaleLowerCase() === wanted);
  }

  function findGroup(name) {
    const wanted = name.toLocaleLowerCase();
    return data.groups.find((g) => g.name.toLocaleLowerCase() === wanted);
  }

  function findGroupNamed(name) {
    return data.groups.find((g) => g.name === name);
  }

  function inAnyGroup(exercise) {
    return data.groups.some((g) => g.exercises.includes(exercise));
  }

  return {
    get exercises() {
      return [...data.exercises];
    },

    get lastExercise() {
      return data.lastExercise && findExercise(data.lastExercise) ? data.lastExercise : null;
    },

    // Returns the stored name, which is the existing one if it differs only in case.
    addExercise(name) {
      const clean = tidy(name);
      if (!clean) return null;
      const existing = findExercise(clean);
      if (existing) return existing;
      data.exercises.push(clean);
      write();
      return clean;
    },

    // Only an exercise without sets can be removed, so no history is lost.
    removeExercise(name) {
      if (data.sets.some((s) => s.exercise === name)) return false;
      data.exercises = data.exercises.filter((e) => e !== name);
      for (const g of data.groups) g.exercises = g.exercises.filter((e) => e !== name);
      if (data.lastExercise === name) data.lastExercise = null;
      write();
      return true;
    },

    get groups() {
      return data.groups.map((g) => g.name);
    },

    // Returns the stored name, which is the existing one if it differs only in case.
    addGroup(name) {
      const clean = tidy(name);
      if (!clean) return null;
      const existing = findGroup(clean);
      if (existing) return existing.name;
      data.groups.push({ name: clean, exercises: [] });
      write();
      return clean;
    },

    // Only an empty group can be removed.
    removeGroup(name) {
      const group = findGroupNamed(name);
      if (!group || group.exercises.length) return false;
      data.groups = data.groups.filter((g) => g !== group);
      write();
      return true;
    },

    // The group last picked, or null.
    get lastGroup() {
      return data.lastGroup && findGroupNamed(data.lastGroup) ? data.lastGroup : null;
    },

    selectGroup(name) {
      data.lastGroup = name;
      write();
    },

    // An exercise can be in any number of groups.
    groupsOf(exercise) {
      return data.groups.filter((g) => g.exercises.includes(exercise)).map((g) => g.name);
    },

    // Puts an exercise at the end of a group, unless it is in it already.
    addToGroup(exercise, group) {
      const found = findGroupNamed(group);
      if (!found || found.exercises.includes(exercise)) return;
      found.exercises.push(exercise);
      write();
    },

    removeFromGroup(exercise, group) {
      const found = findGroupNamed(group);
      if (!found) return;
      found.exercises = found.exercises.filter((e) => e !== exercise);
      write();
    },

    // A group's exercises in the order they were put in it; null gives the exercises in no group.
    exercisesIn(group) {
      if (group === null) return data.exercises.filter((e) => !inAnyGroup(e));
      return [...(findGroupNamed(group)?.exercises ?? [])];
    },

    selectExercise(name) {
      data.lastExercise = name;
      write();
    },

    addSet({ exercise, weightKg, seconds, at = new Date().toISOString() }) {
      const set = { id: newId(), exercise, weightKg, seconds, at };
      data.sets.push(set);
      data.lastExercise = exercise;
      write();
      return set;
    },

    deleteSet(id) {
      const before = data.sets.length;
      data.sets = data.sets.filter((s) => s.id !== id);
      write();
      return data.sets.length < before;
    },

    setsFor(exercise) {
      return data.sets.filter((s) => s.exercise === exercise).sort(newestFirst);
    },

    lastSet(exercise) {
      return this.setsFor(exercise)[0] ?? null;
    },

    toJSON() {
      return JSON.stringify({ app: 'superslow', version: 1, ...data }, null, 2);
    },

    toCSV() {
      const rows = [['date', 'time', 'exercise', 'weight_kg', 'seconds', 'verdict']];
      for (const s of [...data.sets].sort(newestFirst).reverse()) {
        const d = new Date(s.at);
        rows.push([
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
          `${pad(d.getHours())}:${pad(d.getMinutes())}`,
          s.exercise,
          s.weightKg,
          s.seconds,
          verdict(s.seconds),
        ]);
      }
      return rows.map((r) => r.map(csvField).join(',')).join('\n') + '\n';
    },

    // Merges a backup into the log: sets already present (same id) are kept as they are, and
    // groups get the backup's exercises added to their own. Throws if the text is not a Superslow backup.
    importJSON(text) {
      let backup;
      try {
        backup = JSON.parse(text);
      } catch {
        throw new Error('not-a-backup');
      }
      if (!backup || backup.app !== 'superslow' || !Array.isArray(backup.sets)) {
        throw new Error('not-a-backup');
      }
      const known = new Set(data.sets.map((s) => s.id));
      const fresh = backup.sets.filter((s) => isSet(s) && !known.has(s.id));
      const groups = Array.isArray(backup.groups) ? backup.groups.filter(isGroup) : [];
      const names = [...(backup.exercises ?? []), ...groups.flatMap((g) => g.exercises), ...fresh.map((s) => s.exercise)];
      for (const name of names) {
        if (typeof name === 'string' && name.trim() && !findExercise(name)) data.exercises.push(name.trim());
      }
      for (const group of groups) {
        const name = tidy(group.name);
        const mine = findGroup(name) ?? { name, exercises: [] };
        if (!data.groups.includes(mine)) data.groups.push(mine);
        for (const exercise of group.exercises) {
          const known = typeof exercise === 'string' && findExercise(exercise);
          if (known && !mine.exercises.includes(known)) mine.exercises.push(known);
        }
      }
      data.sets.push(...fresh.map((s) => ({ ...s, exercise: findExercise(s.exercise) })));
      write();
      return { added: fresh.length };
    },
  };
}

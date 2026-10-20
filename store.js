// The training log, kept in the phone's local storage.

import { verdict } from './schedule.js';

const KEY = 'superslow.v1';

function empty() {
  return { exercises: [], sets: [], lastExercise: null };
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

  return {
    get exercises() {
      return [...data.exercises];
    },

    get lastExercise() {
      return data.lastExercise && findExercise(data.lastExercise) ? data.lastExercise : null;
    },

    // Returns the stored name, which is the existing one if it differs only in case.
    addExercise(name) {
      const clean = name.trim().replace(/\s+/g, ' ');
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
      if (data.lastExercise === name) data.lastExercise = null;
      write();
      return true;
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

    // Merges a backup into the log: sets already present (same id) are kept as they are.
    // Throws if the text is not a Superslow backup.
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
      const names = [...(backup.exercises ?? []), ...fresh.map((s) => s.exercise)];
      for (const name of names) {
        if (typeof name === 'string' && name.trim() && !findExercise(name)) data.exercises.push(name.trim());
      }
      data.sets.push(...fresh.map((s) => ({ ...s, exercise: findExercise(s.exercise) })));
      write();
      return { added: fresh.length };
    },
  };
}

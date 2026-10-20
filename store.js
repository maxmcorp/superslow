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
    tidy(s.exercise) !== '' &&
    Number.isFinite(s.seconds) &&
    s.seconds >= 0 &&
    (s.weightKg === null || (Number.isFinite(s.weightKg) && s.weightKg >= 0)) &&
    typeof s.at === 'string' &&
    Number.isFinite(Date.parse(s.at))
  );
}

function isGroup(g) {
  return g && typeof g.name === 'string' && tidy(g.name) !== '' && Array.isArray(g.exercises);
}

// A filter that lets each key through the first time only.
function firstTime() {
  const seen = new Set();
  return (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

// Saved data that would break the app is dropped, and repeats are read once: only this app
// writes it, but a restore by an older version could have stored a set with a bad date or a
// repeated id, or an exercise twice. `dropped` tells if anything was.
function clean(saved) {
  let dropped = false;
  // A list that is missing (an older log) is empty; one that is something else is dropped.
  const keep = (list, ok) => {
    if (list !== undefined && !Array.isArray(list)) dropped = true;
    const all = Array.isArray(list) ? list : [];
    const kept = all.filter(ok);
    if (kept.length !== all.length) dropped = true;
    return kept;
  };
  const newExercise = firstTime();
  const exercises = keep(saved.exercises, (e) => typeof e === 'string' && tidy(e) !== '' && newExercise(e));
  const newGroup = firstTime();
  const newSetId = firstTime();
  const data = {
    exercises,
    groups: keep(saved.groups, (g) => isGroup(g) && newGroup(g.name.toLocaleLowerCase())).map((g) => {
      const newMember = firstTime();
      return { name: g.name, exercises: keep(g.exercises, (e) => exercises.includes(e) && newMember(e)) };
    }),
    sets: keep(saved.sets, (s) => isSet(s) && newSetId(s.id)),
    lastExercise: typeof saved.lastExercise === 'string' ? saved.lastExercise : null,
    lastGroup: typeof saved.lastGroup === 'string' ? saved.lastGroup : null,
  };
  return { data, dropped };
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

  // Unreadable data starts a fresh log rather than breaking the app. Whenever anything saved
  // can't be used, the original text is kept aside, so the next write doesn't destroy the only copy.
  function read() {
    const raw = storage.getItem(key);
    let saved = null;
    try {
      saved = JSON.parse(raw);
    } catch {
      // Handled below.
    }
    const readable = saved && Array.isArray(saved.exercises) && Array.isArray(saved.sets);
    const { data, dropped } = readable ? clean(saved) : { data: empty(), dropped: Boolean(raw) };
    if (dropped) {
      try {
        storage.setItem(`${key}.unreadable`, raw);
      } catch {
        // No room for the copy.
      }
    }
    return data;
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

    // Renames an exercise in its sets and groups too. Returns the new name, or null if it is
    // blank or another exercise has it.
    renameExercise(name, newName) {
      const clean = tidy(newName);
      if (!data.exercises.includes(name) || !clean) return null;
      const other = findExercise(clean);
      if (other && other !== name) return null;
      const rename = (e) => (e === name ? clean : e);
      data.exercises = data.exercises.map(rename);
      for (const s of data.sets) s.exercise = rename(s.exercise);
      for (const g of data.groups) g.exercises = g.exercises.map(rename);
      data.lastExercise = rename(data.lastExercise);
      write();
      return clean;
    },

    // Deletes an exercise and all its sets.
    deleteExercise(name) {
      if (!data.exercises.includes(name)) return false;
      data.exercises = data.exercises.filter((e) => e !== name);
      data.sets = data.sets.filter((s) => s.exercise !== name);
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

    // Returns the new name, or null if it is blank or another group has it.
    renameGroup(name, newName) {
      const group = findGroupNamed(name);
      const clean = tidy(newName);
      if (!group || !clean) return null;
      const other = findGroup(clean);
      if (other && other !== group) return null;
      group.name = clean;
      if (data.lastGroup === name) data.lastGroup = clean;
      write();
      return clean;
    },

    // The group's exercises and their sets stay.
    deleteGroup(name) {
      const group = findGroupNamed(name);
      if (!group) return false;
      data.groups = data.groups.filter((g) => g !== group);
      if (data.lastGroup === name) data.lastGroup = null;
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
    // groups get the backup's exercises added to their own. Names are matched the way typed
    // names are, and sets that don't make sense are skipped. Throws if the text is not a
    // Superslow backup.
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
      const fresh = backup.sets.filter((s) => {
        if (!isSet(s) || known.has(s.id)) return false;
        known.add(s.id);
        return true;
      });
      const groups = Array.isArray(backup.groups) ? backup.groups.filter(isGroup) : [];
      const exercises = Array.isArray(backup.exercises) ? backup.exercises : [];
      const names = [...exercises, ...groups.flatMap((g) => g.exercises), ...fresh.map((s) => s.exercise)];
      for (const name of names) {
        const clean = typeof name === 'string' ? tidy(name) : '';
        if (clean && !findExercise(clean)) data.exercises.push(clean);
      }
      for (const group of groups) {
        const name = tidy(group.name);
        const mine = findGroup(name) ?? { name, exercises: [] };
        if (!data.groups.includes(mine)) data.groups.push(mine);
        for (const exercise of group.exercises) {
          const found = typeof exercise === 'string' && findExercise(tidy(exercise));
          if (found && !mine.exercises.includes(found)) mine.exercises.push(found);
        }
      }
      data.sets.push(
        ...fresh.map((s) => ({
          ...s,
          exercise: findExercise(tidy(s.exercise)),
          at: new Date(s.at).toISOString(),
        })),
      );
      write();
      return { added: fresh.length };
    },
  };
}

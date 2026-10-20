// Keeps the screen on while a set runs.
//
// iOS drops the lock when the app goes to the background, so it is asked for again
// whenever the app comes back while still wanted. `onChange(held)` reports whether
// the screen is actually being kept on.

export function createWakeLock(onChange) {
  let sentinel = null;
  let wanted = false;
  let pending = false;

  async function request() {
    if (pending) return;
    if (!('wakeLock' in navigator)) {
      onChange(false);
      return;
    }
    pending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      // No longer wanted by the time the lock arrived.
      if (!wanted) {
        lock.release();
        return;
      }
      sentinel = lock;
      lock.addEventListener('release', () => {
        if (sentinel !== lock) return;
        sentinel = null;
        // Taken back by the system while still wanted on screen: ask again, which reports
        // the loss if it fails. Going to the background is handled on the way back.
        if (wanted && document.visibilityState === 'visible') request();
      });
      onChange(true);
    } catch {
      onChange(false);
    } finally {
      pending = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (wanted && !sentinel && document.visibilityState === 'visible') request();
  });

  return {
    acquire() {
      wanted = true;
      if (!sentinel) request();
    },

    release() {
      wanted = false;
      if (sentinel) sentinel.release();
      sentinel = null;
    },
  };
}

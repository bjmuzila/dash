window.PageRuntime = window.PageRuntime || {
  cleanupHandlers: new Map(),
  register(name, cleanup) {
    if (!name || typeof cleanup !== 'function') return;
    this.cleanupHandlers.set(name, cleanup);
  },
  cleanup(name) {
    const fn = this.cleanupHandlers.get(name);
    if (typeof fn === 'function') {
      try {
        fn();
      } catch (err) {
        console.warn(`Page cleanup failed for ${name}:`, err);
      }
    }
    this.cleanupHandlers.delete(name);
  }
};

'use strict';

// Generic async transaction coordinator for shell writes. It knows nothing
// about Windows or commands: callers provide validated operations and a state
// restore function. This makes rollback behavior testable without touching a
// user's registry or wallpaper.
async function runShellTransaction(before, operations, restore) {
  const results = [];
  try {
    for (const operation of operations || []) {
      const result = await operation.run();
      results.push({ label: operation.label, result });
      if (!result || result.ok === false) {
        const error = result && result.error ? result.error : operation.label + ' failed';
        throw new Error(error);
      }
    }
    return { ok: true, results, changed: results.length > 0 };
  } catch (err) {
    let rollback = { ok: false, error: 'rollback unavailable' };
    try { rollback = await restore(before); } catch (restoreError) { rollback = { ok: false, error: restoreError.message }; }
    return {
      ok: false,
      error: err.message,
      rolledBack: !!(rollback && rollback.ok),
      rollbackError: rollback && !rollback.ok ? rollback.error : null,
      results
    };
  }
}

module.exports = { runShellTransaction };

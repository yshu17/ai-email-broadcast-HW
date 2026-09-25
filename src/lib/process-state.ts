/**
 * State that must exist once per Node process, however many times the bundler
 * has copied the module that asks for it.
 *
 * In development Next.js compiles each route into its own bundle, so a plain
 * module-level variable would exist once per route: the endpoint that sets the
 * test clock and the one that reads it would see different values. The database
 * connection (`src/lib/db`) is kept on `globalThis` for the same reason; this is
 * that pattern with a name, so several pieces of state can share it safely.
 *
 * Nothing here is persisted. A restarted process starts from `init()` again,
 * which is exactly the lifetime the test tools promise ("until the process restarts").
 */
export function processState<T extends object>(name: string, init: () => T): T {
  const key = Symbol.for(`mailer.process-state.${name}`);
  const store = globalThis as unknown as Record<symbol, T | undefined>;
  return (store[key] ??= init());
}

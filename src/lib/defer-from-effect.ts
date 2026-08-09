/**
 * Start work from an effect without updating state synchronously inside it.
 *
 * Effects that kick off a load typically call an async function which flips a
 * `loading` flag before its first `await`. That flag lands synchronously inside
 * the effect, costing an extra render pass — and React's lint rules
 * (react-hooks/set-state-in-effect) flag it, since a synchronous setState in an
 * effect is usually a sign the value should have been derived during render
 * instead.
 *
 * Where the work genuinely is a side effect (fetching, reading storage), this
 * defers the call by a microtask. That still resolves before paint, so nothing
 * flickers, and the state update happens in a callback rather than in the
 * effect's own call stack.
 *
 * Use this only for real side effects. State that can be computed from props or
 * other state should be derived during render, not synced in an effect.
 */
export function deferFromEffect(run: () => void | Promise<void>): void {
  void Promise.resolve().then(run);
}

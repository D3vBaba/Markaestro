/**
 * Project-specific lint rules.
 *
 * Both of these encode a bug this codebase actually shipped, which is the only
 * good reason to write a custom rule.
 */

/**
 * `no-floating-api-result`
 *
 * `apiGet`/`apiPost`/`apiPut`/`apiPatch`/`apiDelete` return `{ ok, status,
 * data }` instead of throwing, so `await apiPut(...)` on its own line looks
 * like a checked write and is not one. That is how the composer came to save
 * pending edits before publishing without inspecting the result: when the save
 * failed, publishing went ahead against the un-edited content the server still
 * held, and the user watched a success toast.
 *
 * Flags an awaited api* call whose result is discarded. `void apiPost(...)` is
 * the explicit opt-out for a genuinely fire-and-forget call.
 */
const noFloatingApiResult = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require the result of an api* client call to be used',
    },
    schema: [],
    messages: {
      floating:
        "The result of `{{name}}` is discarded. It returns { ok, data } rather than throwing, so a failure here is silent. Check `res.ok`, or write `void {{name}}(...)` if the call is deliberately fire-and-forget.",
    },
  },
  create(context) {
    const API_CALLS = new Set(['apiGet', 'apiPost', 'apiPut', 'apiPatch', 'apiDelete', 'apiFetch']);

    function calleeName(node) {
      if (node.type === 'Identifier') return node.name;
      if (node.type === 'MemberExpression' && node.property.type === 'Identifier') {
        return node.property.name;
      }
      return null;
    }

    return {
      ExpressionStatement(node) {
        const inner = node.expression.type === 'AwaitExpression'
          ? node.expression.argument
          : node.expression;
        if (!inner || inner.type !== 'CallExpression') return;
        const name = calleeName(inner.callee);
        if (!name || !API_CALLS.has(name)) return;
        context.report({ node: inner, messageId: 'floating', data: { name } });
      },
    };
  },
};

export default {
  rules: {
    'no-floating-api-result': noFloatingApiResult,
  },
};

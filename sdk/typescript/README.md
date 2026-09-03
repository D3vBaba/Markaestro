# @markaestro/sdk

Typed client for the [Markaestro public API](https://markaestro.com/developers/api).

```bash
npm install @markaestro/sdk
```

```ts
import { Markaestro } from '@markaestro/sdk';

const client = new Markaestro({ apiKey: process.env.MARKAESTRO_API_KEY! });

// Draft, then publish, as one call.
const { post, run } = await client.posts.createAndPublish({
  channel: 'linkedin',
  caption: 'Hello from the SDK',
});

// Or schedule for later. Scheduling runs preflight at create time, so a
// broken connection is reported here, not silently at publish time.
await client.posts.create({
  targets: [{ channel: 'linkedin' }, { channel: 'x' }],
  caption: 'Multi-channel, scheduled',
  scheduledAt: '2026-09-01T10:00:00Z',
});

// Turn a proven post into a governed recurring queue, then read its measured
// lifetime performance. Activation is deliberately a separate call.
const queue = await client.evergreen.create({
  sourcePostId: post.id,
  name: 'Launch proof points',
  variants: [{ caption: 'A measured update worth revisiting.' }],
});
await client.evergreen.activate(queue.id);
const performance = await client.evergreen.analytics(queue.id);
```

Every create carries an automatic `Idempotency-Key`, so a network retry can
never double-post. 429 and transient 5xx responses retry with the server's
`Retry-After`. Errors throw `MarkaestroError` with the machine `code`, the
optional server-authored `userMessage`, per-channel `issues`, and the
`requestId` to quote in a support message.

Use an `mk_test_` key to exercise the whole pipeline against the sandbox:
real posts, deterministic fake platform ids, nothing sent to any platform.
Put `TEST_FAIL_RATE_LIMIT` in a caption to rehearse your error handling.

Verify webhooks with the included helper (raw body, constant-time,
rotation-aware):

```ts
import { verifyWebhook } from '@markaestro/sdk';

const ok = await verifyWebhook({ rawBody, headers: req.headers, secret });
```

The machine-readable spec is at `GET /api/public/v1/openapi.json`.

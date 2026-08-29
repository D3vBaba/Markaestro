# markaestro

Client for the [Markaestro public API](https://markaestro.com/developers/api).

```bash
pip install markaestro
```

```python
from markaestro import Markaestro

client = Markaestro(api_key=os.environ["MARKAESTRO_API_KEY"])

result = client.posts.create_and_publish(
    channel="linkedin",
    caption="Hello from the SDK",
)

client.posts.create(
    targets=[{"channel": "linkedin"}, {"channel": "threads"}],
    caption="Multi-channel, scheduled",
    scheduledAt="2026-09-01T10:00:00Z",
)
```

Every mutation carries an automatic `Idempotency-Key`; 429 and transient 5xx
retry with the server's `Retry-After`. Errors raise `MarkaestroError` with
`.code`, `.user_message`, `.issues`, and `.request_id`.

Use an `mk_test_` key to exercise everything against the sandbox; put
`TEST_FAIL_RATE_LIMIT` in a caption to rehearse error handling.

```python
from markaestro import verify_webhook

ok = verify_webhook(raw_body, dict(request.headers), secret)
```

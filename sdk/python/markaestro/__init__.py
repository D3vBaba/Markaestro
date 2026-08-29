"""Markaestro SDK for Python.

A thin, hand-written client over the public API. The full surface,
request/response schemas, and the error catalogue live in the OpenAPI
description at ``GET /api/public/v1/openapi.json``.

The wrapper's job:
  - an automatic ``Idempotency-Key`` on every mutation, minted once and
    reused across retries, so a retried request replays instead of
    double-creating;
  - retries on 429 and transient 5xx honouring the server's ``Retry-After``;
  - the draft-then-publish two-step folded into ``posts.create_and_publish``;
  - constant-time webhook verification, rotation grace included.
"""

from .client import Markaestro, MarkaestroError
from .webhooks import verify_webhook

__all__ = ["Markaestro", "MarkaestroError", "verify_webhook"]

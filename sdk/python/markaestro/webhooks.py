from __future__ import annotations

import hashlib
import hmac
import time
from datetime import datetime
from typing import Mapping, Union


def verify_webhook(
    raw_body: Union[bytes, str],
    headers: Mapping[str, str],
    secret: str,
    *,
    tolerance_seconds: int = 300,
) -> bool:
    """Verify a Markaestro webhook delivery.

    Signs the RAW request body (never a re-serialized object), compares in
    constant time, rejects timestamps older than the tolerance, and accepts
    either signature during a secret-rotation grace window.
    """
    lowered = {k.lower(): v for k, v in headers.items()}
    timestamp = lowered.get("x-markaestro-timestamp")
    if not timestamp:
        return False

    try:
        signed_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return False
    if time.time() - signed_at.timestamp() > tolerance_seconds:
        return False

    body = raw_body.encode() if isinstance(raw_body, str) else raw_body
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()

    candidates = [
        lowered.get("x-markaestro-signature"),
        lowered.get("x-markaestro-signature-previous"),
    ]
    return any(c and hmac.compare_digest(expected, c) for c in candidates)

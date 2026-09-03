from __future__ import annotations

import secrets
import time
from typing import Any, Optional
from urllib.parse import quote

import httpx

_RETRYABLE_STATUSES = {429, 502, 503, 504}


class MarkaestroError(Exception):
    """The API's error envelope.

    ``code`` is the machine code from the error catalogue and the only field
    to branch on. ``user_message`` is server-authored copy safe to show a
    person, present only where one was written. ``request_id`` finds every
    log line for the request; quote it when reporting a problem.
    """

    def __init__(self, status: int, body: dict[str, Any]):
        self.status = status
        self.code = body.get("error") or f"HTTP_{status}"
        self.user_message: Optional[str] = body.get("userMessage")
        self.request_id: Optional[str] = body.get("requestId")
        self.issues: list[dict[str, Any]] = body.get("issues") or []
        super().__init__(self.code)


class _Resource:
    def __init__(self, client: "Markaestro"):
        self._client = client


class _Posts(_Resource):
    def create(self, **input: Any) -> dict[str, Any]:
        return self._client._request("POST", "/api/public/v1/posts", json=input)["post"]

    def get(self, post_id: str) -> dict[str, Any]:
        return self._client._request("GET", f"/api/public/v1/posts/{post_id}")["post"]

    def list(self, **params: Any) -> dict[str, Any]:
        return self._client._request("GET", "/api/public/v1/posts", params=params)

    def delete(self, post_id: str) -> dict[str, Any]:
        return self._client._request("DELETE", f"/api/public/v1/posts/{post_id}")

    def publish(self, post_id: str) -> dict[str, Any]:
        return self._client._request("POST", f"/api/public/v1/posts/{post_id}/publish")["run"]

    def create_and_publish(self, **input: Any) -> dict[str, Any]:
        """The draft-then-publish two-step as one call."""
        post = self.create(**input)
        run = self.publish(post["id"])
        return {"post": post, "run": run}

    def bulk(self, ids: list[str], action: str, **rest: Any) -> dict[str, Any]:
        return self._client._request(
            "POST", "/api/public/v1/posts/bulk", json={"ids": ids, "action": action, **rest}
        )


class _Media(_Resource):
    def list(self, **params: Any) -> dict[str, Any]:
        return self._client._request("GET", "/api/public/v1/media", params=params)

    def get(self, asset_id: str) -> dict[str, Any]:
        return self._client._request("GET", f"/api/public/v1/media/{asset_id}")["asset"]

    def delete(self, asset_id: str) -> dict[str, Any]:
        return self._client._request("DELETE", f"/api/public/v1/media/{asset_id}")


class _JobRuns(_Resource):
    def get(self, run_id: str) -> dict[str, Any]:
        return self._client._request("GET", f"/api/public/v1/job-runs/{run_id}")["run"]

    def list(self, **params: Any) -> dict[str, Any]:
        return self._client._request("GET", "/api/public/v1/job-runs", params=params)


class _Evergreen(_Resource):
    def preview(self, source_post_id: str) -> dict[str, Any]:
        return self._client._request(
            "POST", "/api/public/v1/evergreen-queues/preview", json={"sourcePostId": source_post_id}
        )["preview"]

    def create(self, **input: Any) -> dict[str, Any]:
        return self._client._request("POST", "/api/public/v1/evergreen-queues", json=input)["queue"]

    def list(self) -> dict[str, Any]:
        return self._client._request("GET", "/api/public/v1/evergreen-queues")

    def get(self, queue_id: str) -> dict[str, Any]:
        return self._client._request("GET", f"/api/public/v1/evergreen-queues/{quote(queue_id, safe='')}")["queue"]

    def update(self, queue_id: str, **input: Any) -> dict[str, Any]:
        return self._client._request(
            "PATCH", f"/api/public/v1/evergreen-queues/{quote(queue_id, safe='')}", json=input
        )["queue"]

    def activate(self, queue_id: str) -> dict[str, Any]:
        return self._transition(queue_id, "activate")

    def pause(self, queue_id: str) -> dict[str, Any]:
        return self._transition(queue_id, "pause")

    def resume(self, queue_id: str) -> dict[str, Any]:
        return self._transition(queue_id, "resume")

    def archive(self, queue_id: str) -> dict[str, Any]:
        return self._client._request(
            "DELETE", f"/api/public/v1/evergreen-queues/{quote(queue_id, safe='')}"
        )["queue"]

    def runs(self, queue_id: str) -> dict[str, Any]:
        return self._client._request(
            "GET", f"/api/public/v1/evergreen-queues/{quote(queue_id, safe='')}/runs"
        )

    def analytics(self, queue_id: str) -> dict[str, Any]:
        return self._client._request(
            "GET", f"/api/public/v1/evergreen-queues/{quote(queue_id, safe='')}/analytics"
        )["analytics"]

    def _transition(self, queue_id: str, action: str) -> dict[str, Any]:
        return self._client._request(
            "POST", f"/api/public/v1/evergreen-queues/{quote(queue_id, safe='')}/{action}"
        )["queue"]


class _WebhookEndpoints(_Resource):
    def list(self) -> dict[str, Any]:
        return self._client._request("GET", "/api/public/v1/webhook-endpoints")

    def create(self, url: str, events: list[str]) -> dict[str, Any]:
        return self._client._request(
            "POST", "/api/public/v1/webhook-endpoints", json={"url": url, "events": events}
        )["webhookEndpoint"]

    def delete(self, endpoint_id: str) -> dict[str, Any]:
        return self._client._request("DELETE", f"/api/public/v1/webhook-endpoints/{endpoint_id}")


class Markaestro:
    """``Markaestro(api_key="mk_live_...")``.

    An ``mk_test_`` key exercises the whole pipeline against the sandbox:
    real posts, deterministic fake platform ids, nothing sent to a platform.
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = "https://markaestro.com",
        api_version: Optional[str] = None,
        max_retries: int = 2,
        timeout: float = 30.0,
    ):
        if not api_key.startswith("mk_"):
            raise ValueError("api_key must be an mk_live_ or mk_test_ key from Settings > API")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._api_version = api_version
        self._max_retries = max_retries
        self._http = httpx.Client(timeout=timeout)

        self.posts = _Posts(self)
        self.media = _Media(self)
        self.job_runs = _JobRuns(self)
        self.evergreen = _Evergreen(self)
        self.webhook_endpoints = _WebhookEndpoints(self)

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        if self._api_version:
            headers["Markaestro-Version"] = self._api_version
        if method not in ("GET", "HEAD"):
            # Minted once per logical request, reused across retries: the
            # retry replays the original response instead of double-creating.
            headers["Idempotency-Key"] = f"mk_idem_{secrets.token_hex(16)}"

        clean_params = {k: v for k, v in (params or {}).items() if v is not None}

        for attempt in range(self._max_retries + 1):
            response = self._http.request(
                method, self._base_url + path, json=json, params=clean_params, headers=headers
            )
            if response.status_code in _RETRYABLE_STATUSES and attempt < self._max_retries:
                retry_after = response.headers.get("Retry-After")
                time.sleep(float(retry_after) if retry_after else 2 ** attempt)
                continue
            try:
                body = response.json() if response.content else {}
            except ValueError:
                body = {"error": "MALFORMED_RESPONSE"}
            if response.status_code >= 400:
                raise MarkaestroError(response.status_code, body)
            return body

        raise MarkaestroError(0, {"error": "REQUEST_FAILED"})  # pragma: no cover

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "Markaestro":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

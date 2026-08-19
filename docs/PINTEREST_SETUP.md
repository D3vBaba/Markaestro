# Pinterest setup for Markaestro

Markaestro uses Pinterest API v5 to connect a Pinterest business account,
select one of its boards, and publish image Pins. The app now holds **Standard
access**, so every deployed environment talks to `api.pinterest.com`.

## Environment lock

`PINTEREST_API_ENVIRONMENT` selects the API origin, but Sandbox is a
local-development affordance only. `getPinterestApiEnvironment()` in
`src/lib/pinterest-api.ts` refuses a `sandbox` value whenever
`NODE_ENV=production` — which is how App Hosting builds and runs the server —
and logs `pinterest.sandbox_override_refused` instead. A deployed backend
therefore cannot reach `api-sandbox.pinterest.com` even if the variable is
mis-set, because Sandbox Pins are visible only to their creator and a Sandbox
token is rejected by the production API.

Every Pinterest request in the app is built by `getPinterestApiUrl()` — Pin
writes, media upload, analytics, board listing, the OAuth token exchange, and
token refresh — so that one function is the only place an origin is chosen.

Connections are stamped with the environment they were authorized against at
OAuth time, and `validateConnection()` blocks a Sandbox-era connection from
publishing to production with a message telling the user to reconnect.

The historical Trial-access setup below is kept for reference.

## Trial setup and demo recording

1. In Pinterest **My apps**, verify the Markaestro app has active Trial access.
2. Register this redirect URI exactly:
   `https://markaestro.com/api/oauth/callback/pinterest`
3. Configure `PINTEREST_CLIENT_ID` and `PINTEREST_CLIENT_SECRET` with the app's
   ID and secret.
4. Set `PINTEREST_API_ENVIRONMENT=sandbox` on the preview/demo environment.
   The production App Hosting backend uses `production` and must not be used
   for Trial-access demo tokens or boards.
5. Deploy, then disconnect and reconnect Pinterest in Markaestro. This is
   required because Sandbox and production tokens are not interchangeable.
6. Select a board owned by the connected account. Avoid group boards for a
   Sandbox demo.
7. Create and publish an **image Pin**. Pinterest Sandbox does not support video
   Pin creation.

Record one continuous screen capture showing:

1. The Markaestro Pinterest connect action.
2. Pinterest's OAuth consent screen and requested permissions.
3. Return to Markaestro without exposing the authorization code, access token,
   app secret, browser developer tools, or server logs.
4. Board selection.
5. Creation and publishing of an image Pin.
6. The successful Pin result, followed by the Pin visible on the connected
   account. Sandbox Pins are visible only to their creator.

## Standard access and production cutover

Submit the recording through the app's **Upgrade** flow in Pinterest My apps.
After Pinterest grants Standard access:

1. Confirm `PINTEREST_API_ENVIRONMENT=production` in `apphosting.yaml`.
   Markaestro's production deployment is configured this way.
2. Deploy the configuration.
3. Disconnect and reconnect each Pinterest account, then select its production
   board again. Sandbox tokens, boards, and Pins do not transfer to production.
4. Publish a fresh production image Pin and verify its destination link and
   appearance before enabling scheduled publishing broadly.

Markaestro requests only the permissions needed for this use case:
`boards:read`, `boards:write`, `pins:read`, `pins:write`, and
`user_accounts:read`. Pinterest requires `boards:write` when creating a Pin on
an existing board.

## Recommended Markaestro use

Pinterest should be treated as an evergreen discovery channel rather than a
copy of short-lived social feeds. Each product can connect its own Pinterest
account and default board. Markaestro can generate and schedule vertical image
creative, publish it to the selected board, retain the returned Pin ID and URL,
and report saves, impressions, and outbound clicks when supported.

For the strongest production workflow, add Pin-specific fields for a concise
title and a destination URL. Today the adapter publishes the post content as
the Pin description and the selected media as the Pin creative.

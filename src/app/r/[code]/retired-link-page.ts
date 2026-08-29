/**
 * The body served for a tracked link its owner has retired.
 *
 * A retired link is a 410 Gone, not a 404: the code was real, it is simply no
 * longer in service, and saying so is more useful than pretending it never
 * existed. A person is looking at this, having followed a link from a
 * customer's post, so it is a page rather than a JSON error.
 *
 * Written as a self-contained document instead of a React page because a
 * route handler cannot render one at a non-200 status, and the status is the
 * part that matters here: crawlers drop a 410 promptly, which is exactly what
 * the owner asked for by retiring the link.
 *
 * Deliberately no "go home" link. This visitor has no relationship with us;
 * sending them to our marketing site would be an ad, not help.
 */
export function retiredLinkHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Link retired</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 20px; background: #faf9f7; color: #1a1a1a;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 28rem; text-align: center; }
  img { width: 40px; height: 40px; object-fit: contain; margin: 0 auto 28px; display: block; }
  p.eyebrow { margin: 0; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; }
  h1 { margin: 20px 0 0; font-size: 26px; line-height: 1.1; letter-spacing: -0.025em; font-weight: 600; }
  p.body { margin: 12px 0 0; font-size: 14px; line-height: 1.6; opacity: 0.65; }
  @media (prefers-color-scheme: dark) { body { background: #131211; color: #f2f0ee; } }
</style>
</head>
<body>
  <main>
    <img src="/markaestro-logo-transparent.png" alt="Markaestro">
    <p class="eyebrow">Link</p>
    <h1>This link has been retired</h1>
    <p class="body">The person who created this link has taken it out of service, so it no longer points anywhere. If you were expecting to land somewhere specific, ask them for a current link.</p>
  </main>
</body>
</html>
`;
}

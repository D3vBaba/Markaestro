/** Client-side helpers for saving a post's media so it can be re-posted natively. */

export function mediaFileName(url: string, index: number): string {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const last = pathname.split('/').pop() || '';
    if (last.includes('.')) return last;
  } catch {
    // Not a parseable URL — fall through to the generic name.
  }
  return `post-media-${index + 1}`;
}

export async function downloadMediaFiles(urls: string[]): Promise<void> {
  for (const [index, url] of urls.entries()) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = mediaFileName(url, index);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Cross-origin or fetch failure: open in a new tab so the user can save manually.
      window.open(url, '_blank', 'noopener');
    }
  }
}

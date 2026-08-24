/** Client-side clipboard helper shared by the copy-caption affordances. */

/**
 * Copy `text` to the clipboard, returning whether it landed there.
 *
 * The async Clipboard API is unavailable in insecure contexts and blocked by
 * some in-app browsers (Instagram/TikTok webviews), which is exactly where
 * users copy captions from — so fall back to the legacy selection copy rather
 * than telling them it failed.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or unavailable — fall through to the legacy path.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    // Off-screen but still focusable, and fixed so selecting it can't scroll the page.
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

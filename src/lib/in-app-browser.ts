const IN_APP_BROWSER_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Google', pattern: /\bGSA\b|Google/i },
  { name: 'Instagram', pattern: /Instagram/i },
  { name: 'Facebook', pattern: /FBAN|FBAV|FB_IAB/i },
  { name: 'TikTok', pattern: /TikTok/i },
  { name: 'LinkedIn', pattern: /LinkedInApp/i },
  { name: 'X', pattern: /Twitter|X\//i },
  { name: 'LINE', pattern: /Line/i },
  { name: 'WeChat', pattern: /MicroMessenger/i },
];

export function getInAppBrowserName(userAgent: string): string | null {
  for (const rule of IN_APP_BROWSER_RULES) {
    if (rule.pattern.test(userAgent)) {
      return rule.name;
    }
  }

  return null;
}

export function getCurrentInAppBrowserName(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return getInAppBrowserName(window.navigator.userAgent || '');
}

export function isMobileUserAgent(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

export function isCurrentBrowserMobile(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return isMobileUserAgent(window.navigator.userAgent || '');
}

/**
 * Start a social OAuth authorize navigation from a user gesture.
 *
 * On mobile we open the authorize endpoint in a NEW TAB instead of a top-level
 * redirect. A fresh top-level navigation to the Meta authorize domains
 * (www.instagram.com / www.facebook.com / threads.net) lets the OS hand the
 * request off to the installed native app via Universal/App Links, which
 * strands the user in the app ("opens the app and goes nowhere"). Opening a new
 * tab keeps the flow in the browser; the OAuth callback lands on
 * /oauth/complete, which refreshes the original tab and closes this one.
 *
 * Desktop keeps the simpler same-tab redirect. If the new tab is blocked we
 * fall back to a same-tab redirect so connect still works.
 */
export function startOAuthAuthorize(authorizePath: string): void {
  if (typeof window === 'undefined') return;
  if (isCurrentBrowserMobile()) {
    const tab = window.open(authorizePath, '_blank');
    if (tab) return;
  }
  window.location.href = authorizePath;
}

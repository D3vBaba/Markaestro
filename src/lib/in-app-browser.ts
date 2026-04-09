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

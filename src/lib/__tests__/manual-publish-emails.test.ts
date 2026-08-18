import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-emails', async () => {
  const { createTranslator } = await import('next-intl');
  const messages = (await import('@/messages/en/emails.json')).default;
  return {
    BRAND: { ink: '#000', muted: '#666', border: '#eee', accent: '#00f', panelBg: '#fafafa' },
    brandWrap: ({ bodyHtml }: { bodyHtml: string }) => `<html>${bodyHtml}</html>`,
    escapeHtml: (value: string) => value,
    getBaseUrl: () => 'https://markaestro.com',
    getEmailTranslator: async () => createTranslator({ locale: 'en', messages }),
  };
});

describe('manual post reminder email', () => {
  it('includes the full caption so it can be copied into the native app', async () => {
    const { manualPostReminderEmail } = await import('@/lib/manual-publish-emails');
    const caption = `${'Save every receipt with EyeCash. '.repeat(12)}#eyecash #receipts`;
    const payload = await manualPostReminderEmail({
      channelLabel: 'TikTok',
      caption,
      locale: 'en',
    });

    expect(caption.length).toBeGreaterThan(240);
    expect(payload.html).toContain(caption);
    expect(payload.text).toContain(caption);
    expect(payload.html).not.toContain(`${caption.slice(0, 240)}…`);
    expect(payload.text).not.toContain(`${caption.slice(0, 240)}…`);
  });
});

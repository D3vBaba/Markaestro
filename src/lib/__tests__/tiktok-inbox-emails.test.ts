import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendResendEmailMock = vi.fn();
const membersGet = vi.fn();
const productGet = vi.fn();
const postUpdate = vi.fn();

vi.mock('@/lib/resend', () => ({ sendResendEmail: sendResendEmailMock }));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({ where: () => ({ limit: () => ({ get: membersGet }) }) }),
    doc: (path: string) => (path.includes('/posts/')
      ? { update: postUpdate }
      : { get: productGet }),
  },
}));

vi.mock('@/lib/auth-emails', async () => {
  const { createTranslator } = await import('next-intl');
  const messages = (await import('@/messages/en/emails.json')).default;
  return {
    BRAND: { ink: '#000', muted: '#666', border: '#eee', accent: '#00f', panelBg: '#fafafa' },
    brandWrap: ({ bodyHtml }: { bodyHtml: string }) => `<html>${bodyHtml}</html>`,
    escapeHtml: (value: string) => value,
    getBaseUrl: () => 'https://markaestro.com',
    getEmailTranslator: async () => createTranslator({ locale: 'en', messages }),
    strongTag: { strong: (chunks: string) => `<strong>${chunks}</strong>` },
  };
});

function member(email: string) {
  return { data: () => ({ email }) };
}

const NOW_MS = Date.parse('2026-08-19T00:45:00.000Z');
const FIRST_INBOX_AT = '2026-08-19T00:30:00.000Z';
const STILL_TOO_SOON_AT = '2026-08-19T00:30:00.001Z';

function duePost(overrides: Record<string, unknown> = {}) {
  return {
    productId: 'prod_1',
    content: 'Caption',
    actionRequiredAt: new Date(Date.now() - 15 * 60_000).toISOString(),
    ...overrides,
  };
}

describe('TikTok inbox email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membersGet.mockResolvedValue({ docs: [member('owner@example.com')] });
    productGet.mockResolvedValue({ data: () => ({ name: 'EyeCash' }) });
    postUpdate.mockResolvedValue(undefined);
  });

  it('waits until TikTok has had time to surface the inbox notification', async () => {
    const { isTikTokInboxEmailDue, TIKTOK_INBOX_EMAIL_DELAY_MS } = await import('@/lib/tiktok-inbox-emails');

    expect(TIKTOK_INBOX_EMAIL_DELAY_MS).toBe(15 * 60_000);
    expect(isTikTokInboxEmailDue({ productId: 'prod_1' }, NOW_MS)).toBe(false);
    expect(isTikTokInboxEmailDue({ actionRequiredAt: STILL_TOO_SOON_AT }, NOW_MS)).toBe(false);
    expect(isTikTokInboxEmailDue({ actionRequiredAt: FIRST_INBOX_AT }, NOW_MS)).toBe(true);
    expect(isTikTokInboxEmailDue({
      actionRequiredAt: FIRST_INBOX_AT,
      tiktokInboxEmailSentAt: FIRST_INBOX_AT,
    }, NOW_MS)).toBe(false);
  });

  it('tells the creator the post is not live and how to finish it', async () => {
    const { tiktokInboxEmail } = await import('@/lib/tiktok-inbox-emails');
    const payload = await tiktokInboxEmail({ brandName: 'EyeCash', caption: 'Track every receipt', locale: 'en' });

    expect(payload.subject).toBe('Finish your TikTok post for EyeCash');
    // The whole point of the mail: it is NOT published yet.
    expect(payload.html).toMatch(/not live yet/i);
    expect(payload.html).toMatch(/Open the TikTok app/);
    expect(payload.text).toMatch(/Open the TikTok app/);
    expect(payload.html).toContain('Track every receipt');
  });

  it('includes the full caption so it can be copied into TikTok', async () => {
    const { tiktokInboxEmail } = await import('@/lib/tiktok-inbox-emails');
    const caption = `${'Save every receipt with EyeCash. '.repeat(12)}#eyecash #receipts`;
    const payload = await tiktokInboxEmail({ brandName: 'EyeCash', caption, locale: 'en' });

    expect(caption.length).toBeGreaterThan(240);
    expect(payload.html).toContain(caption);
    expect(payload.text).toContain(caption);
    expect(payload.html).not.toContain(`${caption.slice(0, 240)}…`);
    expect(payload.text).not.toContain(`${caption.slice(0, 240)}…`);
  });

  it('does not send on the first SEND_TO_USER_INBOX — the TikTok app notification lags', async () => {
    const { sendTikTokInboxEmail } = await import('@/lib/tiktok-inbox-emails');
    await sendTikTokInboxEmail('ws_1', 'post_1', { productId: 'prod_1', content: 'Caption' });
    await sendTikTokInboxEmail('ws_1', 'post_1', duePost({
      actionRequiredAt: new Date(Date.now() - 14 * 60_000).toISOString(),
    }));

    expect(sendResendEmailMock).not.toHaveBeenCalled();
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it('sends to workspace owners and records that it went out', async () => {
    const { sendTikTokInboxEmail } = await import('@/lib/tiktok-inbox-emails');
    await sendTikTokInboxEmail('ws_1', 'post_1', duePost());

    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendResendEmailMock.mock.calls[0][0].to).toEqual(['owner@example.com']);
    expect(postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ tiktokInboxEmailSentAt: expect.any(String) }),
    );
  });

  it('never mails twice for the same post', async () => {
    const { sendTikTokInboxEmail } = await import('@/lib/tiktok-inbox-emails');
    // The poll worker can revisit a post; the stamp is what stops a repeat.
    await sendTikTokInboxEmail('ws_1', 'post_1', duePost({
      tiktokInboxEmailSentAt: '2026-08-08T12:00:00.000Z',
    }));

    expect(sendResendEmailMock).not.toHaveBeenCalled();
  });

  it('never throws when mail delivery fails', async () => {
    sendResendEmailMock.mockRejectedValueOnce(new Error('EMAIL_SEND_FAILED'));
    const { sendTikTokInboxEmail } = await import('@/lib/tiktok-inbox-emails');

    // The video already reached TikTok — a mail failure must not change that.
    await expect(
      sendTikTokInboxEmail('ws_1', 'post_1', duePost()),
    ).resolves.toBeUndefined();
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it('still sends when the brand name cannot be read', async () => {
    productGet.mockRejectedValueOnce(new Error('firestore down'));
    const { sendTikTokInboxEmail } = await import('@/lib/tiktok-inbox-emails');
    await sendTikTokInboxEmail('ws_1', 'post_1', duePost());

    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendResendEmailMock.mock.calls[0][0].subject).toBe('Finish your TikTok post');
  });
});

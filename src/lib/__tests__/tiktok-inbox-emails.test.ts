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

describe('TikTok inbox email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membersGet.mockResolvedValue({ docs: [member('owner@example.com')] });
    productGet.mockResolvedValue({ data: () => ({ name: 'EyeCash' }) });
    postUpdate.mockResolvedValue(undefined);
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

  it('sends to workspace owners and records that it went out', async () => {
    const { sendTikTokInboxEmail } = await import('@/lib/tiktok-inbox-emails');
    await sendTikTokInboxEmail('ws_1', 'post_1', { productId: 'prod_1', content: 'Caption' });

    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendResendEmailMock.mock.calls[0][0].to).toEqual(['owner@example.com']);
    expect(postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ tiktokInboxEmailSentAt: expect.any(String) }),
    );
  });

  it('never mails twice for the same post', async () => {
    const { sendTikTokInboxEmail } = await import('@/lib/tiktok-inbox-emails');
    // The poll worker can revisit a post; the stamp is what stops a repeat.
    await sendTikTokInboxEmail('ws_1', 'post_1', {
      productId: 'prod_1',
      content: 'Caption',
      tiktokInboxEmailSentAt: '2026-08-08T12:00:00.000Z',
    });

    expect(sendResendEmailMock).not.toHaveBeenCalled();
  });

  it('never throws when mail delivery fails', async () => {
    sendResendEmailMock.mockRejectedValueOnce(new Error('EMAIL_SEND_FAILED'));
    const { sendTikTokInboxEmail } = await import('@/lib/tiktok-inbox-emails');

    // The video already reached TikTok — a mail failure must not change that.
    await expect(
      sendTikTokInboxEmail('ws_1', 'post_1', { productId: 'prod_1', content: 'Caption' }),
    ).resolves.toBeUndefined();
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it('still sends when the brand name cannot be read', async () => {
    productGet.mockRejectedValueOnce(new Error('firestore down'));
    const { sendTikTokInboxEmail } = await import('@/lib/tiktok-inbox-emails');
    await sendTikTokInboxEmail('ws_1', 'post_1', { productId: 'prod_1', content: 'Caption' });

    expect(sendResendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendResendEmailMock.mock.calls[0][0].subject).toBe('Finish your TikTok post');
  });
});

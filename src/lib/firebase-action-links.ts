import { adminAuth } from '@/lib/firebase-admin';
import { getAppUrl } from '@/lib/oauth/config';

function getActionHandlerUrl(): string {
  return `${getAppUrl()}/auth/action`;
}

function getActionCodeSettings() {
  return {
    url: getActionHandlerUrl(),
    handleCodeInApp: true,
  };
}

export async function createPasswordResetLink(email: string): Promise<string> {
  return adminAuth.generatePasswordResetLink(email, getActionCodeSettings());
}

export async function createEmailVerificationLink(uid: string): Promise<{ email: string; link: string }> {
  const user = await adminAuth.getUser(uid);
  const email = user.email || '';
  if (!email) {
    throw new Error('VALIDATION_MISSING_EMAIL');
  }
  const link = await adminAuth.generateEmailVerificationLink(email, getActionCodeSettings());
  return { email, link };
}

export async function createVerifyAndChangeEmailLink(params: {
  uid: string;
  newEmail: string;
}): Promise<string> {
  return adminAuth.generateVerifyAndChangeEmailLink(params.uid, params.newEmail, getActionCodeSettings());
}


export const LINKEDIN_PUBLIC_PROVIDER = 'linkedin';
export const LINKEDIN_PROFILE_PROVIDER = 'linkedin_profile';
export const LINKEDIN_COMMUNITY_PROVIDER = 'linkedin_community';

export type LinkedInCredentialKind = 'profile' | 'community';
export type LinkedInConnectionProvider =
  | typeof LINKEDIN_PUBLIC_PROVIDER
  | typeof LINKEDIN_PROFILE_PROVIDER
  | typeof LINKEDIN_COMMUNITY_PROVIDER;

export const LINKEDIN_CONNECTION_PROVIDERS = [
  LINKEDIN_PROFILE_PROVIDER,
  LINKEDIN_COMMUNITY_PROVIDER,
  LINKEDIN_PUBLIC_PROVIDER,
] as const;

export function parseLinkedInCredentialKind(value: unknown): LinkedInCredentialKind | undefined {
  return value === 'profile' || value === 'community' ? value : undefined;
}

export function linkedinStorageProviderForKind(kind: LinkedInCredentialKind): string {
  return kind === 'community' ? LINKEDIN_COMMUNITY_PROVIDER : LINKEDIN_PROFILE_PROVIDER;
}

export function linkedinCredentialKindForProvider(provider: string): LinkedInCredentialKind | undefined {
  if (provider === LINKEDIN_PROFILE_PROVIDER) return 'profile';
  if (provider === LINKEDIN_COMMUNITY_PROVIDER) return 'community';
  return undefined;
}

export function isLinkedInConnectionProvider(provider: string): provider is LinkedInConnectionProvider {
  return provider === LINKEDIN_PUBLIC_PROVIDER ||
    provider === LINKEDIN_PROFILE_PROVIDER ||
    provider === LINKEDIN_COMMUNITY_PROVIDER;
}

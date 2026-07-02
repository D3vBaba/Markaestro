import { fetchWithRetry } from '@/lib/fetch-retry';
import type { PlatformConnection } from './types';

export const LINKEDIN_API = 'https://api.linkedin.com/rest';
const LINKEDIN_LEGACY_API = 'https://api.linkedin.com/v2';
const LINKEDIN_USERINFO = 'https://api.linkedin.com/v2/userinfo';

export type LinkedInDestinationType = 'profile' | 'page';

export type LinkedInDestination = {
  id: string;
  urn: string;
  type: LinkedInDestinationType;
  name: string;
  role?: string;
  vanityName?: string;
  pictureUrl?: string;
};

export type LinkedInDiscovery = {
  profile: LinkedInDestination;
  pages: LinkedInDestination[];
  pageDiscoveryError?: string;
};

type LinkedInProfile = {
  id: string;
  name: string;
  pictureUrl?: string;
};

const LINKEDIN_PUBLISHING_ORGANIZATION_ROLES = new Set([
  'ADMINISTRATOR',
  'CONTENT_ADMINISTRATOR',
  'DIRECT_SPONSORED_CONTENT_POSTER',
]);

export class LinkedInApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'LinkedInApiError';
    this.status = status;
    this.code = code;
  }
}

export function linkedinApiVersion(): string {
  return process.env.LINKEDIN_API_VERSION?.trim() || '202606';
}

export function linkedinRestHeaders(accessToken: string, contentType?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Linkedin-Version': linkedinApiVersion(),
    'X-Restli-Protocol-Version': '2.0.0',
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };
}

export function parseLinkedInScopes(scopeValue: unknown): string[] {
  if (Array.isArray(scopeValue)) {
    return scopeValue.filter((scope): scope is string => typeof scope === 'string' && scope.trim().length > 0);
  }
  if (typeof scopeValue !== 'string') return [];
  return scopeValue
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function hasLinkedInScope(connection: PlatformConnection, scope: string): boolean {
  const fromLinkedIn = parseLinkedInScopes(connection.metadata.linkedinScopes);
  const fromOAuth = parseLinkedInScopes(connection.metadata.oauthScopes);
  return new Set([...fromLinkedIn, ...fromOAuth]).has(scope);
}

export function sanitizeLinkedInError(error: unknown): string {
  if (error instanceof LinkedInApiError) {
    return `LinkedIn API error (${error.status}): ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return 'LinkedIn API request failed';
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function linkedinErrorMessage(data: unknown, fallback: string): { message: string; code?: string } {
  const record = asRecord(data);
  if (!record) return { message: fallback };
  const message =
    asString(record.message) ||
    asString(record.error_description) ||
    asString(record.error) ||
    fallback;
  const code =
    asString(record.code) ||
    asString(record.serviceErrorCode) ||
    asString(record.error);
  return { message, code: code || undefined };
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

async function linkedInRestFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {},
  options: { maxRetries?: number } = {},
): Promise<{ res: Response; data: unknown }> {
  const contentType = init.body ? 'application/json' : undefined;
  const res = await fetchWithRetry(`${LINKEDIN_API}${path}`, {
    ...init,
    headers: {
      ...linkedinRestHeaders(accessToken, contentType),
      ...(init.headers || {}),
    },
  }, { maxRetries: options.maxRetries ?? 2 });
  const data = await readJson(res);
  if (!res.ok) {
    const { message, code } = linkedinErrorMessage(data, res.statusText);
    throw new LinkedInApiError(res.status, message, code);
  }
  return { res, data };
}

async function fetchLinkedInLegacyProfile(accessToken: string): Promise<LinkedInProfile> {
  const res = await fetchWithRetry(
    `${LINKEDIN_LEGACY_API}/me?projection=(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { maxRetries: 1 },
  );
  const data = await readJson(res);
  if (!res.ok) {
    const { message, code } = linkedinErrorMessage(data, res.statusText);
    throw new LinkedInApiError(res.status, message, code);
  }
  const record = asRecord(data) || {};
  const id = asString(record.id);
  if (!id) throw new LinkedInApiError(422, 'LinkedIn profile response missing member id');
  const firstName = asString(record.localizedFirstName);
  const lastName = asString(record.localizedLastName);
  const pictureUrl = extractLinkedInPictureUrl(record.profilePicture);
  return {
    id,
    name: [firstName, lastName].filter(Boolean).join(' ') || 'LinkedIn Profile',
    ...(pictureUrl ? { pictureUrl } : {}),
  };
}

async function fetchLinkedInOidcProfile(accessToken: string): Promise<LinkedInProfile> {
  const res = await fetchWithRetry(
    LINKEDIN_USERINFO,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { maxRetries: 1 },
  );
  const data = await readJson(res);
  if (!res.ok) {
    const { message, code } = linkedinErrorMessage(data, res.statusText);
    throw new LinkedInApiError(res.status, message, code);
  }
  const record = asRecord(data) || {};
  const id = asString(record.sub);
  if (!id) throw new LinkedInApiError(422, 'LinkedIn userinfo response missing subject');
  return {
    id,
    name: asString(record.name) || asString(record.given_name) || 'LinkedIn Profile',
    ...(asString(record.picture) ? { pictureUrl: asString(record.picture) } : {}),
  };
}

export async function fetchLinkedInProfile(accessToken: string): Promise<LinkedInDestination> {
  let profile: LinkedInProfile;
  try {
    profile = await fetchLinkedInLegacyProfile(accessToken);
  } catch (error) {
    if (error instanceof LinkedInApiError && (error.status === 401 || error.status === 403)) {
      profile = await fetchLinkedInOidcProfile(accessToken);
    } else {
      throw error;
    }
  }
  return {
    id: profile.id,
    urn: `urn:li:person:${profile.id}`,
    type: 'profile',
    name: profile.name,
    ...(profile.pictureUrl ? { pictureUrl: profile.pictureUrl } : {}),
  };
}

function extractOrganizationId(urn: string): string {
  return urn.split(':').pop() || urn;
}

function extractLinkedInPictureUrl(value: unknown): string | undefined {
  const record = asRecord(value);
  const display = asRecord(record?.['displayImage~']);
  const elements = Array.isArray(display?.elements) ? display.elements : [];
  for (const element of elements) {
    const elementRecord = asRecord(element);
    const identifiers = Array.isArray(elementRecord?.identifiers) ? elementRecord.identifiers : [];
    const identifier = identifiers
      .map(asRecord)
      .find((item) => asString(item?.identifier));
    if (identifier) return asString(identifier.identifier);
  }
  return undefined;
}

async function fetchLinkedInOrganization(
  accessToken: string,
  organizationId: string,
): Promise<{ name?: string; vanityName?: string; pictureUrl?: string }> {
  try {
    const { data } = await linkedInRestFetch(accessToken, `/organizations/${encodeURIComponent(organizationId)}`, {}, { maxRetries: 1 });
    const record = asRecord(data) || {};
    return {
      name: asString(record.localizedName) || asString(record.name),
      vanityName: asString(record.vanityName),
      pictureUrl: extractLinkedInPictureUrl(record.logoV2),
    };
  } catch (error) {
    if (error instanceof LinkedInApiError && error.status === 403) {
      return {};
    }
    throw error;
  }
}

export async function fetchLinkedInPages(accessToken: string): Promise<LinkedInDestination[]> {
  const destinations = new Map<string, LinkedInDestination>();
  let start = 0;

  for (let page = 0; page < 10; page++) {
    const { data } = await linkedInRestFetch(
      accessToken,
      `/organizationAcls?q=roleAssignee&state=APPROVED&count=100&start=${start}`,
      {},
      { maxRetries: 1 },
    );
    const record = asRecord(data) || {};
    const elements = Array.isArray(record.elements) ? record.elements : [];

    for (const element of elements) {
      const current = asRecord(element);
      if (!current) continue;
      const role = asString(current.role);
      const urn = asString(current.organization);
      if (!urn || !LINKEDIN_PUBLISHING_ORGANIZATION_ROLES.has(role)) continue;
      const id = extractOrganizationId(urn);
      if (!id || destinations.has(id)) continue;
      destinations.set(id, {
        id,
        urn,
        type: 'page',
        name: `LinkedIn Page ${id}`,
        role,
      });
    }

    const paging = asRecord(record.paging);
    const count = typeof paging?.count === 'number' ? paging.count : elements.length;
    if (elements.length < count || elements.length === 0) break;
    start += count || 100;
  }

  await Promise.all([...destinations.values()].map(async (destination) => {
    try {
      const organization = await fetchLinkedInOrganization(accessToken, destination.id);
      destination.name = organization.name || destination.name;
      if (organization.vanityName) destination.vanityName = organization.vanityName;
      if (organization.pictureUrl) destination.pictureUrl = organization.pictureUrl;
    } catch {
      // Keep the fallback label; discovery should not fail because a Page name
      // lookup is unavailable for one organization.
    }
  }));

  return [...destinations.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function discoverLinkedInDestinations(
  accessToken: string,
  scopeValue?: unknown,
): Promise<LinkedInDiscovery> {
  const profile = await fetchLinkedInProfile(accessToken);
  const scopes = new Set(parseLinkedInScopes(scopeValue));

  try {
    const pages = scopes.has('rw_organization_admin') || scopes.has('r_organization_admin')
      ? await fetchLinkedInPages(accessToken)
      : [];
    return { profile, pages };
  } catch (error) {
    return {
      profile,
      pages: [],
      pageDiscoveryError: sanitizeLinkedInError(error),
    };
  }
}

export function linkedinMetadataFromDiscovery(
  discovery: LinkedInDiscovery,
  scopeValue?: unknown,
): Record<string, unknown> {
  const scopes = parseLinkedInScopes(scopeValue);
  return {
    linkedinProfileId: discovery.profile.id,
    linkedinProfileUrn: discovery.profile.urn,
    linkedinProfileName: discovery.profile.name,
    linkedinProfilePictureUrl: discovery.profile.pictureUrl || null,
    linkedinPages: discovery.pages,
    linkedinDestinationUrn: discovery.profile.urn,
    linkedinDestinationType: 'profile',
    linkedinDestinationName: discovery.profile.name,
    linkedinDestinationAccountId: discovery.profile.id,
    linkedinDestinationSelectionRequired: false,
    linkedinScopes: scopes,
    ...(discovery.pageDiscoveryError ? { linkedinPageDiscoveryError: discovery.pageDiscoveryError } : { linkedinPageDiscoveryError: null }),
  };
}

export function linkedinProfileMetadataFromDiscovery(
  discovery: LinkedInDiscovery,
  scopeValue?: unknown,
): Record<string, unknown> {
  const scopes = parseLinkedInScopes(scopeValue);
  return {
    linkedinCredentialKind: 'profile',
    linkedinProfileId: discovery.profile.id,
    linkedinProfileUrn: discovery.profile.urn,
    linkedinProfileName: discovery.profile.name,
    linkedinProfilePictureUrl: discovery.profile.pictureUrl || null,
    linkedinPages: [],
    linkedinDestinationUrn: discovery.profile.urn,
    linkedinDestinationType: 'profile',
    linkedinDestinationName: discovery.profile.name,
    linkedinDestinationAccountId: discovery.profile.id,
    linkedinDestinationSelectionRequired: false,
    linkedinScopes: scopes,
    linkedinPageDiscoveryError: null,
  };
}

export function linkedinCommunityMetadataFromDiscovery(
  discovery: LinkedInDiscovery,
  scopeValue?: unknown,
): Record<string, unknown> {
  const scopes = parseLinkedInScopes(scopeValue);
  return {
    linkedinCredentialKind: 'community',
    linkedinAuthorizingProfileId: discovery.profile.id,
    linkedinAuthorizingProfileUrn: discovery.profile.urn,
    linkedinAuthorizingProfileName: discovery.profile.name,
    linkedinAuthorizingProfilePictureUrl: discovery.profile.pictureUrl || null,
    linkedinProfileId: null,
    linkedinProfileUrn: null,
    linkedinProfileName: null,
    linkedinProfilePictureUrl: null,
    linkedinPages: discovery.pages,
    linkedinDestinationUrn: null,
    linkedinDestinationType: null,
    linkedinDestinationName: null,
    linkedinDestinationAccountId: null,
    linkedinDestinationSelectionRequired: discovery.pages.length > 0,
    linkedinScopes: scopes,
    ...(discovery.pageDiscoveryError ? { linkedinPageDiscoveryError: discovery.pageDiscoveryError } : { linkedinPageDiscoveryError: null }),
  };
}

export function getStoredLinkedInDestinations(connection: PlatformConnection): LinkedInDestination[] {
  const metadata = connection.metadata || {};
  const destinations: LinkedInDestination[] = [];
  const profileId = asString(metadata.linkedinProfileId);
  const profileUrn = asString(metadata.linkedinProfileUrn);
  const profileName = asString(metadata.linkedinProfileName);

  if (profileId && profileUrn) {
    destinations.push({
      id: profileId,
      urn: profileUrn,
      type: 'profile',
      name: profileName || 'LinkedIn Profile',
      ...(asString(metadata.linkedinProfilePictureUrl) ? { pictureUrl: asString(metadata.linkedinProfilePictureUrl) } : {}),
    });
  }

  const pages = Array.isArray(metadata.linkedinPages) ? metadata.linkedinPages : [];
  for (const page of pages) {
    const record = asRecord(page);
    if (!record) continue;
    const id = asString(record.id) || extractOrganizationId(asString(record.urn));
    const urn = asString(record.urn) || (id ? `urn:li:organization:${id}` : '');
    if (!id || !urn) continue;
    destinations.push({
      id,
      urn,
      type: 'page',
      name: asString(record.name) || `LinkedIn Page ${id}`,
      role: asString(record.role) || undefined,
      vanityName: asString(record.vanityName) || undefined,
      pictureUrl: asString(record.pictureUrl) || undefined,
    });
  }

  return destinations;
}

export function getSelectedLinkedInDestination(connection: PlatformConnection): LinkedInDestination | null {
  const metadata = connection.metadata || {};
  const selectedUrn = asString(metadata.linkedinDestinationUrn);
  const selectedId = asString(metadata.linkedinDestinationAccountId);
  const destinations = getStoredLinkedInDestinations(connection);
  return destinations.find((destination) =>
    (selectedUrn && destination.urn === selectedUrn) ||
    (selectedId && destination.id === selectedId)
  ) || destinations[0] || null;
}

export function matchLinkedInDestination(
  connection: PlatformConnection,
  destinationId?: string,
): LinkedInDestination | null {
  const destinations = getStoredLinkedInDestinations(connection);
  if (!destinationId) return getSelectedLinkedInDestination(connection);

  const requested = destinationId.startsWith('linkedin:linkedin:')
    ? destinationId.slice('linkedin:linkedin:'.length)
    : destinationId;

  return destinations.find((destination) =>
    destination.id === requested ||
    destination.urn === requested ||
    `linkedin:linkedin:${destination.id}` === destinationId
  ) || null;
}

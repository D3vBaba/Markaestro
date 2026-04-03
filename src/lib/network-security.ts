import dns from 'node:dns/promises';
import net from 'node:net';

const DISALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
]);

const DISALLOWED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.home.arpa',
];

const MAX_DNS_LOOKUPS = 10;

function normalizeHostname(hostname: string): string {
  return hostname.trim().replace(/\.+$/, '').toLowerCase();
}

function ipv4ToNumber(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0);
}

function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToNumber(ip);
  const ranges: Array<[number, number]> = [
    [ipv4ToNumber('0.0.0.0'), ipv4ToNumber('0.255.255.255')],
    [ipv4ToNumber('10.0.0.0'), ipv4ToNumber('10.255.255.255')],
    [ipv4ToNumber('100.64.0.0'), ipv4ToNumber('100.127.255.255')],
    [ipv4ToNumber('127.0.0.0'), ipv4ToNumber('127.255.255.255')],
    [ipv4ToNumber('169.254.0.0'), ipv4ToNumber('169.254.255.255')],
    [ipv4ToNumber('172.16.0.0'), ipv4ToNumber('172.31.255.255')],
    [ipv4ToNumber('192.0.0.0'), ipv4ToNumber('192.0.0.255')],
    [ipv4ToNumber('192.0.2.0'), ipv4ToNumber('192.0.2.255')],
    [ipv4ToNumber('192.168.0.0'), ipv4ToNumber('192.168.255.255')],
    [ipv4ToNumber('198.18.0.0'), ipv4ToNumber('198.19.255.255')],
    [ipv4ToNumber('198.51.100.0'), ipv4ToNumber('198.51.100.255')],
    [ipv4ToNumber('203.0.113.0'), ipv4ToNumber('203.0.113.255')],
    [ipv4ToNumber('224.0.0.0'), ipv4ToNumber('255.255.255.255')],
  ];

  return ranges.some(([start, end]) => value >= start && value <= end);
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  ) {
    return true;
  }

  const mappedV4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedV4) {
    return isPrivateIpv4(mappedV4[1]);
  }

  return false;
}

function isPrivateIpAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return false;
}

async function resolvesToPrivateAddress(hostname: string): Promise<boolean> {
  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    return addresses
      .slice(0, MAX_DNS_LOOKUPS)
      .some(({ address }) => isPrivateIpAddress(address));
  } catch {
    return false;
  }
}

export async function assertSafeOutboundUrl(
  rawUrl: string,
  options?: { httpsOnly?: boolean },
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('VALIDATION_INVALID_REMOTE_URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('VALIDATION_INVALID_REMOTE_URL');
  }

  if (options?.httpsOnly && parsed.protocol !== 'https:') {
    throw new Error('VALIDATION_REMOTE_URL_NOT_ALLOWED');
  }

  if (parsed.username || parsed.password) {
    throw new Error('VALIDATION_REMOTE_URL_NOT_ALLOWED');
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (
    !hostname ||
    DISALLOWED_HOSTS.has(hostname) ||
    DISALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error('VALIDATION_REMOTE_URL_NOT_ALLOWED');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      throw new Error('VALIDATION_REMOTE_URL_NOT_ALLOWED');
    }
    return parsed;
  }

  if (await resolvesToPrivateAddress(hostname)) {
    throw new Error('VALIDATION_REMOTE_URL_NOT_ALLOWED');
  }

  return parsed;
}

export async function readResponseBufferWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length') || '0');
  if (contentLength > maxBytes) {
    throw new Error('VALIDATION_REMOTE_FILE_TOO_LARGE');
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error('VALIDATION_REMOTE_FILE_TOO_LARGE');
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('VALIDATION_REMOTE_FILE_TOO_LARGE');
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const buffer = await readResponseBufferWithLimit(response, maxBytes);
  return buffer.toString('utf8');
}

export function sanitizeAppReturnTo(rawReturnTo: string, appUrl: string): string | null {
  try {
    const appBase = new URL(appUrl);
    const target = new URL(rawReturnTo, appBase);
    if (target.origin !== appBase.origin) {
      return null;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

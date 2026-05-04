import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, platform, tmpdir } from 'node:os';
import path from 'node:path';

function getFfmpegInstallerPlatform(): string | null {
  const osPlatform = platform();
  const osArch = arch();
  if (osPlatform === 'darwin' && (osArch === 'arm64' || osArch === 'x64')) return `darwin-${osArch}`;
  if (osPlatform === 'linux' && ['arm', 'arm64', 'ia32', 'x64'].includes(osArch)) return `linux-${osArch}`;
  if (osPlatform === 'win32' && (osArch === 'ia32' || osArch === 'x64')) return `win32-${osArch}`;
  return null;
}

function resolveFfmpegBinary(): string | null {
  if (process.env.FFMPEG_BIN && existsSync(process.env.FFMPEG_BIN)) {
    return process.env.FFMPEG_BIN;
  }

  const installerPlatform = getFfmpegInstallerPlatform();
  if (!installerPlatform) return null;

  const binary = platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), 'node_modules', '@ffmpeg-installer', installerPlatform, binary),
    path.join(/*turbopackIgnore: true*/ process.cwd(), '.next', 'standalone', 'node_modules', '@ffmpeg-installer', installerPlatform, binary),
    path.join(path.dirname(process.execPath), 'node_modules', '@ffmpeg-installer', installerPlatform, binary),
  ];

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function runFfmpeg(args: string[]): Promise<void> {
  const binary = resolveFfmpegBinary();
  if (!binary) {
    return Promise.reject(new Error('ffmpeg binary is not available'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args);
    const stderr: Buffer[] = [];

    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(Buffer.from(chunk));
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      const message = Buffer.concat(stderr).toString('utf8').slice(-1200);
      reject(new Error(`ffmpeg exited with code ${code}${message ? `: ${message}` : ''}`));
    });
  });
}

// TikTok rejects videos that fail any of:
//  - frame rate outside 23–60 fps (errors as "frame rate check failed")
//  - variable frame rate (same error)
//  - resolution under 540×960 (silently stuck in PROCESSING_UPLOAD)
// AI generators commonly emit 8–24 fps at 400–512 px short side, which trips
// at least two of these. Every upload is force-normalised to 30 fps CFR with
// the short side scaled up to 720 px (≥ TikTok minimum, leaving headroom).
// Adds ~5–15s per upload, eliminates the entire failure class.
export async function transcodeForTikTok(buffer: Buffer, hasAudio: boolean): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markaestro-tiktok-'));
  const inputPath = path.join(dir, 'input.mp4');
  const outputPath = path.join(dir, 'output.mp4');

  try {
    await writeFile(inputPath, buffer);
    const args = ['-y', '-i', inputPath];
    if (!hasAudio) {
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-shortest');
    }
    args.push(
      '-r', '30',
      '-vsync', 'cfr',
      // Scale so the shorter side is 720 px (≥ TikTok's 540 minimum). For
      // portrait inputs (iw ≤ ih) set width=720, auto-compute height; for
      // landscape, the inverse. -2 forces even output dimensions for x264.
      '-vf', 'scale=if(gt(iw\\,ih)\\,-2\\,720):if(gt(iw\\,ih)\\,720\\,-2):flags=lanczos,setsar=1',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-movflags', '+faststart',
      outputPath,
    );
    await runFfmpeg(args);
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

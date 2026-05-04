/**
 * Detect whether an mp4/mov/m4a buffer contains an audio track.
 *
 * The parser walks the ISO BMFF box structure looking for any `trak` whose
 * `mdia/hdlr` has a handler_type of `soun`. It is intentionally minimal: we
 * only need a yes/no answer before deciding whether TikTok needs a silent AAC
 * track added during file upload.
 */

const HEADER_SIZE = 8;
const HDLR_HANDLER_TYPE_OFFSET = 8; // version+flags(4) + pre_defined(4)

type DetectResult =
  | { kind: 'has_audio' }
  | { kind: 'no_audio' }
  | { kind: 'unknown'; reason: string };

export function detectMp4Audio(buffer: Buffer): DetectResult {
  const moov = findTopLevelBox(buffer, 0, buffer.length, 'moov');
  if (!moov) {
    return { kind: 'unknown', reason: 'moov box not found' };
  }

  let pos = moov.contentStart;
  while (pos + HEADER_SIZE <= moov.contentEnd) {
    const box = readBoxHeader(buffer, pos, moov.contentEnd);
    if (!box) break;

    if (box.type === 'trak' && trakHasAudioHandler(buffer, box.contentStart, box.contentEnd)) {
      return { kind: 'has_audio' };
    }

    pos = box.end;
  }

  return { kind: 'no_audio' };
}

type Box = {
  type: string;
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
};

function readBoxHeader(buffer: Buffer, offset: number, max: number): Box | null {
  if (offset + HEADER_SIZE > max) return null;
  const declaredSize = buffer.readUInt32BE(offset);
  const type = buffer.toString('ascii', offset + 4, offset + 8);

  let contentStart = offset + HEADER_SIZE;
  let totalSize: number;

  if (declaredSize === 1) {
    if (offset + 16 > max) return null;
    const high = buffer.readUInt32BE(offset + 8);
    const low = buffer.readUInt32BE(offset + 12);
    totalSize = high * 0x1_0000_0000 + low;
    contentStart = offset + 16;
  } else if (declaredSize === 0) {
    totalSize = max - offset;
  } else if (declaredSize < HEADER_SIZE) {
    return null;
  } else {
    totalSize = declaredSize;
  }

  const end = offset + totalSize;
  if (end > max || end <= offset) return null;

  return { type, start: offset, contentStart, contentEnd: end, end };
}

function findTopLevelBox(buffer: Buffer, start: number, end: number, type: string): Box | null {
  let pos = start;
  while (pos + HEADER_SIZE <= end) {
    const box = readBoxHeader(buffer, pos, end);
    if (!box) return null;
    if (box.type === type) return box;
    pos = box.end;
  }
  return null;
}

function findChildBox(buffer: Buffer, parent: { contentStart: number; contentEnd: number }, type: string): Box | null {
  return findTopLevelBox(buffer, parent.contentStart, parent.contentEnd, type);
}

function trakHasAudioHandler(buffer: Buffer, start: number, end: number): boolean {
  const mdia = findTopLevelBox(buffer, start, end, 'mdia');
  if (!mdia) return false;

  const hdlr = findChildBox(buffer, mdia, 'hdlr');
  if (!hdlr) return false;

  if (hdlr.contentStart + HDLR_HANDLER_TYPE_OFFSET + 4 > hdlr.contentEnd) return false;
  const handlerType = buffer.toString(
    'ascii',
    hdlr.contentStart + HDLR_HANDLER_TYPE_OFFSET,
    hdlr.contentStart + HDLR_HANDLER_TYPE_OFFSET + 4,
  );
  return handlerType === 'soun';
}

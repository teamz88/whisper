/**
 * Ogg container for Opus packets (RFC 7845), in memory.
 *
 * The encoder (opus.ts) produces bare Opus packets; Whisper-style transcription
 * APIs want a file, and .ogg is the container every provider we use accepts
 * (Groq, OpenAI, Azure OpenAI). The format is small enough to write by hand:
 * an ID header page, a comment header page, then audio pages, each one
 * "OggS" + a 27-byte header + a lacing table + the packet bytes, protected by
 * a CRC-32.
 */

/** Ogg's CRC-32: polynomial 0x04C11DB7, no reflection, initial value 0, no final xor. */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let r = i << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    }
    table[i] = r >>> 0;
  }
  return table;
})();

export function oggCrc32(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]!) & 0xff]!) >>> 0;
  }
  return crc;
}

const FLAG_BOS = 0x02;
const FLAG_EOS = 0x04;

/** One page holds at most 255 lacing values. */
const MAX_SEGMENTS_PER_PAGE = 255;

/**
 * Pages are flushed after roughly a second of audio even when they could hold
 * more: it keeps any single page small and matches what libogg-based muxers do.
 */
const MAX_PACKETS_PER_PAGE = 50;

/** Opus granule positions always count 48 kHz samples, whatever the input rate. */
const OPUS_GRANULE_RATE = 48_000;

interface PageOptions {
  flags: number;
  granule: bigint;
  serial: number;
  sequence: number;
}

function lacingFor(packet: Uint8Array): number[] {
  const lacing: number[] = [];
  let remaining = packet.length;
  while (remaining >= 255) {
    lacing.push(255);
    remaining -= 255;
  }
  // A packet whose length is a multiple of 255 ends with a 0 lacing value.
  lacing.push(remaining);
  return lacing;
}

function buildPage(packets: readonly Uint8Array[], options: PageOptions): Buffer {
  const lacing = packets.flatMap(lacingFor);
  if (lacing.length > MAX_SEGMENTS_PER_PAGE) {
    throw new Error(`Ogg page would need ${lacing.length} segments (max ${MAX_SEGMENTS_PER_PAGE})`);
  }
  const bodyLength = packets.reduce((sum, packet) => sum + packet.length, 0);
  const page = Buffer.alloc(27 + lacing.length + bodyLength);

  page.write('OggS', 0, 'ascii');
  page[4] = 0; // stream structure version
  page[5] = options.flags;
  page.writeBigInt64LE(options.granule, 6);
  page.writeUInt32LE(options.serial >>> 0, 14);
  page.writeUInt32LE(options.sequence >>> 0, 18);
  page.writeUInt32LE(0, 22); // CRC placeholder: computed over the page with this field zeroed
  page[26] = lacing.length;
  for (let i = 0; i < lacing.length; i += 1) page[27 + i] = lacing[i]!;

  let offset = 27 + lacing.length;
  for (const packet of packets) {
    page.set(packet, offset);
    offset += packet.length;
  }

  page.writeUInt32LE(oggCrc32(page), 22);
  return page;
}

function opusHead(channels: number, preSkip: number, inputSampleRate: number): Buffer {
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 'ascii');
  head[8] = 1; // version
  head[9] = channels;
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(inputSampleRate, 12); // informational only
  head.writeInt16LE(0, 16); // output gain
  head[18] = 0; // channel mapping family 0: mono or stereo, no mapping table
  return head;
}

function opusTags(vendor: string): Buffer {
  const vendorBytes = Buffer.from(vendor, 'utf8');
  const tags = Buffer.alloc(8 + 4 + vendorBytes.length + 4);
  tags.write('OpusTags', 0, 'ascii');
  tags.writeUInt32LE(vendorBytes.length, 8);
  vendorBytes.copy(tags, 12);
  tags.writeUInt32LE(0, 12 + vendorBytes.length); // no user comments
  return tags;
}

export interface OggOpusStream {
  /** Encoded Opus packets, in order, each covering `frameSize` input samples. */
  packets: readonly Uint8Array[];
  /** Samples per packet at `inputSampleRate`. */
  frameSize: number;
  /** Real (unpadded) sample count at `inputSampleRate`; trims the last frame's padding. */
  sampleCount: number;
  /** One of the rates Opus runs at natively: 8, 12, 16, 24 or 48 kHz. */
  inputSampleRate: number;
  /** Encoder lookahead to drop at the start, in 48 kHz samples. */
  preSkip: number;
  channels?: number;
  serial?: number;
  vendor?: string;
}

/** Wrap Opus packets into a complete .ogg file. */
export function muxOggOpus(stream: OggOpusStream): Buffer {
  const {
    packets,
    frameSize,
    sampleCount,
    inputSampleRate,
    preSkip,
    channels = 1,
    serial = 0x77687370, // "whsp"; any value works for a single, unchained stream
    vendor = 'whisper',
  } = stream;

  if (packets.length === 0) throw new Error('No Opus packets to mux');
  if (OPUS_GRANULE_RATE % inputSampleRate !== 0) {
    throw new Error(`Unsupported Opus input rate ${inputSampleRate}`);
  }
  const scale = OPUS_GRANULE_RATE / inputSampleRate;

  const pages: Buffer[] = [];
  let sequence = 0;

  // The ID and comment headers each sit alone on their own page (RFC 7845 §3).
  pages.push(
    buildPage([opusHead(channels, preSkip, inputSampleRate)], {
      flags: FLAG_BOS,
      granule: 0n,
      serial,
      sequence: sequence++,
    }),
  );
  pages.push(buildPage([opusTags(vendor)], { flags: 0, granule: 0n, serial, sequence: sequence++ }));

  let pending: Uint8Array[] = [];
  let pendingSegments = 0;
  let packetsDone = 0;

  const flush = (last: boolean): void => {
    // The final granule uses the real sample count, which tells the decoder to
    // drop the zero padding the encoder added to fill the last frame.
    const samplesDone = last ? sampleCount : Math.min(packetsDone * frameSize, sampleCount);
    pages.push(
      buildPage(pending, {
        flags: last ? FLAG_EOS : 0,
        granule: BigInt(preSkip + samplesDone * scale),
        serial,
        sequence: sequence++,
      }),
    );
    pending = [];
    pendingSegments = 0;
  };

  for (const packet of packets) {
    const segments = lacingFor(packet).length;
    if (
      pending.length > 0 &&
      (pendingSegments + segments > MAX_SEGMENTS_PER_PAGE || pending.length >= MAX_PACKETS_PER_PAGE)
    ) {
      flush(false);
    }
    pending.push(packet);
    pendingSegments += segments;
    packetsDone += 1;
  }
  flush(true);

  return Buffer.concat(pages);
}

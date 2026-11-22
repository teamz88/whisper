import assert from 'node:assert/strict';
import { test } from 'node:test';

import OpusScript from 'opusscript';

import { encodeForUpload } from '../src/main/audio/encode.ts';
import { muxOggOpus, oggCrc32 } from '../src/main/audio/ogg-opus.ts';
import { encodeOggOpus, encodeOpusPackets } from '../src/main/audio/opus.ts';
import { encodeWav } from '../src/main/audio/wav.ts';

const RATE = 16_000;
const FRAME = 320; // 20 ms at 16 kHz
const PRE_SKIP_48K = 312;
const PRE_SKIP_16K = PRE_SKIP_48K / 3;

/** A voiced, speech-like signal: a 180 Hz harmonic stack under a 4 Hz syllable envelope. */
function speechLike(seconds: number): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / RATE;
    const envelope = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t);
    let voiced = 0;
    for (let harmonic = 1; harmonic <= 5; harmonic += 1) {
      voiced += Math.sin(2 * Math.PI * 180 * harmonic * t) / harmonic;
    }
    samples[i] = 0.25 * envelope * voiced;
  }
  return samples;
}

interface ParsedPage {
  flags: number;
  granule: bigint;
  serial: number;
  sequence: number;
  crcOk: boolean;
  packets: Buffer[];
  /** True when the page's last packet continues on the next page. */
  openPacket: boolean;
}

/** A strict little Ogg reader: every page must parse and pass its CRC. */
function parseOgg(file: Buffer): ParsedPage[] {
  const pages: ParsedPage[] = [];
  let offset = 0;
  while (offset < file.length) {
    assert.equal(file.toString('ascii', offset, offset + 4), 'OggS', `capture pattern at ${offset}`);
    assert.equal(file[offset + 4], 0, 'stream structure version');
    const segmentCount = file[offset + 26]!;
    const lacing = [...file.subarray(offset + 27, offset + 27 + segmentCount)];
    const bodyLength = lacing.reduce((sum, value) => sum + value, 0);
    const pageLength = 27 + segmentCount + bodyLength;

    const page = Buffer.from(file.subarray(offset, offset + pageLength));
    const storedCrc = page.readUInt32LE(22);
    page.writeUInt32LE(0, 22);

    const packets: Buffer[] = [];
    let body = offset + 27 + segmentCount;
    let current = 0;
    for (const value of lacing) {
      current += value;
      if (value < 255) {
        packets.push(Buffer.from(file.subarray(body, body + current)));
        body += current;
        current = 0;
      }
    }

    pages.push({
      flags: file[offset + 5]!,
      granule: file.readBigInt64LE(offset + 6),
      serial: file.readUInt32LE(offset + 14),
      sequence: file.readUInt32LE(offset + 18),
      crcOk: oggCrc32(page) === storedCrc,
      packets,
      openPacket: current > 0 || lacing.at(-1) === 255,
    });
    offset += pageLength;
  }
  return pages;
}

test('Ogg CRC matches the reference check value', () => {
  // CRC-32 with poly 0x04C11DB7, init 0, no reflection, no final xor.
  assert.equal(oggCrc32(Buffer.from('123456789', 'ascii')), 0x89a1897f);
});

test('the .ogg file is a valid Ogg Opus stream (RFC 7845)', () => {
  const samples = speechLike(1.37); // deliberately not a whole number of frames
  const file = encodeOggOpus(samples);
  const pages = parseOgg(file);

  assert.ok(pages.length >= 4, 'ID header, comment header, and audio pages');
  for (const [index, page] of pages.entries()) {
    assert.ok(page.crcOk, `page ${index} CRC`);
    assert.equal(page.sequence, index, 'page sequence numbers count up from 0');
    assert.equal(page.serial, pages[0]!.serial, 'one logical stream');
    assert.equal(page.openPacket, false, 'no packet spans pages');
  }

  // Beginning- and end-of-stream flags, exactly once each.
  assert.equal(pages[0]!.flags, 0x02);
  assert.equal(pages.at(-1)!.flags, 0x04);
  for (const page of pages.slice(1, -1)) assert.equal(page.flags, 0);

  // ID header.
  const head = pages[0]!.packets;
  assert.equal(head.length, 1);
  assert.equal(head[0]!.toString('ascii', 0, 8), 'OpusHead');
  assert.equal(head[0]![8], 1, 'version');
  assert.equal(head[0]![9], 1, 'mono');
  assert.equal(head[0]!.readUInt16LE(10), PRE_SKIP_48K);
  assert.equal(head[0]!.readUInt32LE(12), RATE);
  assert.equal(head[0]![18], 0, 'mapping family');
  assert.equal(pages[0]!.granule, 0n);

  // Comment header.
  assert.equal(pages[1]!.packets.length, 1);
  assert.equal(pages[1]!.packets[0]!.toString('ascii', 0, 8), 'OpusTags');
  assert.equal(pages[1]!.granule, 0n);

  // Audio: one packet per 20 ms frame, granules rising, the last one trimming the padding.
  const audio = pages.slice(2);
  const packetCount = audio.reduce((sum, page) => sum + page.packets.length, 0);
  assert.equal(packetCount, Math.ceil(samples.length / FRAME));
  for (let i = 1; i < audio.length; i += 1) {
    assert.ok(audio[i]!.granule >= audio[i - 1]!.granule, 'granule positions never go backwards');
  }
  assert.equal(audio.at(-1)!.granule, BigInt(PRE_SKIP_48K + samples.length * 3));
});

test('decoded audio matches what went in', () => {
  const samples = speechLike(2);
  const { packets, frameSize } = encodeOpusPackets(samples);
  assert.equal(frameSize, FRAME);

  const decoder = new OpusScript(RATE, 1, OpusScript.Application.AUDIO);
  const decodedChunks: Buffer[] = [];
  try {
    for (const packet of packets) decodedChunks.push(decoder.decode(packet));
  } finally {
    decoder.delete();
  }
  const pcm = Buffer.concat(decodedChunks);
  const decoded = new Float32Array(pcm.length / 2);
  for (let i = 0; i < decoded.length; i += 1) decoded[i] = pcm.readInt16LE(i * 2) / 0x8000;

  // Drop the encoder's lookahead, then compare the overlapping span, skipping the
  // first 100 ms where the codec is still converging.
  const aligned = decoded.subarray(PRE_SKIP_16K);
  const from = RATE / 10;
  const to = Math.min(samples.length, aligned.length);

  let dot = 0;
  let inputEnergy = 0;
  let outputEnergy = 0;
  for (let i = from; i < to; i += 1) {
    dot += samples[i]! * aligned[i]!;
    inputEnergy += samples[i]! ** 2;
    outputEnergy += aligned[i]! ** 2;
  }
  const correlation = dot / Math.sqrt(inputEnergy * outputEnergy);
  const rmsRatio = Math.sqrt(outputEnergy / inputEnergy);

  assert.ok(correlation > 0.95, `waveform correlation ${correlation.toFixed(3)}`);
  assert.ok(rmsRatio > 0.85 && rmsRatio < 1.15, `loudness ratio ${rmsRatio.toFixed(3)}`);
});

test('Opus is at least 5x smaller than WAV', () => {
  const samples = speechLike(30);
  const ogg = encodeOggOpus(samples);
  const wav = encodeWav(samples, RATE);
  assert.ok(
    ogg.byteLength * 5 < wav.byteLength,
    `ogg ${(ogg.byteLength / 1024).toFixed(0)} kB vs wav ${(wav.byteLength / 1024).toFixed(0)} kB`,
  );
});

test('a 90 s dictation encodes quickly', () => {
  const samples = speechLike(90);
  const startedAt = performance.now();
  const ogg = encodeOggOpus(samples);
  const elapsed = performance.now() - startedAt;
  // Generous bound so slower machines do not flake; ~0.55 s on a typical laptop.
  assert.ok(elapsed < 3_000, `encoded 90 s in ${elapsed.toFixed(0)} ms`);
  assert.ok(ogg.byteLength < 400 * 1024, `90 s is ${(ogg.byteLength / 1024).toFixed(0)} kB`);
});

test('encodeForUpload sends Opus normally', () => {
  const audio = encodeForUpload(speechLike(1), RATE);
  assert.equal(audio.format, 'opus');
  assert.equal(audio.filename, 'dictation.ogg');
  assert.equal(audio.mimetype, 'audio/ogg');
  assert.equal(audio.fallbackReason, undefined);
  assert.equal(audio.bytes.toString('ascii', 0, 4), 'OggS');
});

test('encodeForUpload falls back to WAV when Opus cannot encode', () => {
  // 44.1 kHz is not an Opus rate, so the encoder refuses — the dictation must still go out.
  const audio = encodeForUpload(new Float32Array(44_100).fill(0.1), 44_100);
  assert.equal(audio.format, 'wav');
  assert.equal(audio.filename, 'dictation.wav');
  assert.equal(audio.mimetype, 'audio/wav');
  assert.match(audio.fallbackReason ?? '', /44100/);
  assert.equal(audio.bytes.toString('ascii', 0, 4), 'RIFF');
});

test('the muxer rejects input it cannot represent', () => {
  assert.throws(() =>
    muxOggOpus({ packets: [], frameSize: FRAME, sampleCount: 0, inputSampleRate: RATE, preSkip: 312 }),
  );
  assert.throws(() =>
    muxOggOpus({
      packets: [Buffer.alloc(10)],
      frameSize: 441,
      sampleCount: 441,
      inputSampleRate: 44_100,
      preSkip: 312,
    }),
  );
});

test('packets of 255+ bytes are laced across segments correctly', () => {
  // 600 bytes -> lacing 255, 255, 90; 510 bytes -> 255, 255, 0.
  const packets = [Buffer.alloc(600, 1), Buffer.alloc(510, 2), Buffer.alloc(20, 3)];
  const file = muxOggOpus({
    packets,
    frameSize: FRAME,
    sampleCount: FRAME * 3,
    inputSampleRate: RATE,
    preSkip: 312,
  });
  const audio = parseOgg(file).slice(2);
  const roundTripped = audio.flatMap((page) => page.packets);
  assert.deepEqual(
    roundTripped.map((packet) => packet.length),
    [600, 510, 20],
  );
  assert.ok(roundTripped[1]!.every((byte) => byte === 2));
});

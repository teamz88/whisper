import { clipboard, nativeImage } from 'electron';
import type { NativeImage } from 'electron';

/**
 * Clipboard snapshot + restore around a paste.
 *
 * Two rules that are easy to get wrong:
 *  - Restore with ONE clipboard.write({...}) call. Sequential writeText/
 *    writeHTML/writeImage each clear the clipboard first, so calling them in
 *    turn destroys every flavour but the last.
 *  - Restore on a delay, never immediately. The target application reads the
 *    clipboard asynchronously after receiving Ctrl+V; restoring straight away
 *    races the paste and the user gets their old clipboard content pasted.
 */

export interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image: NativeImage | null;
  /** Formats present at snapshot time, for diagnostics. */
  formats: string[];
  /** True when the clipboard held something we cannot faithfully restore. */
  lossy: boolean;
}

/** Windows file-copy formats. We can read them but not round-trip them. */
const UNRESTORABLE_FORMAT_PATTERN = /FileName|FileContents|CF_HDROP|files/i;

export function snapshotClipboard(): ClipboardSnapshot {
  const formats = clipboard.availableFormats();
  const image = clipboard.readImage();

  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    // readImage() always returns a NativeImage, even when there is no image on
    // the clipboard, so emptiness is the only reliable test.
    image: image.isEmpty() ? null : image,
    formats,
    lossy: formats.some((format) => UNRESTORABLE_FORMAT_PATTERN.test(format)),
  };
}

export function restoreClipboard(snapshot: ClipboardSnapshot): void {
  const data: Electron.Data = {};

  if (snapshot.text !== '') data.text = snapshot.text;
  if (snapshot.html !== '') data.html = snapshot.html;
  if (snapshot.rtf !== '') data.rtf = snapshot.rtf;
  if (snapshot.image !== null) data.image = snapshot.image;

  if (Object.keys(data).length === 0) {
    clipboard.clear();
    return;
  }

  clipboard.write(data);
}

export function isSnapshotEmpty(snapshot: ClipboardSnapshot): boolean {
  return (
    snapshot.text === '' && snapshot.html === '' && snapshot.rtf === '' && snapshot.image === null
  );
}

export function writeText(text: string): void {
  clipboard.writeText(text);
}

export function readText(): string {
  return clipboard.readText();
}

export { nativeImage };

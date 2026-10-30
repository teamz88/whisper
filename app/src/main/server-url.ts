/**
 * The server address a person types on the sign-in screen when they run their
 * own Whisper server. Kept free of Electron imports so it can be unit-tested.
 *
 * People paste all sorts of things ("whisper.example.com", "https://x.com/",
 * "https://x.com/health"), so the input is forgiven where that is safe and
 * rejected where it is not: a password must never travel over plain http to a
 * server on the public internet.
 */

export type ServerUrlResult = { ok: true; url: string } | { ok: false; error: string };

/** Hosts where plain http is acceptable: this computer or the local network. */
function isLocalHost(host: string): boolean {
  const name = host.toLowerCase();
  if (name === 'localhost' || name.endsWith('.local') || name === '[::1]') return true;

  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  if (octets === null) return false;
  const [a, b] = [Number(octets[1]), Number(octets[2])];
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31)
  );
}

export function normalizeServerUrl(input: string): ServerUrlResult {
  const typed = input.trim();
  if (typed === '') return { ok: false, error: 'Enter your server address.' };

  // "whisper.example.com" -> https. A bare local address ("192.168.1.5:8080")
  // is the one case where plain http is what the person means.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed);
  let candidate = typed;
  if (!hasScheme) {
    const host = typed.split(/[/?#]/)[0]!.replace(/:\d+$/, '');
    candidate = `${isLocalHost(host) ? 'http' : 'https'}://${typed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'That does not look like a web address.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'The address must start with https://' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, error: 'Remove the username and password from the address.' };
  }
  if (parsed.protocol === 'http:' && !isLocalHost(parsed.hostname)) {
    return {
      ok: false,
      error: 'Use https:// — a password must not be sent over plain http.',
    };
  }

  // Origin only: a pasted ".../health" or trailing slash must not break requests.
  return { ok: true, url: parsed.origin };
}

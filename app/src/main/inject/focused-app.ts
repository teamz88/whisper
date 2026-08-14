import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Best-effort name of the app that had focus. Only ever called on the paste
 * fallback path, so the cost of shelling out is paid once per failure and never
 * during a normal dictation — and it saves a native dependency we would
 * otherwise carry for one log line.
 */

const TIMEOUT_MS = 1500;

const WINDOWS_SNIPPET = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
}
"@
$pid2 = 0
[void][W]::GetWindowThreadProcessId([W]::GetForegroundWindow(), [ref]$pid2)
(Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName
`;

export async function getFocusedAppName(): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SNIPPET],
        { timeout: TIMEOUT_MS, windowsHide: true },
      );
      const name = stdout.trim();
      return name === '' ? null : name;
    }

    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
        { timeout: TIMEOUT_MS },
      );
      const name = stdout.trim();
      return name === '' ? null : name;
    }
  } catch {
    // Diagnostics must never break a dictation.
  }

  return null;
}

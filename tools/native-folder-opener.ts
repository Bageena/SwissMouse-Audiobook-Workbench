import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Explorer can reuse an existing process, so its spawn event does not identify
// the folder window. Resolve the window by its Shell path, then raise it.
const OPEN_FOLDER_SCRIPT = `
$ErrorActionPreference = 'Stop'
$folder = [System.IO.Path]::GetFullPath($env:SWISSMOUSE_OPEN_FOLDER_PATH)
if (-not [System.IO.Directory]::Exists($folder)) { throw 'Folder does not exist.' }
$shell = New-Object -ComObject Shell.Application
function Find-FolderWindow {
  foreach ($window in @($shell.Windows())) {
    try {
      if (-not $window.FullName.EndsWith('explorer.exe', [System.StringComparison]::OrdinalIgnoreCase)) { continue }
      $candidate = [System.IO.Path]::GetFullPath([string]$window.Document.Folder.Self.Path).TrimEnd([char[]]@(92, 47))
      if ([string]::Equals($candidate, $folder.TrimEnd([char[]]@(92, 47)), [System.StringComparison]::OrdinalIgnoreCase)) { return [IntPtr]$window.HWND }
    } catch { }
  }
  return [IntPtr]::Zero
}
$handle = Find-FolderWindow
if ($handle -eq [IntPtr]::Zero) {
  $shell.Explore($folder)
  $deadline = [DateTime]::UtcNow.AddSeconds(7)
  do {
    Start-Sleep -Milliseconds 100
    $handle = Find-FolderWindow
  } while ($handle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)
}
if ($handle -eq [IntPtr]::Zero) { throw 'Explorer opened, but its folder window could not be located.' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SwissMouseWindowFocus {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr handle, IntPtr after, int x, int y, int width, int height, uint flags);
}
'@
$flags = [uint32](0x0001 -bor 0x0002 -bor 0x0010 -bor 0x0040)
[void][SwissMouseWindowFocus]::ShowWindowAsync($handle, 9)
[void][SwissMouseWindowFocus]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, $flags)
[void][SwissMouseWindowFocus]::SetForegroundWindow($handle)
[void][SwissMouseWindowFocus]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, $flags)
[void][SwissMouseWindowFocus]::SetWindowPos($handle, [IntPtr]::Zero, 0, 0, 0, 0, $flags)
`;

export async function openFolderInForeground(
  directory: string,
  run: typeof execFileAsync = execFileAsync,
): Promise<void> {
  const encoded = Buffer.from(OPEN_FOLDER_SCRIPT, 'utf16le').toString('base64');
  await run('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], {
    windowsHide: true,
    timeout: 12000,
    env: { ...process.env, SWISSMOUSE_OPEN_FOLDER_PATH: directory },
  });
}

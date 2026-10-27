import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ownerScript = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$owner = New-Object System.Windows.Forms.Form',
  '$owner.ShowInTaskbar = $false',
  '$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None',
  '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
  '$owner.Size = New-Object System.Drawing.Size(1, 1)',
  '$owner.Opacity = 0',
  '$owner.TopMost = $true',
];

async function runPicker(script: string[], run: typeof execFileAsync): Promise<string | null> {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', [...ownerScript, ...script].join('\n')], { windowsHide: true, timeout: 120000 });
  return stdout.trim() || null;
}

// Windows PowerShell's .NET Framework FolderBrowserDialog shows the old tree
// view. IFileDialog with FOS_PICKFOLDERS uses the Explorer-style Open dialog.
const explorerFolderDialog = String.raw`Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
internal class FileOpenDialogCom { }

[ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IFileDialogCom {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr filters);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IntPtr folder);
    void SetFolder(IntPtr folder);
    void GetFolder(out IntPtr folder);
    void GetCurrentSelection(out IntPtr item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName(out IntPtr name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItemCom item);
}

[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IShellItemCom {
    void BindToHandler(IntPtr bindContext, ref Guid handler, ref Guid interfaceId, out IntPtr result);
    void GetParent(out IShellItemCom parent);
    void GetDisplayName(uint kind, out IntPtr name);
}

public static class SwissMouseFolderDialog {
    public static string Pick(IntPtr owner) {
        IFileDialogCom dialog = (IFileDialogCom)new FileOpenDialogCom();
        IShellItemCom item = null;
        try {
            uint options;
            dialog.GetOptions(out options);
            dialog.SetOptions(options | 0x20u | 0x40u | 0x800u); // Pick folders, require filesystem and existing path.
            dialog.SetTitle("Select an audiobook folder");
            dialog.SetOkButtonLabel("Select Folder");
            int result = dialog.Show(owner);
            if (result == unchecked((int)0x800704C7)) return null; // User cancelled.
            if (result < 0) Marshal.ThrowExceptionForHR(result);
            dialog.GetResult(out item);
            IntPtr name = IntPtr.Zero;
            try {
                item.GetDisplayName(0x80058000u, out name); // SIGDN_FILESYSPATH
                return Marshal.PtrToStringUni(name);
            } finally {
                if (name != IntPtr.Zero) Marshal.FreeCoTaskMem(name);
            }
        } finally {
            if (item != null) Marshal.ReleaseComObject(item);
            Marshal.ReleaseComObject(dialog);
        }
    }
}
'@`;

// The API returns a real local path. The browser never supplies a fake file-input path.
export async function pickAudioFile(
  extensions: Iterable<string>,
  platform = process.platform,
  run: typeof execFileAsync = execFileAsync,
): Promise<string | null> {
  if (platform !== 'win32') throw new Error('Native audio browsing currently requires Windows. Enter a local folder path on this system.');
  const patterns = [...extensions].map(extension => `*.${extension}`).join(';');
  return runPicker([
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    "$dialog.Title = 'Select an audiobook'",
    `$dialog.Filter = 'Audiobooks (${patterns})|${patterns}|All files (*.*)|*.*'`,
    '$dialog.CheckFileExists = $true',
    '$dialog.Multiselect = $false',
    'try { $owner.Show(); $owner.Activate(); if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) } } finally { $dialog.Dispose(); $owner.Close(); $owner.Dispose() }',
  ], run);
}

export async function pickAudioFiles(
  extensions: Iterable<string>,
  platform = process.platform,
  run: typeof execFileAsync = execFileAsync,
): Promise<string[] | null> {
  if (platform !== 'win32') throw new Error('Native audio browsing currently requires Windows. Enter a local file or folder path on this system.');
  const patterns = [...extensions].map(extension => `*.${extension}`).join(';');
  const result = await runPicker([
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    "$dialog.Title = 'Select audio files'",
    `$dialog.Filter = 'Audio files (${patterns})|${patterns}'`,
    '$dialog.CheckFileExists = $true',
    '$dialog.Multiselect = $true',
    'try { $owner.Show(); $owner.Activate(); if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write((ConvertTo-Json -InputObject $dialog.FileNames -Compress)) } } finally { $dialog.Dispose(); $owner.Close(); $owner.Dispose() }',
  ], run);
  if (!result) return null;
  const files = JSON.parse(result);
  return Array.isArray(files) ? files : [files];
}

export async function pickAudioFolder(
  platform = process.platform,
  run: typeof execFileAsync = execFileAsync,
): Promise<string | null> {
  if (platform !== 'win32') throw new Error('Native audio browsing currently requires Windows. Enter a local folder path on this system.');
  return runPicker([
    explorerFolderDialog,
    'try { $owner.Show(); $owner.Activate(); $selected = [SwissMouseFolderDialog]::Pick($owner.Handle); if ($selected) { [Console]::Out.Write($selected) } } finally { $owner.Close(); $owner.Dispose() }',
  ], run);
}

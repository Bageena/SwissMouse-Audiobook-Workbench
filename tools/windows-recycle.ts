// IFileOperation forces recycling on Windows 8+, stops on errors, and retains
// the Shell warning if a device cannot recycle. There is no permanent fallback.
// https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-setoperationflags
export const WINDOWS_RECYCLE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$p = [Environment]::GetEnvironmentVariable('SWISSMOUSE_RECYCLE_PATH')
$drive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($p))
if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'Recycle Bin operations require a local fixed drive. Files were kept.' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SwissMouseRecycle {
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    [PreserveSig] int BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
    [PreserveSig] int GetParent(out IShellItem parent);
    [PreserveSig] int GetDisplayName(uint display, out IntPtr name);
    [PreserveSig] int GetAttributes(uint mask, out uint attributes);
    [PreserveSig] int Compare(IShellItem item, uint hints, out int order);
  }
  [ComImport, Guid("947AAB5F-0A5C-4C13-B4D6-4BF7836FC9F8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileOperation {
    [PreserveSig] int Advise(IntPtr sink, out uint cookie);
    [PreserveSig] int Unadvise(uint cookie);
    [PreserveSig] int SetOperationFlags(uint flags);
    [PreserveSig] int SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)] string message);
    [PreserveSig] int SetProgressDialog(IntPtr dialog);
    [PreserveSig] int SetProperties(IntPtr properties);
    [PreserveSig] int SetOwnerWindow(IntPtr owner);
    [PreserveSig] int ApplyPropertiesToItem([MarshalAs(UnmanagedType.Interface)] object item);
    [PreserveSig] int ApplyPropertiesToItems([MarshalAs(UnmanagedType.Interface)] object items);
    [PreserveSig] int RenameItem([MarshalAs(UnmanagedType.Interface)] object item, [MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr sink);
    [PreserveSig] int RenameItems([MarshalAs(UnmanagedType.Interface)] object items, [MarshalAs(UnmanagedType.LPWStr)] string name);
    [PreserveSig] int MoveItem([MarshalAs(UnmanagedType.Interface)] object item, [MarshalAs(UnmanagedType.Interface)] object destination, [MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr sink);
    [PreserveSig] int MoveItems([MarshalAs(UnmanagedType.Interface)] object items, [MarshalAs(UnmanagedType.Interface)] object destination);
    [PreserveSig] int CopyItem([MarshalAs(UnmanagedType.Interface)] object item, [MarshalAs(UnmanagedType.Interface)] object destination, [MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr sink);
    [PreserveSig] int CopyItems([MarshalAs(UnmanagedType.Interface)] object items, [MarshalAs(UnmanagedType.Interface)] object destination);
    [PreserveSig] int DeleteItem(IShellItem item, IntPtr sink);
    [PreserveSig] int DeleteItems([MarshalAs(UnmanagedType.Interface)] object items);
    [PreserveSig] int NewItem([MarshalAs(UnmanagedType.Interface)] object destination, uint attributes, [MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.LPWStr)] string template, IntPtr sink);
    [PreserveSig] int PerformOperations();
    [PreserveSig] int GetAnyOperationsAborted([MarshalAs(UnmanagedType.Bool)] out bool aborted);
  }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=true)]
  static extern int SHCreateItemFromParsingName(string path, IntPtr binding, ref Guid iid, out IShellItem item);
  public static void Recycle(string path) {
    IShellItem item = null; IFileOperation operation = null;
    try {
      Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
      Marshal.ThrowExceptionForHR(SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out item));
      operation = (IFileOperation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("3AD05575-8857-4850-9277-11B85BDB8E09")));
      // SILENT, NOCONFIRMATION, NOERRORUI, WANTNUKEWARNING,
      // RECYCLEONDELETE, EARLYFAILURE, ADDUNDORECORD.
      Marshal.ThrowExceptionForHR(operation.SetOperationFlags(0x0004 | 0x0010 | 0x0400 | 0x4000 | 0x00080000 | 0x00100000 | 0x20000000));
      Marshal.ThrowExceptionForHR(operation.DeleteItem(item, IntPtr.Zero));
      Marshal.ThrowExceptionForHR(operation.PerformOperations());
      bool aborted; Marshal.ThrowExceptionForHR(operation.GetAnyOperationsAborted(out aborted));
      if (aborted) throw new InvalidOperationException("Recycling was cancelled or unavailable. No permanent deletion was requested.");
    } finally {
      if (item != null) Marshal.FinalReleaseComObject(item);
      if (operation != null) Marshal.FinalReleaseComObject(operation);
    }
  }
}
'@
[SwissMouseRecycle]::Recycle($p)
`;

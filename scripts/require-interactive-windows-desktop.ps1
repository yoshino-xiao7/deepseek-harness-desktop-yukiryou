[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sessionId = (Get-Process -Id $PID).SessionId
if ($sessionId -eq 0) {
  throw 'Runner is executing in non-interactive Session 0'
}

$explorer = @(
  Get-Process explorer -ErrorAction SilentlyContinue |
    Where-Object SessionId -eq $sessionId
)
if ($explorer.Count -eq 0) {
  throw "No logged-in Windows desktop was found in Session $sessionId"
}

# LogonUI and LockApp can remain alive in a usable Remote Desktop session, so
# process presence is not a reliable lock signal. Ask Windows whether the
# current input desktop can actually be switched to instead.
if (-not ('DesktopInputProbe' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class DesktopInputProbe
{
    private const uint DESKTOP_SWITCHDESKTOP = 0x0100;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(
        uint flags,
        bool inherit,
        uint desiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SwitchDesktop(IntPtr desktop);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseDesktop(IntPtr desktop);

    public static bool IsInteractive()
    {
        IntPtr desktop = OpenInputDesktop(0, false, DESKTOP_SWITCHDESKTOP);
        if (desktop == IntPtr.Zero)
        {
            return false;
        }

        try
        {
            return SwitchDesktop(desktop);
        }
        finally
        {
            CloseDesktop(desktop);
        }
    }
}
'@
}

if (-not [DesktopInputProbe]::IsInteractive()) {
  throw "Windows desktop Session $sessionId is not available for interactive UI automation"
}

"Using interactive Windows desktop Session $sessionId"

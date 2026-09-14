Add-Type -AssemblyName System.Drawing

$code = @'
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Threading;

public class WC {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int L, T, R, B; }

    public static void Click(int x, int y) {
        SetCursorPos(x, y); Thread.Sleep(100);
        mouse_event(0x0002, 0, 0, 0, IntPtr.Zero); Thread.Sleep(50);
        mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    }

    public static void Shot(string path, int x, int y, int w, int h) {
        var bmp = new Bitmap(w, h);
        using (var g = Graphics.FromImage(bmp)) { g.CopyFromScreen(x, y, 0, 0, new Size(w, h)); }
        bmp.Save(path, ImageFormat.Png); bmp.Dispose();
    }

    public static long[] GetWin() {
        foreach (Process p in Process.GetProcesses()) {
            if (p.MainWindowHandle != IntPtr.Zero && p.ProcessName.Contains("mp")) {
                RECT r; DwmGetWindowAttribute(p.MainWindowHandle, 9, out r, Marshal.SizeOf(typeof(RECT)));
                return new long[] { p.MainWindowHandle.ToInt64(), r.L, r.T, r.R, r.B };
            }
        }
        return new long[] { 0, 0, 0, 0, 0 };
    }
}
'@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing

$wi = [WC]::GetWin()
if ($wi[0] -eq 0) { Write-Host "Not found"; exit 1 }

$h = [IntPtr]::new($wi[0])
$L = [int]$wi[1]; $T = [int]$wi[2]; $R = [int]$wi[3]; $B = [int]$wi[4]
$w = $R - $L; $hgt = $B - $T
Write-Host "Window: L=$L T=$T R=$R B=$T size=${w}x${hgt}"

[WC]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 500

$OUT = "D:\Data\projects\Multi-Publish\screenshots\mp"
if (!(Test-Path $OUT)) { New-Item -ItemType Directory -Path $OUT -Force | Out-Null }

function Click-At($rx, $ry) {
    [WC]::Click($L + $rx, $T + $ry)
    Start-Sleep -Milliseconds 800
}

function Snap($name) {
    Start-Sleep -Milliseconds 1200
    $p = Join-Path $OUT "$name.png"
    [WC]::Shot($p, $L, $T, $w, $hgt)
    Write-Host "OK: $name"
}

Write-Host "`n=== Phase 1: Main menus ==="

$moves = @(
    @("01-home", 60, 85),
    @("02-publish", 60, 130),
    @("03-account", 60, 175),
    @("04-data", 60, 220),
    @("05-cli", 60, 265),
    @("06-comment", 60, 310),
    @("07-create", 60, 380),
    @("08-xiaoyi", 60, 425),
    @("09-team", 60, 470),
    @("10-material", 60, 515)
)

foreach ($m in $moves) {
    Write-Host "Clicking: $($m[0])"
    Click-At $m[1] $m[2]
    Snap $m[0]
}

Write-Host "`n=== Done ==="

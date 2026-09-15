Add-Type -AssemblyName System.Drawing

$OUT = "D:\Data\projects\Multi-Publish\screenshots\mp"
if (!(Test-Path $OUT)) { New-Item -ItemType Directory -Path $OUT -Force | Out-Null }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading;

public class MouseHelper {
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public static void Click(int x, int y) {
        SetCursorPos(x, y);
        Thread.Sleep(100);
        mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(50);
        mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    }
}
'@

$proc = Get-Process | Where-Object { $_.Path -match 'mp' -and $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
if (!$proc) { Write-Host "Not found"; exit 1 }

$hwnd = $proc.MainWindowHandle
[MouseHelper]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500

$rect = New-Object MouseHelper+RECT
[MouseHelper]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$left = $rect.Left
$top = $rect.Top
$winW = $rect.Right - $rect.Left
$winH = $rect.Bottom - $rect.Top
Write-Host "Window: L=$left T=$top W=$winW H=$winH"

function ClickAt($rx, $ry) {
    [MouseHelper]::Click($left + $rx, $top + $ry)
    Start-Sleep -Milliseconds 800
}

function Snap($name) {
    Start-Sleep -Milliseconds 1500
    $bmp = New-Object System.Drawing.Bitmap($winW, $winH)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($left, $top, 0, 0, (New-Object System.Drawing.Size($winW, $winH)))
    $g.Dispose()
    $bmp.Save("$OUT\$name.png")
    $bmp.Dispose()
    Write-Host "OK: $name"
}

Write-Host "`n=== Phase 1: Main menus ==="

$menus = @(
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

foreach ($m in $menus) {
    Write-Host "Click: $($m[0])"
    ClickAt $m[1] $m[2]
    Snap $m[0]
}

Write-Host "`n=== Phase 2: Account page sub-tabs ==="

ClickAt 175 175
Snap "03a-account-all"

ClickAt 230 175
Snap "03b-account-logged"

ClickAt 285 175
Snap "03c-account-unlogged"

ClickAt 940 65
Snap "03d-add-account-dialog"

Write-Host "`n=== Phase 3: Publish page details ==="

ClickAt 60 130
Start-Sleep -Milliseconds 1000

ClickAt 665 195
Snap "04a-publish-clicked"

Write-Host "`n=== Done ==="
Write-Host "All screenshots: $OUT"

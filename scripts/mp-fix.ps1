Add-Type -AssemblyName System.Drawing

$OUT = "D:\Data\projects\Multi-Publish\screenshots\mp"
if (!(Test-Path $OUT)) { New-Item -ItemType Directory -Path $OUT -Force | Out-Null }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading;

public class MH {
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
[MH]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500

$rect = New-Object MH+RECT
[MH]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$left = $rect.Left
$top = $rect.Top
$winW = $rect.Right - $rect.Left
$winH = $rect.Bottom - $rect.Top
Write-Host "Window: L=$left T=$top W=$winW H=$winH"

function ClickAt($rx, $ry) {
    [MH]::Click($left + $rx, $top + $ry)
    Start-Sleep -Milliseconds 1000
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

Write-Host "`n=== Fix: Navigate to HOME first ==="
ClickAt 60 200
Snap "fix-home"

Write-Host "`n=== Fix: DATA page ==="
ClickAt 60 330
Snap "fix-data"

Write-Host "`n=== Fix: CLI page ==="
ClickAt 60 375
Snap "fix-cli"

Write-Host "`n=== Fix: CREATE page ==="
ClickAt 60 510
Snap "fix-create"

Write-Host "`n=== Fix: XIAOYI page ==="
ClickAt 60 555
Snap "fix-xiaoyi"

Write-Host "`n=== Fix: TEAM page ==="
ClickAt 60 595
Snap "fix-team"

Write-Host "`n=== Fix: MATERIAL page ==="
ClickAt 60 640
Snap "fix-material"

Write-Host "`n=== Phase 2: Account sub-tabs ==="
ClickAt 60 290
Snap "acct-tab-manager"

ClickAt 475 165
Snap "acct-tab-group"

ClickAt 585 165
Snap "acct-tab-share"

ClickAt 690 165
Snap "acct-tab-favorite"

Write-Host "`n=== Phase 3: Publish sub-tabs ==="
ClickAt 60 245
Snap "pub-tab-record"

ClickAt 430 165
Snap "pub-tab-draft"

Write-Host "`n=== Phase 4: Data sub-tabs ==="
ClickAt 60 330
Snap "data-dashboard"

ClickAt 470 165
Snap "data-account"

ClickAt 590 165
Snap "data-works"

ClickAt 710 165
Snap "data-ranking"

ClickAt 820 165
Snap "data-manager"

Write-Host "`n=== Phase 5: Comment sub-tabs ==="
ClickAt 60 425
Snap "comment-msg"

ClickAt 460 165
Snap "comment-auto-reply"

Write-Host "`n=== Phase 6: Publish new (click + button) ==="
ClickAt 60 245
Start-Sleep -Milliseconds 1000
Snap "pub-list"

Write-Host "`n=== Done ==="

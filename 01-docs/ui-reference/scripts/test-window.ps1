Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinHelper {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern void SetCursorPos(int X, int Y);
    
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }
    
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
"@

function Get-MpWindow {
    $proc = Get-Process | Where-Object { $_.MainWindowTitle -match "参考产品" -and $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
    if (-not $proc) { return $null }
    
    $hwnd = $proc.MainWindowHandle
    [WinHelper]::ShowWindow($hwnd, 9) | Out-Null
    Start-Sleep -Milliseconds 500
    [WinHelper]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 300
    
    $rect = New-Object WinHelper+RECT
    [WinHelper]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    
    return @{
        Handle = $hwnd
        Left = $rect.Left
        Top = $rect.Top
        Width = $rect.Right - $rect.Left
        Height = $rect.Bottom - $rect.Top
    }
}

function Click-At($x, $y) {
    [WinHelper]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 100
    [WinHelper]::mouse_event([WinHelper]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 50
    [WinHelper]::mouse_event([WinHelper]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 300
}

function Click-Relative($win, $pctX, $pctY) {
    $x = $win.Left + [int]($win.Width * $pctX)
    $y = $win.Top + [int]($win.Height * $pctY)
    Write-Output "Click at ($x, $y) [pct: $pctX, $pctY]"
    Click-At $x $y
}

function Take-Screenshot($win, $name) {
    $outDir = "D:\Data\projects\Multi-Publish\01-docs\ui-reference\screenshots\current"
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    $outPath = Join-Path $outDir "$name.png"
    
    $bmp = New-Object System.Drawing.Bitmap($win.Width, $win.Height)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($win.Left, $win.Top, 0, 0, (New-Object System.Drawing.Size($win.Width, $win.Height)))
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $gfx.Dispose()
    $bmp.Dispose()
    Write-Output "Screenshot saved: $name.png ($($win.Width)x$($win.Height))"
}

# === 主逻辑 ===
$w = Get-MpWindow
if (-not $w -or $w.Width -lt 100) {
    Write-Output "ERROR: Cannot find参考产品 window"
    exit 1
}
Write-Output "Window found: L=$($w.Left) T=$($w.Top) W=$($w.Width) H=$($w.Height)"

# 截取当前状态
Take-Screenshot $w "00-current-state"

Write-Output "DONE"

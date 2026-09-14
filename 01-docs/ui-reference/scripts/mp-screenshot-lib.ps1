# 参考产品截图辅助函数库
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# Win32 API
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MpHelper {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    public struct RECT { public int Left, Top, Right, Bottom; }
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const byte VK_RETURN = 0x0D;
    public const byte VK_TAB = 0x09;
    public const byte VK_ESCAPE = 0x1B;
    public const byte VK_BACK = 0x08;
    public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@

$script:SCREENSHOT_DIR = "D:\Data\projects\Multi-Publish\01-docs\ui-reference\screenshots"

function Get-MpWindow {
    $proc = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match "参考产品" } | Select-Object -First 1
    if (-not $proc) { return $null }
    
    $hwnd = $proc.MainWindowHandle
    [MpHelper]::ShowWindow($hwnd, 9) | Out-Null
    
    $currThread = [MpHelper]::GetCurrentThreadId()
    $fgWindow = [MpHelper]::GetForegroundWindow()
    $fgPid = [uint32]0
    [MpHelper]::GetWindowThreadProcessId($fgWindow, [ref]$fgPid) | Out-Null
    [MpHelper]::AttachThreadInput($currThread, $fgPid, $true) | Out-Null
    [MpHelper]::SetForegroundWindow($hwnd) | Out-Null
    [MpHelper]::AttachThreadInput($currThread, $fgPid, $false) | Out-Null
    Start-Sleep -Milliseconds 300
    
    $rect = New-Object MpHelper+RECT
    [MpHelper]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    
    return @{
        Handle = $hwnd
        Left = $rect.Left
        Top = $rect.Top
        Width = $rect.Right - $rect.Left
        Height = $rect.Bottom - $rect.Top
    }
}

function Click-At($x, $y) {
    [MpHelper]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 100
    [MpHelper]::mouse_event([MpHelper]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
    [MpHelper]::mouse_event([MpHelper]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 300
}

function Click-Relative($winInfo, $xPercent, $yPercent) {
    $absX = $winInfo.Left + [int]($winInfo.Width * $xPercent)
    $absY = $winInfo.Top + [int]($winInfo.Height * $yPercent)
    Click-At $absX $absY
}

function Type-Text($text) {
    foreach ($char in $text.ToCharArray()) {
        [System.Windows.Forms.SendKeys]::SendWait($char.ToString())
        Start-Sleep -Milliseconds 50
    }
}

function Press-Key($key) {
    [System.Windows.Forms.SendKeys]::SendWait($key)
}

function Take-Screenshot($winInfo, $relativePath) {
    $fullPath = Join-Path $script:SCREENSHOT_DIR $relativePath
    $dir = Split-Path $fullPath -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    
    $bmp = New-Object System.Drawing.Bitmap($winInfo.Width, $winInfo.Height)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($winInfo.Left, $winInfo.Top, 0, 0, (New-Object System.Drawing.Size($winInfo.Width, $winInfo.Height)))
    $bmp.Save($fullPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $gfx.Dispose(); $bmp.Dispose()
    echo "📸 Saved: $relativePath"
}

Write-Host "✅ 参考产品截图辅助函数已加载" -ForegroundColor Green

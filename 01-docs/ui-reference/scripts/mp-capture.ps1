Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MpHelper3 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern void SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    public struct RECT { public int Left, Top, Right, Bottom; }
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const byte VK_RETURN = 0x0D;
}
"@

function GetAndFocus {
    $proc = Get-Process | Where-Object { $_.MainWindowTitle -match "参考产品" } | Select-Object -First 1
    if (-not $proc) { return $null }
    
    $hwnd = $proc.MainWindowHandle
    # 先还原窗口
    [MpHelper3]::ShowWindow($hwnd, 9) | Out-Null
    Start-Sleep -Milliseconds 500
    
    # 强制置前
    $currThread = [MpHelper3]::GetCurrentThreadId()
    $fgWindow = [MpHelper3]::GetForegroundWindow()
    $fgPid = [uint32]0
    [MpHelper3]::GetWindowThreadProcessId($fgWindow, [ref]$fgPid) | Out-Null
    [MpHelper3]::AttachThreadInput($currThread, $fgPid, $true) | Out-Null
    [MpHelper3]::SetForegroundWindow($hwnd) | Out-Null
    [MpHelper3]::AttachThreadInput($currThread, $fgPid, $false) | Out-Null
    Start-Sleep -Milliseconds 500
    
    $rect = New-Object MpHelper3+RECT
    [MpHelper3]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    
    return @{
        Handle = $hwnd
        Left = $rect.Left
        Top = $rect.Top
        Width = $rect.Right - $rect.Left
        Height = $rect.Bottom - $rect.Top
    }
}

function Capture($win, $name) {
    $outDir = "D:\Data\projects\Multi-Publish\01-docs\ui-reference\screenshots\current"
    $outPath = Join-Path $outDir "$name.png"
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    
    $bmp = New-Object System.Drawing.Bitmap($win.Width, $win.Height)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($win.Left, $win.Top, 0, 0, (New-Object System.Drawing.Size($win.Width, $win.Height)))
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $gfx.Dispose()
    $bmp.Dispose()
    Write-Output "OK|$outPath|$($win.Width)x$($win.Height)"
}

# 获取窗口
$w = GetAndFocus
if (-not $w -or -not $w.Width -or $w.Width -lt 100) {
    Write-Output "FAIL|Cannot get window"
    exit 1
}

Write-Output "WIN|L=$($w.Left) T=$($w.Top) W=$($w.Width) H=$($w.Height)"

# 截取初始状态
$result = Capture $w "01-initial"
Write-Output $result

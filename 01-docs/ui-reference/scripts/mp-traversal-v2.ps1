# 参考产品全面截图 - 简化版
$script:MP_PID = 19492
$script:OUTPUT_DIR = "D:\Data\projects\Multi-Publish\01-docs\ui-reference\screenshots\full-traversal"
$script:COUNTER = 0

New-Item -ItemType Directory -Path $script:OUTPUT_DIR -Force | Out-Null

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;

public class MpWin {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    
    public static void Focus(IntPtr hWnd) {
        ShowWindow(hWnd, 9);
        System.Threading.Thread.Sleep(500);
        SetForegroundWindow(hWnd);
        System.Threading.Thread.Sleep(300);
    }
    
    public static Bitmap Capture(IntPtr hWnd) {
        Focus(hWnd);
        RECT r;
        GetWindowRect(hWnd, out r);
        int w = r.Right - r.Left;
        int h = r.Bottom - r.Top;
        if (w <= 0 || h <= 0) return null;
        var bmp = new Bitmap(w, h);
        using (Graphics g = Graphics.FromImage(bmp)) {
            IntPtr hdc = g.GetHdc();
            PrintWindow(hWnd, hdc, 2);
            g.ReleaseHdc(hdc);
        }
        // Check if black
        int black = 0; int total = 0;
        for (int y = 0; y < h; y += 10) for (int x = 0; x < w; x += 10) {
            total++;
            Color c = bmp.GetPixel(x, y);
            if (c.R < 10 && c.G < 10 && c.B < 10) black++;
        }
        if (total > 0 && black * 100 / total > 80) {
            bmp.Dispose();
            bmp = new Bitmap(w, h);
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.CopyFromScreen(r.Left, r.Top, 0, 0, new Size(w, h));
            }
        }
        return bmp;
    }
    
    public static void ClickAt(IntPtr hWnd, double rx, double ry) {
        Focus(hWnd);
        RECT r;
        GetWindowRect(hWnd, out r);
        int x = r.Left + (int)((r.Right - r.Left) * rx);
        int y = r.Top + (int)((r.Bottom - r.Top) * ry);
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(100);
        mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
        System.Threading.Thread.Sleep(50);
        mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    }
}
"@ -ReferencedAssemblies System.Drawing

function GetHwnd {
    $p = Get-Process -Id $script:MP_PID -EA SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { return $p.MainWindowHandle }
    return [IntPtr]::Zero
}

function Snap($name) {
    $h = GetHwnd
    if ($h -eq [IntPtr]::Zero) { Write-Host "[SKIP] no window" -Fore Red; return }
    $script:COUNTER++
    $f = Join-Path $script:OUTPUT_DIR ("{0:D3}-{1}.png" -f $script:COUNTER, $name)
    $bmp = [MpWin]::Capture($h)
    if ($bmp) { $bmp.Save($f, [ImageFormat]::Png); $bmp.Dispose(); Write-Host "[OK] $f" -Fore Green }
    else { Write-Host "[FAIL] capture" -Fore Red }
    Start-Sleep -Milliseconds 500
}

function ClickAt($rx, $ry) {
    $h = GetHwnd
    if ($h -ne [IntPtr]::Zero) { [MpWin]::ClickAt($h, $rx, $ry); Write-Host "[CLICK] ($rx,$ry)" -Fore Cyan; Start-Sleep -Seconds 1 }
}

Write-Host "=== 参考产品全面截图 ===" -Fore Yellow

# Step 1: 当前页面
Snap "01-register-page"

# Step 2: 点击"去登录"
ClickAt 0.58 0.72
Start-Sleep -Seconds 2
Snap "02-login-page"

# Step 3: 登录页详情
Snap "03-login-detail"

Write-Host "=== 第一阶段完成 ===" -Fore Yellow

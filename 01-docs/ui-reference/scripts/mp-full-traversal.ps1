# 参考产品全面截图脚本 - 第一遍：登录流程 + 菜单遍历
$script:MP_PID = 19492
$script:OUTPUT_DIR = "D:\Data\projects\Multi-Publish\01-docs\ui-reference\screenshots\full-traversal"
$script:COUNTER = 0

# 确保输出目录存在
New-Item -ItemType Directory -Path $script:OUTPUT_DIR -Force | Out-Null

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;

public class MpCapture {
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    
    public static void BringToFront(IntPtr hWnd) {
        ShowWindow(hWnd, 9); // SW_RESTORE
        System.Threading.Thread.Sleep(500);
        SetForegroundWindow(hWnd);
        System.Threading.Thread.Sleep(300);
    }
    
    public static Bitmap CaptureWindow(IntPtr hWnd) {
        BringToFront(hWnd);
        RECT rect;
        GetWindowRect(hWnd, out rect);
        int w = rect.Right - rect.Left;
        int h = rect.Bottom - rect.Top;
        if (w <= 0 || h <= 0) return null;
        
        // Try PrintWindow first
        var bmp = new Bitmap(w, h);
        using (Graphics g = Graphics.FromImage(bmp)) {
            IntPtr hdc = g.GetHdc();
            bool ok = PrintWindow(hWnd, hdc, 2); // PW_RENDERFULLCONTENT
            g.ReleaseHdc(hdc);
        }
        
        // Check if mostly black (Electron GPU issue)
        int blackCount = 0;
        int total = Math.Min(w * h, 10000);
        for (int i = 0; i < total; i++) {
            int x = (i % (w/10)) * 10;
            int y = (i / (w/10)) * 10;
            if (x < w && y < h) {
                Color c = bmp.GetPixel(x, y);
                if (c.R < 10 && c.G < 10 && c.B < 10) blackCount++;
            }
        }
        
        if (blackCount > total * 0.8) {
            bmp.Dispose();
            // Fallback to desktop copy
            bmp = new Bitmap(w, h);
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(w, h));
            }
        }
        return bmp;
    }
    
    public static void ClickRelative(IntPtr hWnd, double relX, double relY) {
        BringToFront(hWnd);
        RECT rect;
        GetWindowRect(hWnd, out rect);
        int w = rect.Right - rect.Left;
        int h = rect.Bottom - rect.Top;
        int x = rect.Left + (int)(w * relX);
        int y = rect.Top + (int)(h * relY);
        
        // Use SendInput for clicking
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(100);
        mouse_event(0x0002, 0, 0, 0, IntPtr.Zero); // LEFTDOWN
        System.Threading.Thread.Sleep(50);
        mouse_event(0x0004, 0, 0, 0, IntPtr.Zero); // LEFTUP
    }
    
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    
    public static void TypeText(string text) {
        System.Windows.Forms.SendKeys.SendWait(text);
    }
}
"@ -ReferencedAssemblies System.Drawing, System.Windows.Forms

function Get-MpMainWindow {
    $proc = Get-Process -Id $script:MP_PID -ErrorAction SilentlyContinue
    if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
        return $proc.MainWindowHandle
    }
    return [IntPtr]::Zero
}

function Take-Screenshot($name) {
    $hwnd = Get-MpMainWindow
    if ($hwnd -eq [IntPtr]::Zero) {
        Write-Host "ERROR: Cannot find window" -ForegroundColor Red
        return
    }
    $script:COUNTER++
    $num = "{0:D3}" -f $script:COUNTER
    $filepath = Join-Path $script:OUTPUT_DIR "${num}-${name}.png"
    
    $bmp = [MpCapture]::CaptureWindow($hwnd)
    if ($bmp) {
        $bmp.Save($filepath, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        Write-Host "[OK] $filepath" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] Cannot capture" -ForegroundColor Red
    }
    Start-Sleep -Milliseconds 500
}

function Click($relX, $relY) {
    $hwnd = Get-MpMainWindow
    if ($hwnd -ne [IntPtr]::Zero) {
        [MpCapture]::ClickRelative($hwnd, $relX, $relY)
        Write-Host "[CLICK] ($relX, $relY)" -ForegroundColor Cyan
        Start-Sleep -Seconds 1
    }
}

function Wait($seconds) {
    Start-Sleep -Seconds $seconds
}

Write-Host "=== 参考产品全面截图 - 开始 ===" -ForegroundColor Yellow
Write-Host "输出目录: $script:OUTPUT_DIR" -ForegroundColor Yellow

# ===== 1. 当前状态（注册页面）=====
Write-Host "`n--- 步骤1: 注册页面截图 ---" -ForegroundColor Magenta
Take-Screenshot "register-page"

# ===== 2. 点击"去登录"切换到登录页面 =====
Write-Host "`n--- 步骤2: 切换到登录页面 ---" -ForegroundColor Magenta
# "去登录" 链接大约在表单底部位置，x约58%，y约72%
Click 0.58 0.72
Wait 2
Take-Screenshot "login-page"

# ===== 3. 截图登录页面各个元素 =====
Write-Host "`n--- 步骤3: 登录页面元素 ---" -ForegroundColor Magenta
Take-Screenshot "login-full"

# 尝试点击"忘记密码"（如果有）
Write-Host "--- 尝试忘记密码 ---" -ForegroundColor DarkCyan
Click 0.65 0.65
Wait 2
Take-Screenshot "forgot-password"

# 回到登录页
Click 0.58 0.72  # 点"去注册"再回来
Wait 2
Click 0.58 0.60  # 点"去登录"
Wait 2
Take-Screenshot "login-page-back"

Write-Host "`n=== 第一阶段完成: 注册+登录页 ===" -ForegroundColor Yellow

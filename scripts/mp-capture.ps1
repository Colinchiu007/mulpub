Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Threading;

public class WinCapture {
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hWnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;

    public static void Click(int x, int y) {
        SetCursorPos(x, y);
        Thread.Sleep(100);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, IntPtr.Zero);
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, IntPtr.Zero);
    }

    public static void CaptureWindow(IntPtr hWnd, string path) {
        RECT rect;
        int hr = DwmGetWindowAttribute(hWnd, 9, out rect, Marshal.SizeOf(typeof(RECT)));
        if (hr != 0) GetWindowRect(hWnd, out rect);
        int w = rect.Right - rect.Left;
        int h = rect.Bottom - rect.Top;
        if (w <= 0 || h <= 0) { w = 1200; h = 800; }
        Bitmap bmp = new Bitmap(w, h);
        using (Graphics g = Graphics.FromImage(bmp)) {
            IntPtr hdc = g.GetHdc();
            SendMessage(hWnd, 0x0317, hdc, IntPtr.Zero);
            g.ReleaseHdc(hdc);
        }
        bmp.Save(path, ImageFormat.Png);
        bmp.Dispose();
    }

    public static void CaptureScreen(string path, int x, int y, int w, int h) {
        Bitmap bmp = new Bitmap(w, h);
        using (Graphics g = Graphics.FromImage(bmp)) {
            g.CopyFromScreen(x, y, 0, 0, new Size(w, h));
        }
        bmp.Save(path, ImageFormat.Png);
        bmp.Dispose();
    }

    public static IntPtr FindByTitle(string partial) {
        foreach (Process p in Process.GetProcesses()) {
            if (p.MainWindowTitle.Contains(partial) && p.MainWindowHandle != IntPtr.Zero)
                return p.MainWindowHandle;
        }
        return IntPtr.Zero;
    }

    public static RECT GetWindowPosition(IntPtr hWnd) {
        RECT rect;
        DwmGetWindowAttribute(hWnd, 9, out rect, Marshal.SizeOf(typeof(RECT)));
        return rect;
    }
}
"@ -ReferencedAssemblies System.Drawing

$OUT = "D:\Data\projects\Multi-Publish\screenshots\mp"
New-Item -ItemType Directory -Force -Path $OUT | Out-Null

$hwnd = [WinCapture]::FindByTitle("参考产品")
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "参考产品 not found!"; exit 1 }
[WinCapture]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500

$pos = [WinCapture]::GetWindowPosition($hwnd)
Write-Output "Window at: L=$($pos.Left) T=$($pos.Top) R=$($pos.Right) B=$($pos.Bottom)"
$winW = $pos.Right - $pos.Left
$winH = $pos.Bottom - $pos.Top
Write-Output "Size: ${winW}x${winH}"

function Capture($name) {
    Start-Sleep -Milliseconds 1500
    [WinCapture]::CaptureScreen("$OUT\$name.png", $pos.Left, $pos.Top, $winW, $winH)
    Write-Output "Captured: $name"
}

function ClickAt($relX, $relY) {
    $ax = $pos.Left + $relX
    $ay = $pos.Top + $relY
    [WinCapture]::Click($ax, $ay)
    Start-Sleep -Milliseconds 800
}

Write-Output ""
Write-Output "=== Phase 1: Main menu pages ==="

$menus = @(
    @{name="01-home"; x=60; y=85; desc="主页"},
    @{name="02-publish"; x=60; y=130; desc="发布"},
    @{name="03-account"; x=60; y=175; desc="账号"},
    @{name="04-data"; x=60; y=220; desc="数据"},
    @{name="05-cli"; x=60; y=265; desc="CLI"},
    @{name="06-comment"; x=60; y=310; desc="私信评论"},
    @{name="07-create"; x=60; y=380; desc="创作"},
    @{name="08-xiaoyi"; x=60; y=425; desc="小蚁"},
    @{name="09-team"; x=60; y=470; desc="团队"},
    @{name="10-material"; x=60; y=515; desc="素材"}
)

foreach ($m in $menus) {
    Write-Output "Clicking: $($m.desc)"
    ClickAt $m.x $m.y
    Capture $m.name
}

Write-Output ""
Write-Output "=== Phase 1 complete ==="
Write-Output "Screenshots saved to: $OUT"

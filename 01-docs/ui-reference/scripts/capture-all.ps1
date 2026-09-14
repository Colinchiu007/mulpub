# capture-all.ps1 - Batch screenshot of mp navigation pages
# Usage: powershell -ExecutionPolicy Bypass -File capture-all.ps1

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

public class MpCap {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam);

    public delegate bool EnumWindowsProc(IntPtr h, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public static IntPtr FindWindow() {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, lp) => {
            if (IsWindowVisible(h)) {
                int len = GetWindowTextLength(h);
                if (len > 0) {
                    StringBuilder sb = new StringBuilder(len + 1);
                    GetWindowText(h, sb, sb.Capacity);
                    string t = sb.ToString();
                    if (t.Contains("4.0")) {
                        found = h;
                        return false;
                    }
                }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static void Save(IntPtr h, string path) {
        RECT r;
        GetClientRect(h, out r);
        int w = r.Right, h2 = r.Bottom;
        if (w <= 0 || h2 <= 0) return;
        Bitmap bmp = new Bitmap(w, h2, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp)) {
            IntPtr hdc = g.GetHdc();
            PrintWindow(h, hdc, 2);
            g.ReleaseHdc(hdc);
        }
        bmp.Save(path, ImageFormat.Png);
        bmp.Dispose();
    }

    public static void Click(IntPtr h, int x, int y) {
        SetForegroundWindow(h);
        System.Threading.Thread.Sleep(150);
        IntPtr lp = (IntPtr)((y << 16) | (x & 0xFFFF));
        SendMessage(h, 0x0201, IntPtr.Zero, lp);
        System.Threading.Thread.Sleep(50);
        SendMessage(h, 0x0202, IntPtr.Zero, lp);
    }

    public static void Maximize(IntPtr h) {
        ShowWindow(h, 3);
    }
}
"@ -ReferencedAssemblies System.Drawing

$script:hwnd = [IntPtr]::Zero

Write-Host "=== Yixe Screenshot Tool ===" -ForegroundColor Magenta

# Find window
$script:hwnd = [MpCap]::FindWindow()
if ($script:hwnd -eq [IntPtr]::Zero) {
    Write-Host "[ERROR] Window not found" -ForegroundColor Red
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" } | ForEach-Object {
        Write-Host "  $($_.ProcessName): $($_.MainWindowTitle)" -ForegroundColor Gray
    }
    exit 1
}
Write-Host "[OK] Found window: $($script:hwnd)" -ForegroundColor Green

# Maximize
[MpCap]::Maximize($script:hwnd)
Start-Sleep -Milliseconds 500

# Output directory
$outDir = "D:\Data\projects\Multi-Publish\01-docs\ui-reference\screenshots\full-app"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

# Screenshot current state first
$currentFile = Join-Path $outDir "00-current-state.png"
[MpCap]::Save($script:hwnd, $currentFile)
Write-Host "[OK] Current state saved" -ForegroundColor Cyan

# Navigation menu definitions
$menus = @(
    @{idx=0; name="home";     label="Home"},
    @{idx=1; name="publish";  label="Publish"},
    @{idx=2; name="accounts"; label="Accounts"},
    @{idx=3; name="data";     label="DataCenter"},
    @{idx=4; name="tools";    label="Tools"},
    @{idx=5; name="comments"; label="Comments"},
    @{idx=6; name="creation"; label="Creation"},
    @{idx=7; name="ai";       label="AI-Assistant"},
    @{idx=8; name="team";     label="Team"},
    @{idx=9; name="material"; label="Material"},
    @{idx=10; name="settings"; label="Settings"}
)

# Click coordinates
$navX = 35
$navStartY = 80
$navItemHeight = 55
$waitMs = 1000

Write-Host "`n=== Capturing all 11 nav pages ===" -ForegroundColor Magenta

foreach ($m in $menus) {
    $idx = $m.idx
    $name = $m.name
    $label = $m.label

    $clickY = $navStartY + ($idx * $navItemHeight)
    
    Write-Host "[$($idx+1)/11] $label - clicking ($navX, $clickY)..." -ForegroundColor White -NoNewline

    [MpCap]::Click($script:hwnd, $navX, $clickY)
    Start-Sleep -Milliseconds $waitMs

    $fileName = "{0:D2}-{1}.png" -f ($idx + 1), $name
    $filePath = Join-Path $outDir $fileName
    [MpCap]::Save($script:hwnd, $filePath)
    
    $size = 0
    if (Test-Path $filePath) {
        $size = (Get-Item $filePath).Length
    }
    Write-Host " OK ($([math]::Round($size/1024,1)) KB)" -ForegroundColor Green
}

Write-Host "`n=== DONE ===" -ForegroundColor Magenta
Write-Host "Screenshots saved to: $outDir" -ForegroundColor Cyan

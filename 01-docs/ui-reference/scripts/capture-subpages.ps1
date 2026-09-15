# capture-subpages.ps1 - Capture sub-pages of each main nav section
# Usage: powershell -ExecutionPolicy Bypass -File capture-subpages.ps1

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
    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int h2, bool repaint);

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
        System.Threading.Thread.Sleep(100);
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
$script:hwnd = [MpCap]::FindWindow()
if ($script:hwnd -eq [IntPtr]::Zero) {
    Write-Host "[ERROR] Window not found" -ForegroundColor Red
    exit 1
}
[MpCap]::Maximize($script:hwnd)
Start-Sleep -Milliseconds 500

$baseDir = "D:\Data\projects\Multi-Publish\01-docs\ui-reference\screenshots"

# ========== PUBLISH Section Sub-pages ==========
Write-Host "`n=== PUBLISH Sub-pages ===" -ForegroundColor Magenta

$pubDir = "$baseDir\publish"
if (-not (Test-Path $pubDir)) { New-Item -ItemType Directory -Path $pubDir -Force | Out-Null }

# Navigate to Publish (index 1)
[MpCap]::Click($script:hwnd, 35, 135)
Start-Sleep -Milliseconds 1000
[MpCap]::Save($script:hwnd, "$pubDir\01-publish-main.png")
Write-Host "[OK] publish-main" -ForegroundColor Cyan

# Click inside content area to expand options
[MpCap]::Click($script:hwnd, 400, 200)
Start-Sleep -Milliseconds 500
[MpCap]::Save($script:hwnd, "$pubDir\02-publish-editor.png")
Write-Host "[OK] publish-editor" -ForegroundColor Cyan

# Click platform selector
[MpCap]::Click($script:hwnd, 500, 150)
Start-Sleep -Milliseconds 800
[MpCap]::Save($script:hwnd, "$pubDir\03-platform-selector.png")
Write-Host "[OK] platform-selector" -ForegroundColor Cyan

# Close dropdown
[MpCap]::Click($script:hwnd, 400, 200)
Start-Sleep -Milliseconds 300

# Click publish options
[MpCap]::Click($script:hwnd, 300, 250)
Start-Sleep -Milliseconds 500
[MpCap]::Save($script:hwnd, "$pubDir\04-publish-options.png")
Write-Host "[OK] publish-options" -ForegroundColor Cyan

# ========== ACCOUNTS Section Sub-pages ==========
Write-Host "`n=== ACCOUNTS Sub-pages ===" -ForegroundColor Magenta

$accDir = "$baseDir\account"
if (-not (Test-Path $accDir)) { New-Item -ItemType Directory -Path $accDir -Force | Out-Null }

[MpCap]::Click($script:hwnd, 35, 190)
Start-Sleep -Milliseconds 1000
[MpCap]::Save($script:hwnd, "$accDir\01-accounts-main.png")
Write-Host "[OK] accounts-main" -ForegroundColor Cyan

# Try to click "Add Account" button (assuming it's in the main area)
[MpCap]::Click($script:hwnd, 700, 100)
Start-Sleep -Milliseconds 800
[MpCap]::Save($script:hwnd, "$accDir\02-add-account-modal.png")
Write-Host "[OK] add-account-modal" -ForegroundColor Cyan

# Close modal
[MpCap]::Click($script:hwnd, 800, 100)
Start-Sleep -Milliseconds 300

# ========== DATA Section Sub-pages ==========
Write-Host "`n=== DATA Sub-pages ===" -ForegroundColor Magenta

$dataDir = "$baseDir\data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }

[MpCap]::Click($script:hwnd, 35, 245)
Start-Sleep -Milliseconds 1000
[MpCap]::Save($script:hwnd, "$dataDir\01-data-main.png")
Write-Host "[OK] data-main" -ForegroundColor Cyan

# Try to click a tab/filter in data view
[MpCap]::Click($script:hwnd, 400, 120)
Start-Sleep -Milliseconds 500
[MpCap]::Save($script:hwnd, "$dataDir\02-data-filter.png")
Write-Host "[OK] data-filter" -ForegroundColor Cyan

# ========== TOOLS Section Sub-pages ==========
Write-Host "`n=== TOOLS Sub-pages ===" -ForegroundColor Magenta

$toolsDir = "$baseDir\tools"
if (-not (Test-Path $toolsDir)) { New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null }

[MpCap]::Click($script:hwnd, 35, 300)
Start-Sleep -Milliseconds 1000
[MpCap]::Save($script:hwnd, "$toolsDir\01-tools-main.png")
Write-Host "[OK] tools-main" -ForegroundColor Cyan

# Click a tool item
[MpCap]::Click($script:hwnd, 400, 180)
Start-Sleep -Milliseconds 500
[MpCap]::Save($script:hwnd, "$toolsDir\02-tool-detail.png")
Write-Host "[OK] tool-detail" -ForegroundColor Cyan

# ========== COMMENTS Section Sub-pages ==========
Write-Host "`n=== COMMENTS Sub-pages ===" -ForegroundColor Magenta

$cmtDir = "$baseDir\comments"
if (-not (Test-Path $cmtDir)) { New-Item -ItemType Directory -Path $cmtDir -Force | Out-Null }

[MpCap]::Click($script:hwnd, 35, 355)
Start-Sleep -Milliseconds 1000
[MpCap]::Save($script:hwnd, "$cmtDir\01-comments-main.png")
Write-Host "[OK] comments-main" -ForegroundColor Cyan

# ========== CREATION Section Sub-pages ==========
Write-Host "`n=== CREATION Sub-pages ===" -ForegroundColor Magenta

$crDir = "$baseDir\creation"
if (-not (Test-Path $crDir)) { New-Item -ItemType Directory -Path $crDir -Force | Out-Null }

[MpCap]::Click($script:hwnd, 35, 410)
Start-Sleep -Milliseconds 1000
[MpCap]::Save($script:hwnd, "$crDir\01-creation-main.png")
Write-Host "[OK] creation-main" -ForegroundColor Cyan

# ========== AI Section Sub-pages ==========
Write-Host "`n=== AI Sub-pages ===" -ForegroundColor Magenta

$aiDir = "$baseDir\ai"
if (-not (Test-Path $aiDir)) { New-Item -ItemType Directory -Path $aiDir -Force | Out-Null }

[MpCap]::Click($script:hwnd, 35, 465)
Start-Sleep -Milliseconds 1000
[MpCap]::Save($script:hwnd, "$aiDir\01-ai-main.png")
Write-Host "[OK] ai-main" -ForegroundColor Cyan

# ========== TEAM Section Sub-pages ==========
Write-Host "`n=== TEAM Sub-pages ===" -ForegroundColor Magenta

$teamDir = "$baseDir\team"
if (-not (Test-Path $teamDir)) { New-Item -ItemType Directory -Path $teamDir -Force | Out-Null }

[MpCap]::Click($script:hwnd, 35, 520)
Start-Sleep -Milliseconds 1000
[MpCap]::Save($script:hwnd, "$teamDir\01-team-main.png")
Write-Host "[OK] team-main" -ForegroundColor Cyan

# ========== MATERIAL Section Sub-pages ==========
Write-Host "`n=== MATERIAL Sub-pages ===" -ForegroundColor Magenta

$matDir = "$baseDir\material"
if (-not (Test-Path $matDir)) { New-Item -ItemType Directory -Path $matDir -Force | Out-Null }

[MpCap]::Click($script:hwnd, 35, 575)
Start-Sleep -Milliseconds 1000
[MpCap]::Save($script:hwnd, "$matDir\01-material-main.png")
Write-Host "[OK] material-main" -ForegroundColor Cyan

# ========== SETTINGS Section Sub-pages ==========
Write-Host "`n=== SETTINGS Sub-pages ===" -ForegroundColor Magenta

$setDir = "$baseDir\setting"
if (-not (Test-Path $setDir)) { New-Item -ItemType Directory -Path $setDir -Force | Out-Null }

[MpCap]::Click($script:hwnd, 35, 630)
Start-Sleep -Milliseconds 1000
[MpCap]::Save($script:hwnd, "$setDir\01-settings-main.png")
Write-Host "[OK] settings-main" -ForegroundColor Cyan

# ========== MODALS ==========
Write-Host "`n=== MODALS ===" -ForegroundColor Magenta

$modDir = "$baseDir\modals"
if (-not (Test-Path $modDir)) { New-Item -ItemType Directory -Path $modDir -Force | Out-Null }

# Go back to Home
[MpCap]::Click($script:hwnd, 35, 80)
Start-Sleep -Milliseconds 800

# Try to find any modal dialogs by clicking likely buttons
# User icon/avatar click
[MpCap]::Click($script:hwnd, 1200, 50)
Start-Sleep -Milliseconds 500
[MpCap]::Save($script:hwnd, "$modDir\01-user-menu.png")
Write-Host "[OK] user-menu" -ForegroundColor Cyan

# Close
[MpCap]::Click($script:hwnd, 1200, 50)
Start-Sleep -Milliseconds 300

# Click notification icon
[MpCap]::Click($script:hwnd, 1150, 50)
Start-Sleep -Milliseconds 500
[MpCap]::Save($script:hwnd, "$modDir\02-notifications.png")
Write-Host "[OK] notifications" -ForegroundColor Cyan

Write-Host "`n=== ALL DONE ===" -ForegroundColor Magenta
Write-Host "Sub-pages saved to: $baseDir" -ForegroundColor Cyan

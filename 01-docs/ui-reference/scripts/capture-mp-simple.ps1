# capture-mp-simple.ps1 - Screenshot参考产品 window using Win32 API
# Usage: powershell -ExecutionPolicy Bypass -File capture-mp-simple.ps1

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;

public class MpCapture {
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

    public static void SaveScreenshot(IntPtr h, string path) {
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
}
"@

$script:foundHwnd = [IntPtr]::Zero
$script:allWindows = @()

# Find window
[MpCapture]::EnumWindows({
    param($h, $lp)
    if ([MpCapture]::IsWindowVisible($h)) {
        $len = [MpCapture]::GetWindowTextLength($h)
        if ($len -gt 0) {
            $sb = New-Object System.Text.StringBuilder($len + 1)
            [MpCapture]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
            $t = $sb.ToString()
            if ($t -match "4\.0" -or $t -match "mp" -or $t -match "mp") {
                $script:foundHwnd = $h
                Write-Host "[FOUND] $t (HWND: $h)" -ForegroundColor Green
                return $false
            }
            $script:allWindows += [PSCustomObject]@{ HWND=$h; Title=$t }
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

if ($script:foundHwnd -eq [IntPtr]::Zero) {
    Write-Host "[WARN] Auto-detect failed. Listing visible windows:" -ForegroundColor Yellow
    $script:allWindows | Where-Object { $_.Title.Length -gt 0 } | Select-Object -First 20 | Format-Table -AutoSize
    Write-Host ""
    Write-Host "Trying to find by process name..." -ForegroundColor Yellow
    $procs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" -and $_.ProcessName -match "mp|蚁" }
    if ($procs) {
        foreach ($p in $procs) {
            Write-Host "  Process: $($p.ProcessName) HWND: $($p.MainWindowHandle) Title: $($p.MainWindowTitle)" -ForegroundColor Cyan
            if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
                $script:foundHwnd = $p.MainWindowHandle
            }
        }
    }
}

if ($script:foundHwnd -eq [IntPtr]::Zero) {
    Write-Host "[ERROR] Cannot find window. Please ensure the app is running." -ForegroundColor Red
    exit 1
}

# Get window info
$rect = New-Object MpCapture+RECT
[MpCapture]::GetClientRect($script:foundHwnd, [ref]$rect) | Out-Null
Write-Host "[INFO] Window size: $($rect.Right) x $($rect.Bottom)" -ForegroundColor DarkGray

# Output dir
$outDir = "D:\Data\projects\Multi-Publish\01-docs\ui-reference\screenshots\full-app"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

# Take current screenshot
$outFile = Join-Path $outDir "00-current-state.png"
[MpCapture]::SaveScreenshot($script:foundHwnd, $outFile)
$sz = (Get-Item $outFile).Length
Write-Host "[OK] Saved: $outFile ($([math]::Round($sz/1024,1)) KB)" -ForegroundColor Cyan

# Nav menu mapping
$menus = @(
    @{i=0; n="home";     l="Home"},
    @{i=1; n="publish";  l="Publish"},
    @{i=2; n="accounts"; l="Accounts"},
    @{i=3; n="data";     l="DataCenter"},
    @{i=4; n="tools";    l="Tools"},
    @{i=5; n="comments"; l="Comments"},
    @{i=6; n="creation"; l="Creation"},
    @{i=7; n="ai";       l="AI-Assistant"},
    @{i=8; n="team";     l="Team"},
    @{i=9; n="material"; l="Material"},
    @{i=10; n="settings";l="Settings"}
)

# Click each nav item and screenshot
Write-Host "`n=== Capturing all nav pages ===" -ForegroundColor Magenta

foreach ($m in $menus) {
    $idx = $m.i
    $name = $m.n
    $label = $m.l
    
    Write-Host "[$($idx+1)/11] $label ..." -ForegroundColor White -NoNewline
    
    # Calculate click position
    $navX = 35
    $navY = 80 + ($idx * 55)
    
    [MpCapture]::Click($script:foundHwnd, $navX, $navY)
    Start-Sleep -Milliseconds 800
    
    # Screenshot
    $fName = "{0:D2}-{1}.png" -f ($idx+1), $name
    $fPath = Join-Path $outDir $fName
    [MpCapture]::SaveScreenshot($script:foundHwnd, $fPath)
    $sz = (Get-Item $fPath).Length
    Write-Host " OK ($([math]::Round($sz/1024,1)) KB)" -ForegroundColor Green
}

Write-Host "`n=== DONE ===" -ForegroundColor Magenta
Write-Host "Screenshots saved to: $outDir" -ForegroundColor Cyan

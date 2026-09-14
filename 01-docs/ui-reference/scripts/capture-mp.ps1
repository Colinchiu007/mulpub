# capture-mp.ps1 — 参考产品 4.0 桌面应用截图脚本
# 使用 Win32 API (FindWindow + PrintWindow) 截图 Electron 桌面应用
# 用法: .\capture-mp.ps1 [-OutputDir <path>] [-Maximize] [-ClickNav <navIndex>]

param(
    [string]$OutputDir = "D:\Data\projects\Multi-Publish\01-docs\ui-reference\screenshots\full-app",
    [switch]$Maximize,
    [int]$ClickNav = -1,
    [string]$FileName = "",
    [switch]$Interactive,
    [switch]$CaptureAll,
    [int]$WaitMs = 800
)

# ============================================================
# Win32 API 声明
# ============================================================
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

public class Win32Capture {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    const uint WM_PRINT = 0x0317;
    const uint WM_PRINTCLIENT = 0x0318;
    const int PW_RENDERFULLCONTENT = 0x00000002;
    const int PW_CLIENTONLY = 0x00000001;
    const int SW_MAXIMIZE = 3;
    const int SW_RESTORE = 9;

    public static Bitmap CaptureWindow(IntPtr hWnd, bool clientOnly = false) {
        RECT rect;
        if (clientOnly) {
            GetClientRect(hWnd, out rect);
            rect.Right = rect.Right;
            rect.Bottom = rect.Bottom;
        } else {
            GetWindowRect(hWnd, out rect);
        }

        int width = clientOnly ? rect.Right : rect.Right - rect.Left;
        int height = clientOnly ? rect.Bottom : rect.Bottom - rect.Top;

        if (width <= 0 || height <= 0) return null;

        Bitmap bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp)) {
            IntPtr hdc = g.GetHdc();
            uint flags = clientOnly ? PW_CLIENTONLY : PW_RENDERFULLCONTENT;
            PrintWindow(hWnd, hdc, flags);
            g.ReleaseHdc(hdc);
        }
        return bmp;
    }

    public static void SaveScreenshot(IntPtr hWnd, string filePath, bool clientOnly = false) {
        Bitmap bmp = CaptureWindow(hWnd, clientOnly);
        if (bmp != null) {
            bmp.Save(filePath, ImageFormat.Png);
            bmp.Dispose();
        }
    }

    public static void MaximizeWindow(IntPtr hWnd) {
        ShowWindow(hWnd, SW_MAXIMIZE);
    }

    public static void RestoreWindow(IntPtr hWnd) {
        ShowWindow(hWnd, SW_RESTORE);
    }

    public static void ClickAt(IntPtr hWnd, int x, int y) {
        SetForegroundWindow(hWnd);
        System.Threading.Thread.Sleep(100);
        IntPtr lParam = (IntPtr)((y << 16) | (x & 0xFFFF));
        IntPtr wParam = IntPtr.Zero;
        // WM_LBUTTONDOWN = 0x0201, WM_LBUTTONUP = 0x0202
        SendMessage(hWnd, 0x0201, wParam, lParam);
        System.Threading.Thread.Sleep(50);
        SendMessage(hWnd, 0x0202, wParam, lParam);
    }

    public static void RightClickAt(IntPtr hWnd, int x, int y) {
        SetForegroundWindow(hWnd);
        System.Threading.Thread.Sleep(100);
        IntPtr lParam = (IntPtr)((y << 16) | (x & 0xFFFF));
        IntPtr wParam = IntPtr.Zero;
        // WM_RBUTTONDOWN = 0x0204, WM_RBUTTONUP = 0x0205
        SendMessage(hWnd, 0x0204, wParam, lParam);
        System.Threading.Thread.Sleep(50);
        SendMessage(hWnd, 0x0205, wParam, lParam);
    }
}
"@

# ============================================================
# 辅助函数
# ============================================================

function Find-YixeWindow {
    <#
    .SYNOPSIS
    查找参考产品窗口句柄
    #>
    $foundHwnd = [IntPtr]::Zero

    [Win32Capture]::EnumWindows({
        param($hWnd, $lParam)
        if ([Win32Capture]::IsWindowVisible($hWnd)) {
            $len = [Win32Capture]::GetWindowTextLength($hWnd)
            if ($len -gt 0) {
                $sb = New-Object System.Text.StringBuilder($len + 1)
                [Win32Capture]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
                $title = $sb.ToString()
                # 匹配参考产品窗口标题（可能是乱码编码，也可能是正常中文）
                if ($title -match "参考产品|mp|mp|4\.0" -or $title -match "`u{8681}`u{5c0f}`u{4e8c}") {
                    $script:foundHwnd = $hWnd
                    Write-Host "[Found] Window: '$title' (HWND: $hWnd)" -ForegroundColor Green
                    return $false  # stop enumeration
                }
            }
        }
        return $true  # continue
    }, [IntPtr]::Zero) | Out-Null

    if ($script:foundHwnd -ne [IntPtr]::Zero) {
        return $script:foundHwnd
    }

    # Fallback: 列出所有可见窗口供用户选择
    Write-Host "`n[WARN] 未自动找到参考产品窗口，列出所有可见窗口：" -ForegroundColor Yellow
    $windows = @()
    [Win32Capture]::EnumWindows({
        param($hWnd, $lParam)
        if ([Win32Capture]::IsWindowVisible($hWnd)) {
            $len = [Win32Capture]::GetWindowTextLength($hWnd)
            if ($len -gt 0) {
                $sb = New-Object System.Text.StringBuilder($len + 1)
                [Win32Capture]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
                $title = $sb.ToString()
                if ($title.Length -gt 0) {
                    $script:windows += [PSCustomObject]@{
                        HWND = $hWnd
                        Title = $title
                    }
                }
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null

    $script:windows | Format-Table -AutoSize
    return [IntPtr]::Zero
}

function Take-Screenshot {
    <#
    .SYNOPSIS
    截图指定窗口并保存
    #>
    param(
        [IntPtr]$Hwnd,
        [string]$FilePath,
        [bool]$ClientOnly = $true
    )

    if ($Hwnd -eq [IntPtr]::Zero) {
        Write-Host "[ERROR] 窗口句柄无效" -ForegroundColor Red
        return $false
    }

    $dir = Split-Path $FilePath -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    [Win32Capture]::SaveScreenshot($Hwnd, $FilePath, $ClientOnly)
    $size = (Get-Item $FilePath).Length
    Write-Host "[OK] Screenshot saved: $FilePath ($([math]::Round($size/1024, 1)) KB)" -ForegroundColor Cyan
    return $true
}

function Click-Nav {
    <#
    .SYNOPSIS
    点击参考产品左侧导航栏指定位置
    #>
    param(
        [IntPtr]$Hwnd,
        [int]$NavIndex,
        [int]$WaitMs = 800
    )

    # 获取窗口尺寸
    $rect = New-Object Win32Capture+RECT
    [Win32Capture]::GetClientRect($Hwnd, [ref]$rect) | Out-Null
    $width = $rect.Right
    $height = $rect.Bottom

    Write-Host "[INFO] Window size: ${width}x${height}" -ForegroundColor DarkGray

    # 参考产品左侧导航栏布局（基于截图分析）
    # 导航栏宽度约 60-70px
    # 每个导航项高度约 50-60px
    # 顶部标题栏高度约 30-40px
    $navX = 35  # 导航栏中心 X
    $navStartY = 80  # 第一个导航项起始 Y（标题栏下方）
    $navItemHeight = 55  # 每个导航项高度

    $clickY = $navStartY + ($NavIndex * $navItemHeight)
    $clickX = $navX

    Write-Host "[INFO] Clicking nav #$NavIndex at ($clickX, $clickY)" -ForegroundColor DarkGray
    [Win32Capture]::ClickAt($Hwnd, $clickX, $clickY)
    Start-Sleep -Milliseconds $WaitMs
}

# ============================================================
# 主流程
# ============================================================

Write-Host "============================================" -ForegroundColor Magenta
Write-Host " 参考产品 4.0 截图工具 v1.0" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta

# 1. 查找参考产品窗口
Write-Host "`n[Step 1] 查找参考产品窗口..." -ForegroundColor Yellow
$hwnd = Find-YixeWindow

if ($hwnd -eq [IntPtr]::Zero) {
    Write-Host "`n[ERROR] 未找到参考产品窗口。请确保参考产品已启动并显示在桌面上。" -ForegroundColor Red
    Write-Host "  提示: 如果窗口标题不包含 '参考产品'，请手动指定 HWND 参数。" -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] 找到参考产品窗口: HWND=$hwnd" -ForegroundColor Green

# 2. 最大化窗口（可选）
if ($Maximize) {
    Write-Host "`n[Step 2] 最大化窗口..." -ForegroundColor Yellow
    [Win32Capture]::MaximizeWindow($hwnd)
    Start-Sleep -Milliseconds 500
}

# 3. 截图当前状态
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$baseDir = $OutputDir

# 定义导航菜单映射（基于参考产品已知菜单结构）
$navMenus = @(
    @{ Index = 0; Name = "home";        Label = "首页/工作台" },
    @{ Index = 1; Name = "publish";     Label = "发布" },
    @{ Index = 2; Name = "accounts";    Label = "账号管理" },
    @{ Index = 3; Name = "data";        Label = "数据中心" },
    @{ Index = 4; Name = "tools";       Label = "工具箱" },
    @{ Index = 5; Name = "comments";    Label = "评论管理" },
    @{ Index = 6; Name = "creation";    Label = "创作中心" },
    @{ Index = 7; Name = "ai";          Label = "小蚁AI" },
    @{ Index = 8; Name = "team";        Label = "团队管理" },
    @{ Index = 9; Name = "material";    Label = "素材库" },
    @{ Index = 10; Name = "settings";   Label = "设置" }
)

if ($CaptureAll) {
    # 批量截图所有主界面
    Write-Host "`n[Step 3] 批量截图所有主界面..." -ForegroundColor Yellow

    foreach ($menu in $navMenus) {
        $idx = $menu.Index
        $name = $menu.Name
        $label = $menu.Label

        Write-Host "`n--- [$($idx+1)/$($navMenus.Count)] $label ---" -ForegroundColor White

        # 点击导航项
        Click-Nav -Hwnd $hwnd -NavIndex $idx -WaitMs $WaitMs

        # 截图
        $filePath = Join-Path $baseDir ("{0:D2}-{1}.png" -f ($idx + 1), $name)
        Take-Screenshot -Hwnd $hwnd -FilePath $filePath

        # 恢复窗口（如果最大化了）
        if ($Maximize) {
            [Win32Capture]::RestoreWindow($hwnd)
            Start-Sleep -Milliseconds 200
        }
    }

    Write-Host "`n[DONE] 所有主界面截图完成！" -ForegroundColor Green
}
elseif ($ClickNav -ge 0) {
    # 截图指定导航页
    $menu = $navMenus | Where-Object { $_.Index -eq $ClickNav }
    $label = if ($menu) { $menu.Label } else { "Nav-$ClickNav" }
    $name = if ($menu) { $menu.Name } else { "nav-$ClickNav" }

    Write-Host "`n[Step 3] 截图导航页: $label" -ForegroundColor Yellow
    Click-Nav -Hwnd $hwnd -NavIndex $ClickNav -WaitMs $WaitMs

    $fileName = if ($FileName) { $FileName } else { "{0:D2}-{1}.png" -f ($ClickNav + 1), $name }
    $filePath = Join-Path $baseDir $fileName
    Take-Screenshot -Hwnd $hwnd -FilePath $filePath
}
else {
    # 仅截图当前状态
    Write-Host "`n[Step 3] 截图当前状态..." -ForegroundColor Yellow
    $fileName = if ($FileName) { $FileName } else { "current-$timestamp.png" }
    $filePath = Join-Path $baseDir $fileName
    Take-Screenshot -Hwnd $hwnd -FilePath $filePath
}

Write-Host "`n============================================" -ForegroundColor Magenta
Write-Host " 完成！截图保存在: $baseDir" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta

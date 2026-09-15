$MP_PID = 19492
$OUT = "D:\Data\projects\Multi-Publish\01-docs\ui-reference\screenshots\full-traversal"
New-Item -ItemType Directory -Path $OUT -Force | Out-Null

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
public class Mp {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, IntPtr e);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L;public int T;public int R;public int B; }
    public static bool Shot(IntPtr h, string p) {
        ShowWindow(h,9); System.Threading.Thread.Sleep(400);
        SetForegroundWindow(h); System.Threading.Thread.Sleep(300);
        RECT r; GetWindowRect(h, out r);
        int w=r.R-r.L, hh=r.B-r.T; if(w<=0||hh<=0) return false;
        var b=new Bitmap(w,hh);
        using(var g=Graphics.FromImage(b)){IntPtr dc=g.GetHdc();PrintWindow(h,dc,2);g.ReleaseHdc(dc);}
        int bl=0,tt=0;
        for(int y=0;y<hh;y+=10)for(int x=0;x<w;x+=10){tt++;var c=b.GetPixel(x,y);if(c.R<10&&c.G<10&&c.B<10)bl++;}
        if(tt>0&&bl*100/tt>80){b.Dispose();b=new Bitmap(w,hh);using(var g=Graphics.FromImage(b)){g.CopyFromScreen(r.L,r.T,0,0,new Size(w,hh));}}
        b.Save(p,ImageFormat.Png); b.Dispose(); return true;
    }
    public static void Click(IntPtr h, double rx, double ry) {
        ShowWindow(h,9); System.Threading.Thread.Sleep(400);
        SetForegroundWindow(h); System.Threading.Thread.Sleep(300);
        RECT r; GetWindowRect(h, out r);
        int x=r.L+(int)((r.R-r.L)*rx), y=r.T+(int)((r.B-r.T)*ry);
        SetCursorPos(x,y); System.Threading.Thread.Sleep(100);
        mouse_event(0x0002,0,0,0,IntPtr.Zero); System.Threading.Thread.Sleep(50);
        mouse_event(0x0004,0,0,0,IntPtr.Zero);
    }
}
"@ -ReferencedAssemblies System.Drawing

$hwnd = (Get-Process -Id $MP_PID).MainWindowHandle
$counter = 0

function Snap($name) {
    $script:counter++
    $f = Join-Path $OUT ("{0:D3}-{1}.png" -f $script:counter, $name)
    if ([Mp]::Shot($hwnd, $f)) { Write-Host "[OK] $f" -Fore Green }
    else { Write-Host "[FAIL] $name" -Fore Red }
    Start-Sleep -Milliseconds 800
}

function ClickAt($rx, $ry) {
    [Mp]::Click($hwnd, $rx, $ry)
    Write-Host "[CLICK] ($rx,$ry)" -Fore Cyan
    Start-Sleep -Seconds 1.5
}

Write-Host "=== 参考产品完整遍历 ===" -Fore Yellow

# === 阶段1: 当前注册页面 ===
Write-Host "`n--- 1. 注册页面 ---" -Fore Magenta
Snap "01-register-page"

# === 阶段2: 点击"去登录" ===
Write-Host "`n--- 2. 切换到登录页 ---" -Fore Magenta
ClickAt 0.58 0.72
Start-Sleep -Seconds 2
Snap "02-login-page"

# === 阶段3: 尝试不同登录方式 ===
Write-Host "`n--- 3. 登录页各元素 ---" -Fore Magenta
Snap "03-login-full"

# 尝试点击"忘记密码"（右上角）
ClickAt 0.85 0.52
Start-Sleep -Seconds 1
Snap "04-forgot-password"

# 如果打开了忘记密码，关闭它
ClickAt 0.82 0.28
Start-Sleep -Seconds 1

# === 阶段4: 尝试模拟登录操作 ===
Write-Host "`n--- 4. 输入测试登录信息 ---" -Fore Magenta
# 点击手机号输入框（左侧表单中部）
ClickAt 0.45 0.50
Start-Sleep -Milliseconds 500
# 输入测试手机号
[System.Windows.Forms.SendKeys]::SendWait("13800138000")
Start-Sleep -Seconds 1
Snap "05-phone-input"

# 点击密码输入框
ClickAt 0.45 0.60
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait("test123456")
Start-Sleep -Seconds 1
Snap "06-password-input"

# 点击"记住密码"复选框
ClickAt 0.42 0.70
Start-Sleep -Milliseconds 500
Snap "07-remember-pwd"

# === 阶段5: 尝试第三方登录 ===
Write-Host "`n--- 5. 第三方登录按钮 ---" -Fore Magenta
# 微信登录按钮（通常在密码输入框下方）
ClickAt 0.35 0.76
Start-Sleep -Seconds 2
Snap "08-wechat-login"

# QQ登录按钮
ClickAt 0.45 0.76
Start-Sleep -Seconds 2
Snap "09-qq-login"

Write-Host "`n=== 第一阶段完成: 登录流程 ===" -Fore Yellow
Write-Host "截图保存在: $OUT" -Fore Yellow
Write-Host "共 $script:counter 张截图" -Fore Yellow

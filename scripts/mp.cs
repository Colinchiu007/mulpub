using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using System.Threading;

public class Win32Ops {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}

public class Mp {
    private static IntPtr _hwnd;
    private static Win32Ops.RECT _rect;

    public static void Init(IntPtr hwnd) {
        _hwnd = hwnd;
        Win32Ops.SetForegroundWindow(_hwnd);
        Thread.Sleep(500);
        Win32Ops.GetWindowRect(_hwnd, out _rect);
    }

    public static string GetRect() {
        return String.Format("L{0} T{1} R{2} B{3}", _rect.Left, _rect.Top, _rect.Right, _rect.Bottom);
    }

    public static bool Shot(string path) {
        Win32Ops.GetWindowRect(_hwnd, out _rect);
        int w = _rect.Right - _rect.Left;
        int h = _rect.Bottom - _rect.Top;
        if (w <= 0 || h <= 0) return false;
        Bitmap bmp = new Bitmap(w, h);
        Graphics g = Graphics.FromImage(bmp);
        g.CopyFromScreen(_rect.Left, _rect.Top, 0, 0, new Size(w, h));
        g.Dispose();
        bmp.Save(path, ImageFormat.Png);
        bmp.Dispose();
        return true;
    }

    public static void Click(double rx, double ry) {
        Win32Ops.GetWindowRect(_hwnd, out _rect);
        int w = _rect.Right - _rect.Left;
        int h = _rect.Bottom - _rect.Top;
        int x = _rect.Left + (int)(w * rx);
        int y = _rect.Top + (int)(h * ry);
        Win32Ops.SetForegroundWindow(_hwnd);
        Thread.Sleep(200);
        Win32Ops.mouse_event(0x0002, x, y, 0, IntPtr.Zero);
        Thread.Sleep(50);
        Win32Ops.mouse_event(0x0004, x, y, 0, IntPtr.Zero);
    }

    public static void Scroll(int amount) {
        Win32Ops.mouse_event(0x0800, 0, 0, (uint)amount, IntPtr.Zero);
    }
}

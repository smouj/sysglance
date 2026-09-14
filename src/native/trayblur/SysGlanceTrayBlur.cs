// SysGlance — tray blur helper
// Replaces third-party tools (TranslucentTB etc.) with ~20 KB of our own code.
// Uses the undocumented user32!SetWindowCompositionAttribute, the same call every
// taskbar-transparency tool relies on. No external dependencies, no install:
// compile with the in-box .NET Framework compiler (csc.exe).
//
// Usage:
//   SysGlanceTrayBlur.exe --once [--tint=AARRGGBB] [--acrylic]   apply and exit
//   SysGlanceTrayBlur.exe --watch [--tint=AARRGGBB] [--acrylic]  stay resident, re-apply
//   SysGlanceTrayBlur.exe --clear                                restore Windows default
//   SysGlanceTrayBlur.exe --wallpaper=<path>                     set the desktop wallpaper
//                                                                (SystemParametersInfo, why this mode exists)
//   SysGlanceTrayBlur.exe --refresh-theme                        broadcast a theme/accent change
//
// Why --wallpaper lives here: repainting the desktop after writing
// HKCU\Control Panel\Desktop\Wallpaper needs SystemParametersInfo(
// SPI_SETDESKWALLPAPER=20, 0, path, SPIF_UPDATEINIFILE|SPIF_SENDCHANGE). Node
// cannot call Win32 without an npm native module, and this project adds none,
// so the call is exposed from the helper we already compile with the in-box
// csc.exe. Same reasoning for --refresh-theme: it broadcasts
// WM_SETTINGCHANGE("ImmersiveColorSet") + WM_DWMCOLORIZATIONCOLORCHANGED so
// dark-mode/accent writes are adopted without a logon.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

internal static class SysGlanceTrayBlur
{
    private const int WCA_ACCENT_POLICY = 19;

    private const int ACCENT_DISABLED = 0;
    private const int ACCENT_ENABLE_GRADIENT = 1;
    private const int ACCENT_ENABLE_BLURBEHIND = 3;
    private const int ACCENT_ENABLE_ACRYLICBLURBEHIND = 4;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr FindWindowEx(IntPtr hWndParent, IntPtr hWndChildAfter, string lpszClass, string lpszWindow);

    [DllImport("user32.dll")]
    private static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WindowCompositionAttributeData data);

    // SPI_SETDESKWALLPAPER: pvParam is the wallpaper path, fWinIni controls
    // persistence (UPDATEINIFILE) and the change broadcast (SENDCHANGE).
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern int SystemParametersInfo(uint uiAction, uint uiParam, string pvParam, uint fWinIni);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);

    private const uint SPI_SETDESKWALLPAPER = 20;
    private const uint SPIF_UPDATEINIFILE = 0x01;
    private const uint SPIF_SENDCHANGE = 0x02;

    private const uint WM_SETTINGCHANGE = 0x001A;
    private const uint WM_DWMCOLORIZATIONCOLORCHANGED = 0x0320;
    private const uint HWND_BROADCAST = 0xFFFF;
    private const uint SMTO_ABORTIFHUNG = 0x0002;

    [StructLayout(LayoutKind.Sequential)]
    private struct WindowCompositionAttributeData
    {
        public int Attribute;
        public IntPtr Data;
        public int SizeOfData;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct AccentPolicy
    {
        public int AccentState;
        public int AccentFlags;
        public int GradientColor;
        public int AnimationId;
    }

    // Default: dark translucent vibrancy (60% black over blur). AABBGGRR.
    private static int _tint = unchecked((int)0x99000000);
    private static int _state = ACCENT_ENABLE_BLURBEHIND;

    private static IntPtr[] Taskbars()
    {
        var bars = new List<IntPtr>();
        IntPtr primary = FindWindow("Shell_TrayWnd", null);
        if (primary != IntPtr.Zero) bars.Add(primary);

        IntPtr secondary = IntPtr.Zero;
        while ((secondary = FindWindowEx(IntPtr.Zero, secondary, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero)
        {
            bars.Add(secondary);
        }
        return bars.ToArray();
    }

    private static bool ApplyTo(IntPtr hwnd)
    {
        var policy = new AccentPolicy
        {
            AccentState = _state,
            AccentFlags = 2,
            GradientColor = _tint,
            AnimationId = 0
        };

        int size = Marshal.SizeOf(typeof(AccentPolicy));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(policy, buffer, false);
            var data = new WindowCompositionAttributeData
            {
                Attribute = WCA_ACCENT_POLICY,
                Data = buffer,
                SizeOfData = size
            };
            return SetWindowCompositionAttribute(hwnd, ref data) != 0;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static bool SetWallpaper(string path)
    {
        int ok = SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, path, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
        return ok != 0;
    }

    // Tells every top-level window that appearance settings changed. Uses
    // SendMessageTimeout so one hung window cannot block the helper forever.
    // 300 ms per window: measured ~40 s end-to-end for both broadcasts with the
    // initial 1000 ms value on a busy desktop, which is why callers treat this
    // as fire-and-forget (see src/shell/ipc.js) instead of blocking the UI.
    private const uint BROADCAST_TIMEOUT_MS = 300;

    private static void BroadcastThemeChange()
    {
        UIntPtr ignored;
        IntPtr themeName = Marshal.StringToHGlobalUni("ImmersiveColorSet");
        try
        {
            SendMessageTimeout(new IntPtr((int)HWND_BROADCAST), WM_SETTINGCHANGE, IntPtr.Zero, themeName, SMTO_ABORTIFHUNG, BROADCAST_TIMEOUT_MS, out ignored);
        }
        finally
        {
            Marshal.FreeHGlobal(themeName);
        }
        SendMessageTimeout(new IntPtr((int)HWND_BROADCAST), WM_DWMCOLORIZATIONCOLORCHANGED, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, BROADCAST_TIMEOUT_MS, out ignored);
    }

    private static int Main(string[] args)
    {
        bool watch = false;
        bool clear = false;
        bool refreshTheme = false;
        bool haveWallpaper = false;
        string wallpaper = null;

        foreach (string arg in args)
        {
            if (arg == "--watch") watch = true;
            else if (arg == "--once") watch = false;
            else if (arg == "--clear") clear = true;
            else if (arg == "--acrylic") _state = ACCENT_ENABLE_ACRYLICBLURBEHIND;
            else if (arg == "--refresh-theme") refreshTheme = true;
            else if (arg.StartsWith("--wallpaper="))
            {
                haveWallpaper = true;
                wallpaper = arg.Substring("--wallpaper=".Length).Trim().Trim('"');
            }
            else if (arg.StartsWith("--tint="))
            {
                uint parsed;
                if (uint.TryParse(arg.Substring(7), System.Globalization.NumberStyles.HexNumber, null, out parsed))
                {
                    _tint = unchecked((int)parsed);
                }
            }
        }

        if (haveWallpaper)
        {
            if (wallpaper == null || wallpaper.Length == 0)
            {
                Console.WriteLine("wallpaper=error reason=empty-path");
                return 2;
            }
            bool ok = SetWallpaper(wallpaper);
            Console.WriteLine("wallpaper=" + (ok ? "applied" : "failed") + " path=" + wallpaper);
            Console.WriteLine("applied=" + (ok ? 1 : 0));
            return ok ? 0 : 1;
        }

        if (refreshTheme)
        {
            BroadcastThemeChange();
            Console.WriteLine("theme=refreshed");
            Console.WriteLine("applied=1");
            return 0;
        }

        if (clear)
        {
            _state = ACCENT_ENABLE_GRADIENT;
            _tint = 0;
        }

        if (!watch)
        {
            int applied = 0;
            foreach (IntPtr bar in Taskbars())
            {
                if (ApplyTo(bar)) applied++;
            }
            Console.WriteLine("applied=" + applied);
            return applied > 0 ? 0 : 1;
        }

        // Resident mode: the taskbar window is recreated whenever explorer restarts,
        // so re-apply continuously. SetWindowCompositionAttribute is a cheap
        // in-process call (no child processes), so 2 s costs effectively nothing.
        while (true)
        {
            foreach (IntPtr bar in Taskbars())
            {
                ApplyTo(bar);
            }
            Thread.Sleep(2000);
        }
    }
}

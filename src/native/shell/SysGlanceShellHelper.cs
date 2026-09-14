// SysGlance — shell helper
//
// The one native binary SysGlance ships, compiled by the in-box .NET Framework
// compiler (scripts/build-native.ps1). No SDK, no Visual Studio, no npm native
// module.
//
// Why a binary at all: Node cannot call Win32 without a native npm module, and
// two shell operations genuinely need it:
//
//   --wallpaper=<path>   SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, path,
//                        SPIF_UPDATEINIFILE|SPIF_SENDCHANGE). Writing
//                        HKCU\Control Panel\Desktop\Wallpaper alone does not
//                        repaint the desktop.
//   --refresh-theme      broadcast WM_SETTINGCHANGE("ImmersiveColorSet") and
//                        WM_DWMCOLORIZATIONCOLORCHANGED so already-running apps
//                        adopt a dark-mode / accent write without a logon.
//
// There is deliberately NO taskbar-vibrancy mode and NO resident/watch mode
// here. It replaces the earlier SysGlanceTrayBlur helper, which also applied
// window composition attributes to the taskbar and could stay resident
// re-applying them. PRODUCT.md rules 1 and 2 give that effect to OpenClaw
// Widget alone: two processes applying window policy to the same taskbar fight
// each other, and last writer wins.
//
// Both modes are one-shot and exit immediately.

using System;
using System.Runtime.InteropServices;

internal static class SysGlanceShellHelper
{
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

    // 300 ms per window: with the initial 1000 ms value, a busy desktop took
    // ~40 s end-to-end for both broadcasts, which is why callers treat this as
    // fire-and-forget (see src/shell/ipc.js) instead of blocking a UI reply.
    private const uint BROADCAST_TIMEOUT_MS = 300;

    private static bool SetWallpaper(string path)
    {
        int ok = SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, path, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
        return ok != 0;
    }

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

    private static void Usage()
    {
        Console.WriteLine("SysGlance shell helper");
        Console.WriteLine("  --wallpaper=<absolute path>   set the desktop wallpaper");
        Console.WriteLine("  --refresh-theme               broadcast a theme/accent change");
        Console.WriteLine("Taskbar vibrancy is owned by OpenClaw Widget, not by this helper.");
    }

    private static int Main(string[] args)
    {
        if (args.Length == 0) { Usage(); return 2; }

        foreach (string arg in args)
        {
            if (arg == "--help" || arg == "-h" || arg == "/?")
            {
                Usage();
                return 0;
            }

            if (arg == "--refresh-theme")
            {
                BroadcastThemeChange();
                Console.WriteLine("theme=refreshed");
                Console.WriteLine("applied=1");
                return 0;
            }

            if (arg.StartsWith("--wallpaper="))
            {
                string wallpaper = arg.Substring("--wallpaper=".Length).Trim().Trim('"');
                if (wallpaper.Length == 0)
                {
                    Console.WriteLine("wallpaper=error reason=empty-path");
                    return 2;
                }
                bool ok = SetWallpaper(wallpaper);
                Console.WriteLine("wallpaper=" + (ok ? "applied" : "failed") + " path=" + wallpaper);
                Console.WriteLine("applied=" + (ok ? 1 : 0));
                return ok ? 0 : 1;
            }

            Console.WriteLine("unknown argument: " + arg);
            Usage();
            return 2;
        }

        Usage();
        return 2;
    }
}

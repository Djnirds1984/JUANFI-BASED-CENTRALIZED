// The part that makes the lock real. Low-level hooks are the only thing a normal
// desktop application can do to hold a keyboard, and they are installed only while
// the machine is locked - the moment an admin takes over they come straight off.
using System;
using System.Diagnostics;
using System.Globalization;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

namespace JuanFiCafe
{
    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MSLLHOOKSTRUCT
    {
        public Point pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    public static class Native
    {
        public const int WH_KEYBOARD_LL = 13;
        public const int WH_MOUSE_LL = 14;
        const int WM_KEYDOWN = 0x0100;
        const int WM_KEYUP = 0x0101;
        const int WM_SYSKEYDOWN = 0x0104;
        const int WM_SYSKEYUP = 0x0105;

        const int VK_CONTROL = 0x11;
        const int VK_MENU = 0x12;
        const int VK_SHIFT = 0x10;
        const int VK_LWIN = 0x5B;
        const int VK_RWIN = 0x5C;
        const int VK_ESCAPE = 0x1B;
        const int VK_TAB = 0x09;
        const int VK_F4 = 0x73;
        const int VK_F12 = 0x7B;
        const int VK_DELETE = 0x2E;

        public delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

        // Held so the garbage collector cannot take the delegates away mid-hook.
        static LowLevelProc keyboardProc;
        static LowLevelProc mouseProc;
        static IntPtr keyboardHook = IntPtr.Zero;
        static IntPtr mouseHook = IntPtr.Zero;

        /// True while the customer is locked out.
        public static bool Swallow;

        /// True while the admin password box has focus: typing must reach it, but
        /// the keys that would step around the lock still get eaten.
        public static bool PasswordMode;

        /// Raised by the hook when Ctrl+Alt+F12 is pressed, on the UI thread.
        public static event Action AdminHotkey;

        public static bool HooksInstalled
        {
            get { return keyboardHook != IntPtr.Zero; }
        }

        public static void InstallHooks()
        {
            if (keyboardHook != IntPtr.Zero) return;
            if (keyboardProc == null) keyboardProc = new LowLevelProc(OnKeyboard);
            if (mouseProc == null) mouseProc = new LowLevelProc(OnMouse);
            IntPtr module = GetModuleHandle(null);
            keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, keyboardProc, module, 0);
            mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, module, 0);
            if (keyboardHook == IntPtr.Zero) Log.Write("keyboard hook refused by Windows");
        }

        public static void RemoveHooks()
        {
            if (keyboardHook != IntPtr.Zero) { UnhookWindowsHookEx(keyboardHook); keyboardHook = IntPtr.Zero; }
            if (mouseHook != IntPtr.Zero) { UnhookWindowsHookEx(mouseHook); mouseHook = IntPtr.Zero; }
        }

        static bool Held(int vk)
        {
            return (GetAsyncKeyState(vk) & 0x8000) != 0;
        }

        static IntPtr OnKeyboard(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                long msg = wParam.ToInt64();
                bool down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;

                // The handover key is read on the way in, never passed on, so the
                // desktop underneath cannot see it.
                if (down && info.vkCode == VK_F12 && Held(VK_CONTROL) && Held(VK_MENU))
                {
                    Action handler = AdminHotkey;
                    if (handler != null) handler();
                    return (IntPtr)1;
                }

                if (!Swallow) return CallNextHookEx(keyboardHook, nCode, wParam, lParam);

                if (PasswordMode)
                {
                    // Let the password box be typed into, but keep the escape hatches
                    // shut: Win, Alt+Tab, Ctrl+Esc, Alt+F4, Ctrl+Alt+Del shortcuts.
                    if (info.vkCode == VK_LWIN || info.vkCode == VK_RWIN) return (IntPtr)1;
                    if (info.vkCode == VK_ESCAPE && Held(VK_MENU)) return (IntPtr)1;
                    if (info.vkCode == VK_ESCAPE && Held(VK_CONTROL)) return (IntPtr)1;
                    if (info.vkCode == VK_TAB && Held(VK_MENU)) return (IntPtr)1;
                    if (info.vkCode == VK_F4 && Held(VK_MENU)) return (IntPtr)1;
                    return CallNextHookEx(keyboardHook, nCode, wParam, lParam);
                }
                return (IntPtr)1;
            }
            return CallNextHookEx(keyboardHook, nCode, wParam, lParam);
        }

        static IntPtr OnMouse(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && Swallow && !PasswordMode)
            {
                long msg = wParam.ToInt64();
                // Right button, middle button and the wheel go away; a left click can
                // only ever land on the lock screen, which is fullscreen and topmost.
                if (msg == 0x0204 || msg == 0x0205 || msg == 0x0207 || msg == 0x0208 ||
                    msg == 0x020A || msg == 0x020B) return (IntPtr)1;
            }
            return CallNextHookEx(mouseHook, nCode, wParam, lParam);
        }

        // ------------------------------------------------------ housekeeping

        /// Seconds since anything was typed or clicked. Used to take the machine
        /// back if an admin walks away mid game-update.
        public static double IdleSeconds()
        {
            LASTINPUTINFO info = new LASTINPUTINFO();
            info.cbSize = (uint)Marshal.SizeOf(info);
            if (!GetLastInputInfo(ref info)) return 0;
            return (double)(Environment.TickCount - (int)info.dwTime) / 1000.0;
        }

        public static void BringToFront(Form form)
        {
            if (form == null || form.IsDisposed) return;
            try
            {
                if (!form.TopMost) form.TopMost = true;
                ShowWindow(form.Handle, 5); // SW_SHOW
                SetForegroundWindow(form.Handle);
            }
            catch { }
        }

        /// Task Manager is the one thing a locked customer could otherwise use to
        /// end the agent, so it is switched off for the duration and restored after.
        /// Ctrl+Alt+Del itself cannot be intercepted by any user-mode program -
        /// that is why the auto-off countdown exists.
        public static void SetTaskManagerBlocked(bool blocked)
        {
            foreach (RegistryHive hive in new RegistryHive[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
            {
                try
                {
                    using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Default))
                    using (RegistryKey key = baseKey.CreateSubKey(
                        @"Software\Microsoft\Windows\CurrentVersion\Policies\System", true))
                    {
                        if (key == null) continue;
                        if (blocked) key.SetValue("DisableTaskMgr", 1, RegistryValueKind.DWord);
                        else if (key.GetValue("DisableTaskMgr") != null) key.DeleteValue("DisableTaskMgr", false);
                    }
                }
                catch { }
            }
        }

        public static void HideShellNoise(bool hidden)
        {
            // Hiding the desktop icons and the Run dialog keeps a customer from
            // clicking their way into something while the meter reads zero.
            foreach (RegistryHive hive in new RegistryHive[] { RegistryHive.CurrentUser })
            {
                try
                {
                    using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Default))
                    using (RegistryKey key = baseKey.CreateSubKey(
                        @"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer", true))
                    {
                        if (key == null) continue;
                        if (hidden)
                        {
                            key.SetValue("NoDesktop", 1, RegistryValueKind.DWord);
                            key.SetValue("NoRun", 1, RegistryValueKind.DWord);
                        }
                        else
                        {
                            if (key.GetValue("NoDesktop") != null) key.DeleteValue("NoDesktop", false);
                            if (key.GetValue("NoRun") != null) key.DeleteValue("NoRun", false);
                        }
                    }
                }
                catch { }
            }
        }

        /// Only ever called when the shop turned AutoOff on, or when an admin asks
        /// for it from the settings window.
        public static void Shutdown(string reason)
        {
            Log.Write("shutting down: " + reason);
            try
            {
                Process.Start(new ProcessStartInfo("shutdown.exe", "/s /t 5 /c " + QuoteArg(reason)) { UseShellExecute = false });
            }
            catch (Exception err)
            {
                Log.Write("shutdown failed: " + err.Message);
            }
        }

        public static void Reboot(string reason)
        {
            Log.Write("rebooting: " + reason);
            try
            {
                Process.Start(new ProcessStartInfo("shutdown.exe", "/r /t 5 /c " + QuoteArg(reason)) { UseShellExecute = false });
            }
            catch (Exception err)
            {
                Log.Write("reboot failed: " + err.Message);
            }
        }

        public static void CancelShutdown()
        {
            try { Process.Start(new ProcessStartInfo("shutdown.exe", "/a") { UseShellExecute = false, CreateNoWindow = true }); }
            catch { }
        }

        static string QuoteArg(string value)
        {
            return "\"" + (value ?? "").Replace("\"", "") + "\"";
        }

        public static string FormatClock(double seconds)
        {
            if (double.IsNaN(seconds) || double.IsInfinity(seconds)) return "--:--";
            long total = (long)Math.Max(0, Math.Round(seconds));
            long hours = total / 3600;
            long minutes = (total % 3600) / 60;
            long secs = total % 60;
            if (hours > 0) return string.Format(CultureInfo.InvariantCulture, "{0}:{1:00}:{2:00}", hours, minutes, secs);
            return string.Format(CultureInfo.InvariantCulture, "{0:00}:{1:00}", minutes, secs);
        }
    }
}

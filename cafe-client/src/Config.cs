// Everything the agent remembers between runs lives in one plain ini file, plus
// the identity it reports to the panel. ProgramData rather than the exe folder so
// the agent still works when it is dropped into C:\Program Files and started by a
// standard (non-admin) shop account.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using Microsoft.Win32;

namespace JuanFiCafe
{
    public class Config
    {
        public const string AppName = "JuanFiCafe";
        public const string Version = "1.0.0";

        static string dir;
        static string file;
        static readonly Dictionary<string, string> values =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public static string Dir
        {
            get
            {
                if (dir == null)
                {
                    dir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), AppName);
                    try { Directory.CreateDirectory(dir); } catch { }
                }
                return dir;
            }
        }

        public static string FilePath
        {
            get
            {
                if (file == null) file = Path.Combine(Dir, "config.ini");
                return file;
            }
        }

        static readonly string[] Defaults = new string[]
        {
            // Empty Server means "go find the panel on the LAN" first.
            "Server=",
            "Token=",
            "Interval=3",
            "AutoOff=0",
            "AutoStart=1",
            "Guard=1",
            "AdminIdle=0",
        };

        public static void Load()
        {
            values.Clear();
            foreach (string line in Defaults)
            {
                int eq = line.IndexOf('=');
                values[line.Substring(0, eq)] = line.Substring(eq + 1);
            }

            // A technician may pre-fill config.ini next to the exe; that copy seeds
            // the real one the first time the agent runs, then the ProgramData copy
            // is what gets read and written from then on.
            string seed = Path.Combine(AppContextBase(), "config.ini");
            if (!File.Exists(FilePath) && File.Exists(seed))
            {
                try { File.Copy(seed, FilePath, true); } catch { }
            }

            if (File.Exists(FilePath))
            {
                foreach (string raw in File.ReadAllLines(FilePath))
                {
                    string line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith(";") || line.StartsWith("[")) continue;
                    int eq = line.IndexOf('=');
                    if (eq <= 0) continue;
                    values[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
                }
            }
        }

        static string AppContextBase()
        {
            try { return Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location); }
            catch { return Directory.GetCurrentDirectory(); }
        }

        public static string Get(string key, string fallback)
        {
            string v;
            return values.TryGetValue(key, out v) && !string.IsNullOrEmpty(v) ? v : fallback;
        }

        public static int GetInt(string key, int fallback)
        {
            string v;
            int n;
            if (values.TryGetValue(key, out v) && int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out n)) return n;
            return fallback;
        }

        public static bool GetFlag(string key, bool fallback)
        {
            string v;
            if (!values.TryGetValue(key, out v) || string.IsNullOrEmpty(v)) return fallback;
            v = v.Trim().ToLowerInvariant();
            return v == "1" || v == "yes" || v == "true" || v == "on";
        }

        public static void Set(string key, string value)
        {
            values[key] = value ?? "";
        }

        public static void Save()
        {
            try
            {
                List<string> lines = new List<string>();
                lines.Add("[agent]");
                foreach (KeyValuePair<string, string> pair in values)
                {
                    if (pair.Key == "Server" || pair.Key == "Token") continue;
                    lines.Add(pair.Key + "=" + pair.Value);
                }
                // Written last so a hand-edit of the address is easy to spot.
                lines.Add("Server=" + Get("Server", ""));
                lines.Add("Token=" + Get("Token", ""));
                File.WriteAllLines(FilePath, lines.ToArray());
            }
            catch (Exception err)
            {
                Log.Write("config save failed: " + err.Message);
            }
        }

        public static string ServerUrl
        {
            get
            {
                string url = Get("Server", "").TrimEnd('/');
                return string.IsNullOrEmpty(url) ? "" : url;
            }
        }

        public static string Token
        {
            get { return Get("Token", ""); }
            set { Set("Token", value); }
        }

        // ------------------------------------------------------- autostart

        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

        public static bool AutostartInstalled()
        {
            return ReadRunValue() != null;
        }

        static string ReadRunValue()
        {
            foreach (RegistryHive hive in new RegistryHive[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
            {
                try
                {
                    using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Default))
                    using (RegistryKey key = baseKey.OpenSubKey(RunKey))
                    {
                        if (key == null) continue;
                        object found = key.GetValue(AppName);
                        if (found != null) return Convert.ToString(found);
                    }
                }
                catch { }
            }
            return null;
        }

        /// The lock screen has to survive a reboot or it is decoration. HKLM is
        /// tried first so a machine-wide install covers every account, and HKCU is
        /// the fallback for a shop PC where the agent runs as an ordinary user.
        public static bool InstallAutostart()
        {
            string exe = ExePath();
            if (TryWriteRun(RegistryHive.LocalMachine, exe)) return true;
            return TryWriteRun(RegistryHive.CurrentUser, exe);
        }

        static bool TryWriteRun(RegistryHive hive, string exe)
        {
            try
            {
                using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Default))
                using (RegistryKey key = baseKey.OpenSubKey(RunKey, true))
                {
                    if (key == null) return false;
                    key.SetValue(AppName, "\"" + exe + "\"");
                    return true;
                }
            }
            catch { return false; }
        }

        public static bool RemoveAutostart()
        {
            bool ok = false;
            foreach (RegistryHive hive in new RegistryHive[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
            {
                try
                {
                    using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Default))
                    using (RegistryKey key = baseKey.OpenSubKey(RunKey, true))
                    {
                        if (key != null && key.GetValue(AppName) != null)
                        {
                            key.DeleteValue(AppName, false);
                            ok = true;
                        }
                    }
                }
                catch { }
            }
            return ok;
        }

        public static string ExePath()
        {
            try { return System.Reflection.Assembly.GetExecutingAssembly().Location; }
            catch { return AppContextBase() + "\\" + AppName + ".exe"; }
        }

        // ---------------------------------------------------------- identity

        static string mac;
        static string lanIp;

        public static string Hostname
        {
            get { return Environment.MachineName; }
        }

        /// The first real NIC on the box. Cafe desktops are wired, and the panel
        /// uses this to match the beacon against the router's ARP table.
        public static string MacAddress
        {
            get
            {
                if (mac != null) return mac;
                mac = "";
                try
                {
                    foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                    {
                        if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                        if (ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                        string physical = ni.GetPhysicalAddress().ToString();
                        if (string.IsNullOrEmpty(physical)) continue;
                        mac = PrettyMac(physical);
                        break;
                    }
                }
                catch { }
                return mac;
            }
        }

        static string PrettyMac(string hex)
        {
            List<string> pairs = new List<string>();
            for (int i = 0; i + 1 < hex.Length; i += 2) pairs.Add(hex.Substring(i, 2).ToUpperInvariant());
            return string.Join(":", pairs.ToArray());
        }

        /// Best-effort primary LAN address: ask the routing table which local
        /// address would be used to reach the shop gateway.
        public static string LocalIp
        {
            get
            {
                if (lanIp != null) return lanIp;
                lanIp = "";
                try
                {
                    foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                    {
                        if (ni.OperationalStatus != OperationalStatus.Up) continue;
                        if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                        IPInterfaceProperties props = ni.GetIPProperties();
                        if (props == null) continue;
                        foreach (UnicastIPAddressInformation ua in props.UnicastAddresses)
                        {
                            if (ua.Address.AddressFamily == AddressFamily.InterNetwork &&
                                !IPAddress.IsLoopback(ua.Address))
                            {
                                lanIp = ua.Address.ToString();
                                return lanIp;
                            }
                        }
                    }
                }
                catch { }
                return lanIp;
            }
        }

        /// One per process. The panel compares it with the last one it saw: a new
        /// boot id means the machine was rebooted, so any admin unlock is dropped.
        public static readonly string BootId = Guid.NewGuid().ToString("N");

        public static string PanelApi(string path)
        {
            return ServerUrl + "/api/cafe" + path;
        }
    }
}

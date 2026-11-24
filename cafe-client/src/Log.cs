// A technician standing at a dead desktop reads this file instead of phoning
// somebody. Kept tiny and truncated so it can never fill the disk.
using System;
using System.Globalization;
using System.IO;
using System.Text;

namespace JuanFiCafe
{
    public static class Log
    {
        static readonly object gate = new object();

        static string Path
        {
            get { return System.IO.Path.Combine(Config.Dir, "agent.log"); }
        }

        public static void Write(string message)
        {
            try
            {
                lock (gate)
                {
                    FileInfo info = new FileInfo(Path);
                    if (info.Exists && info.Length > 256 * 1024)
                    {
                        try { info.Delete(); } catch { }
                    }
                    File.AppendAllText(Path,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) +
                        "  " + message + Environment.NewLine,
                        Encoding.UTF8);
                }
            }
            catch
            {
                // Logging must never be the reason the lock screen did not appear.
            }
        }
    }
}

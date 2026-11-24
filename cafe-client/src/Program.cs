// The agent's brain: a background loop that asks the panel what this machine's
// state is, and a UI thread that owns the lock screen and the input hooks. The
// panel is the only thing that decides money; this program only obeys and, when
// the panel goes quiet, holds the last answer it was given.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Threading;
using System.Windows.Forms;

namespace JuanFiCafe
{
    public enum Phase { Unknown, Unregistered, Free, Locked, Admin }

    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool fresh;
            using (Mutex mutex = new Mutex(true, "JuanFiCafeAgent.SingleInstance", out fresh))
            {
                if (!fresh)
                {
                    // Double-clicked while the autostart copy is already live. Say
                    // so - an exe that vanishes without a word reads as broken.
                    MessageBox.Show(
                        "The JuanFi Pisonet agent is already running on this PC.\r\n\r\n"
                        + "Ctrl+Alt+F12 opens the admin unlock.",
                        "JuanFi Pisonet", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                Config.Load();

                // First run is the moment to make ourselves survive a reboot: after a
                // restart the panel sees a new boot id and drops any admin unlock, so
                // booting is never an escape from the timer.
                if (Config.GetFlag("AutoStart", true) && !Config.AutostartInstalled())
                {
                    Config.InstallAutostart();
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                // Built before the loop starts: the constructor arms the agent, so
                // the poll thread can post UI work the moment it wakes up.
                Controller controller = new Controller();
                Agent.Start();
                Application.Run(controller);
            }
        }
    }

    /// Hidden window that owns the UI thread, the hooks and the repaint timer.
    public class Controller : Form
    {
        readonly System.Windows.Forms.Timer pump = new System.Windows.Forms.Timer();

        public Controller()
        {
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.FixedToolWindow;
            Opacity = 0;
            ClientSize = new Size(0, 0);
            Visible = false;
            Agent.ui = this;

            // A form that is never allowed visible never fires Load - its handle
            // is not even created - so nothing may depend on OnLoad to boot the
            // agent. Create the hidden handle here instead: it is the door the
            // poll thread posts through, and without it every state change the
            // panel reports is silently dropped.
            CreateHandle();
            Native.AdminHotkey += new Action(Agent.AdminRequested);
            Native.InstallHooks();
            pump.Interval = 400;
            pump.Tick += delegate { Agent.Tick(); };
            pump.Start();
            Agent.Restore();
            Agent.Wake();
        }

        protected override void SetVisibleCore(bool value)
        {
            // Message loop without a window the customer can find.
            base.SetVisibleCore(false);
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            pump.Stop();
            Native.RemoveHooks();
            Native.SetTaskManagerBlocked(false);
            Native.HideShellNoise(false);
            base.OnFormClosed(e);
        }
    }

    public class Snapshot
    {
        public string Machine = "";
        public string PhaseText = "";
    }

    public static class Agent
    {
        public static Controller ui;

        static Phase phase = Phase.Unknown;
        static string machineName = "";
        static string currency = "PHP";
        static int baselineSeconds;
        static int baselineTick;
        static bool paused;
        static bool serverOk;
        static string lastError = "";
        static int lockedSince;
        static bool powerAsked;
        static bool promptOpen;
        static LockForm lockForm;
        static SettingsForm settingsForm;
        static NoticeForm noticeForm;
        static readonly ManualResetEvent wake = new ManualResetEvent(false);
        static string lastViewKey = "";

        public static bool ShouldHoldLock { get { return phase == Phase.Locked; } }

        // ------------------------------------------------------------- boot

        public static void Start()
        {
            Thread worker = new Thread(new ThreadStart(Loop));
            worker.IsBackground = true;
            worker.Name = "cafe-poll";
            worker.Start();
        }

        /// Pick up whatever the panel last told us before this machine was switched
        /// off, so a reboot neither buys time nor unlocks the desktop.
        public static void Restore()
        {
            string saved = Config.Get("LastPhase", "");
            machineName = Config.Get("LastName", Config.Hostname);
            if (saved != "locked" && saved != "free") return;

            int seconds = Config.GetInt("LastSeconds", 0);
            long stamp;
            long.TryParse(Config.Get("LastStamp", "0"), out stamp);
            long elapsed = (UtcMs() - stamp) / 1000L;
            if (elapsed < 0) elapsed = 0; // pushing the Windows clock back gains nothing
            int left = (int)(seconds - elapsed);
            if (left < 0) left = 0;

            baselineSeconds = left;
            baselineTick = Environment.TickCount;
            phase = Phase.Locked; // even a cached "free" only means "locked soon"
            lockedSince = Environment.TickCount;
            ShowLock();
            Log.Write("restored cached state: " + left + "s left");
        }

        static void Persist()
        {
            Config.Set("LastPhase", phase == Phase.Locked || phase == Phase.Free ? phase.ToString().ToLowerInvariant() : "locked");
            Config.Set("LastSeconds", RemainingRaw().ToString(CultureInfo.InvariantCulture));
            Config.Set("LastStamp", UtcMs().ToString(CultureInfo.InvariantCulture));
            Config.Set("LastName", machineName);
            Config.Save();
        }

        static long UtcMs()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        // ------------------------------------------------------------ polling

        public static void Wake()
        {
            wake.Set();
        }

        static void Loop()
        {
            while (true)
            {
                int seconds = Math.Max(1, Config.GetInt("Interval", 3));
                try { Poll(); }
                catch (Exception err) { lastError = err.Message; }
                wake.WaitOne(seconds * 1000, false);
                wake.Reset();
            }
        }

        /// Runs on the worker thread; hands anything visual back to the UI thread.
        static void Poll()
        {
            string server = Config.ServerUrl;
            if (server.Length == 0)
            {
                string found = PanelClient.Discover();
                if (found.Length > 0)
                {
                    Config.Set("Server", found);
                    Config.Save();
                    Log.Write("discovered panel " + found);
                    server = found;
                }
            }

            if (server.Length == 0)
            {
                Marshal(delegate { ApplyUnreachable("No panel found on this network."); });
                return;
            }

            string token = Config.Token;
            if (token.Length == 0)
            {
                Reply hello = PanelClient.Hello();
                if (!hello.Ok)
                {
                    Marshal(delegate { ApplyUnreachable(hello.ErrorText); });
                    return;
                }
                string issued = MiniJson.Str(hello.Json, "token", "");
                int machineId = MiniJson.Int(hello.Json, "machineId", 0);
                if (issued.Length > 0)
                {
                    Config.Token = issued;
                    Config.Save();
                    Log.Write("claimed machine " + machineId.ToString(CultureInfo.InvariantCulture));
                }
                Marshal(delegate { ApplyUnregistered(); });
                return;
            }

            Reply beat = PanelClient.Heartbeat(token);
            if (beat.Status == 404)
            {
                // The shop deleted this desktop: go back to beaming a hello.
                Config.Token = "";
                Config.Save();
                Marshal(delegate { ApplyUnregistered(); });
                return;
            }
            if (!beat.Ok)
            {
                Marshal(delegate { ApplyUnreachable(beat.ErrorText); });
                return;
            }

            Marshal(delegate { ApplyState(beat.Json); });
        }

        static void Marshal(MethodInvoker action)
        {
            Controller form = ui;
            if (form == null || !form.IsHandleCreated || form.IsDisposed) return;
            try { form.BeginInvoke(action); }
            catch { }
        }

        // ------------------------------------------------------ state changes

        static void ApplyUnreachable(string error)
        {
            lastError = error;
            if (serverOk) Log.Write("panel unreachable: " + error);
            serverOk = false;

            // Never unlock for a network problem. A cached session keeps counting on
            // this machine's stopwatch; a machine with nothing cached stays as it is.
            if (phase == Phase.Admin || phase == Phase.Unregistered)
            {
                // Admin is a deliberate handover and an unadded PC is not a paying
                // seat - a unplugged cable changes neither of those.
                return;
            }
            if (phase == Phase.Unknown)
            {
                phase = Phase.Locked;
                baselineSeconds = 0;
                baselineTick = Environment.TickCount;
                lockedSince = Environment.TickCount;
            }
            ShowLock();
            Refresh();
        }

        static void ApplyUnregistered()
        {
            serverOk = true;
            if (phase == Phase.Admin) return; // an admin finishing setup keeps the desktop
            lastError = "";
            phase = Phase.Unregistered;
            HideLock();
            ShowNotice();
        }

        static void ApplyState(Dictionary<string, object> state)
        {
            serverOk = true;
            lastError = "";
            machineName = MiniJson.Str(state, "name", machineName);
            if (string.IsNullOrEmpty(machineName)) machineName = Config.Hostname;
            currency = MiniJson.Str(state, "currency", currency);
            paused = MiniJson.Bool(state, "paused", false);

            int seconds = MiniJson.Int(state, "secondsLeft", 0);
            if (seconds < 0) seconds = 0;
            baselineSeconds = seconds;
            baselineTick = Environment.TickCount;

            bool locked = MiniJson.Bool(state, "locked", true);
            string mode = MiniJson.Str(state, "mode", "client");

            if (mode == "admin")
            {
                if (phase != Phase.Admin) Log.Write("admin mode entered from the panel");
                phase = Phase.Admin;
                HideLock();
                ShowNotice(false);
                ShowSettings();
            }
            else if (locked)
            {
                if (phase != Phase.Locked)
                {
                    lockedSince = Environment.TickCount;
                    powerAsked = false;
                    Log.Write("locked (" + seconds.ToString(CultureInfo.InvariantCulture) + "s held)");
                }
                phase = Phase.Locked;
                ShowNotice(false);
                ShowLock();
            }
            else
            {
                if (phase == Phase.Locked) Log.Write("unlocked by the counter, " + seconds.ToString(CultureInfo.InvariantCulture) + "s left");
                phase = Phase.Free;
                lockedSince = 0;
                powerAsked = false;
                Native.CancelShutdown();
                HideLock();
                ShowNotice(false);
            }
            Persist();
            Refresh();
        }

        /// The keyboard handover, answered by the panel.
        public static void EnterAdmin(Dictionary<string, object> state)
        {
            if (state != null)
            {
                machineName = MiniJson.Str(state, "name", machineName);
                int seconds = MiniJson.Int(state, "secondsLeft", baselineSeconds);
                if (seconds < 0) seconds = 0;
                baselineSeconds = seconds;
                baselineTick = Environment.TickCount;
                paused = true;
            }
            phase = Phase.Admin;
            lastError = "";
            HideLock();
            ShowNotice(false);
            ShowSettings();
            Log.Write("admin unlocked this machine - " + RemainingRaw().ToString(CultureInfo.InvariantCulture) + "s is on hold");
            Persist();
            Refresh();
        }

        public static void EndAdmin(bool callPanel)
        {
            Native.CancelShutdown();
            if (!callPanel || string.IsNullOrEmpty(Config.Token))
            {
                phase = Phase.Locked;
                lockedSince = Environment.TickCount;
                ShowLock();
                Refresh();
                return;
            }

            string token = Config.Token;
            Thread worker = new Thread(delegate()
            {
                Reply reply = PanelClient.Relock(token);
                Marshal(delegate
                {
                    if (reply.Ok)
                    {
                        ApplyState(reply.Json["state"] as Dictionary<string, object>);
                        // Handing back always parks the machine, even with time in the bank.
                        Dictionary<string, object> state = reply.Json["state"] as Dictionary<string, object>;
                        phase = Phase.Locked;
                        lockedSince = Environment.TickCount;
                        ShowLock();
                        Refresh();
                        Log.Write("admin session ended from the machine");
                    }
                    else
                    {
                        lastError = reply.ErrorText;
                        MessageBox.Show("The panel did not accept the handback:\r\n" + reply.ErrorText,
                            "JuanFi Pisonet", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    }
                });
            });
            worker.IsBackground = true;
            worker.Start();
        }

        public static void AdminRequested()
        {
            if (promptOpen) return;

            // Already handed over, or nothing to protect yet: straight to the window.
            if (phase == Phase.Admin || phase == Phase.Unregistered || string.IsNullOrEmpty(Config.Token))
            {
                ShowSettings();
                return;
            }
            promptOpen = true;
            AdminPromptForm prompt = new AdminPromptForm();
            prompt.Show();
            Native.BringToFront(prompt);
        }

        public static void PromptClosed()
        {
            promptOpen = false;
            if (phase == Phase.Locked) { ShowLock(); Refresh(); }
        }

        public static void ReconnectNow()
        {
            lastError = "";
            Wake();
            Refresh();
        }

        public static void ApplyConfigChanges()
        {
            if (phase != Phase.Locked) Native.SetTaskManagerBlocked(false);
            Wake();
        }

        // ---------------------------------------------------------- arithmetic

        static int RemainingRaw()
        {
            if (phase == Phase.Admin || phase == Phase.Locked) return baselineSeconds;
            int delta = unchecked(Environment.TickCount - baselineTick) / 1000;
            int left = baselineSeconds - delta;
            return left < 0 ? 0 : left;
        }

        // ------------------------------------------------------------ the tick

        /// Runs on the UI thread: local countdown, auto-off, idle handback.
        public static void Tick()
        {
            if (phase == Phase.Free && baselineSeconds > 0 && RemainingRaw() <= 0)
            {
                phase = Phase.Locked;
                lockedSince = Environment.TickCount;
                powerAsked = false;
                baselineSeconds = 0;
                Log.Write("time ran out on the machine");
                ShowLock();
                Persist();
            }

            int idleMinutes = Config.GetInt("AdminIdle", 0);
            if (phase == Phase.Admin && idleMinutes > 0 && Native.IdleSeconds() > idleMinutes * 60.0)
            {
                Log.Write("admin walked away - locking again");
                CloseSettings();
                EndAdmin(true);
                return;
            }

            if (phase == Phase.Locked)
            {
                int autoOff = Config.GetInt("AutoOff", 0);
                if (autoOff > 0 && remainingForDisplay() <= 0)
                {
                    int waited = unchecked(Environment.TickCount - lockedSince) / 1000;
                    if (waited >= autoOff * 60 && !powerAsked)
                    {
                        powerAsked = true;
                        Native.Shutdown("Pisonet session finished");
                    }
                }
            }

            Refresh();
            if (phase == Phase.Locked && lockForm != null && !lockForm.IsDisposed && !promptOpen)
            {
                Native.BringToFront(lockForm);
            }
        }

        static int remainingForDisplay()
        {
            return phase == Phase.Locked ? baselineSeconds : RemainingRaw();
        }

        // ------------------------------------------------------------ windows

        static void ShowLock()
        {
            ShowNotice(false);
            if (lockForm == null || lockForm.IsDisposed) lockForm = new LockForm();
            if (!lockForm.Visible) lockForm.Show();
            Native.Swallow = true;
            if (Config.GetFlag("Guard", true))
            {
                Native.SetTaskManagerBlocked(true);
                Native.HideShellNoise(true);
            }
            Native.InstallHooks();
        }

        static void HideLock()
        {
            Native.Swallow = false;
            Native.SetTaskManagerBlocked(false);
            Native.HideShellNoise(false);
            Native.InstallHooks(); // still listening for Ctrl+Alt+F12, just not blocking
            if (lockForm != null && !lockForm.IsDisposed && lockForm.Visible) lockForm.Hide();
        }

        static void ShowNotice()
        {
            if (noticeForm == null || noticeForm.IsDisposed) noticeForm = new NoticeForm();
            if (!noticeForm.Visible) noticeForm.Show();
        }

        static void ShowNotice(bool show)
        {
            if (show) { ShowNotice(); return; }
            if (noticeForm != null && !noticeForm.IsDisposed && noticeForm.Visible) noticeForm.Hide();
        }

        static void ShowSettings()
        {
            if (settingsForm == null || settingsForm.IsDisposed)
            {
                settingsForm = new SettingsForm();
                settingsForm.FormClosed += delegate { settingsForm = null; };
            }
            if (!settingsForm.Visible) settingsForm.Show();
            Native.BringToFront(settingsForm);
        }

        static void CloseSettings()
        {
            if (settingsForm != null && !settingsForm.IsDisposed) settingsForm.Close();
        }

        // ------------------------------------------------------------- screen

        static void Refresh()
        {
            if (phase != Phase.Locked) { lastViewKey = ""; return; }
            if (lockForm == null || lockForm.IsDisposed) return;

            LockView view = new LockView();
            int left = remainingForDisplay();
            view.Machine = machineName;
            view.Clock = Native.FormatClock(left);

            if (left > 0)
            {
                view.Headline = "PAUSED";
                view.Tone = Color.FromArgb(120, 190, 255);
                view.Message = "You still have time on this PC. Ask the counter to press Start when you are ready.";
            }
            else
            {
                view.Headline = "TIME EXPIRED";
                view.Tone = Color.FromArgb(255, 176, 32);
                view.Message = "Ask the counter to add time on this PC.";
                int autoOff = Config.GetInt("AutoOff", 0);
                if (autoOff > 0)
                {
                    int waited = left <= 0 ? unchecked(Environment.TickCount - lockedSince) / 1000 : 0;
                    int untilOff = autoOff * 60 - waited;
                    if (untilOff < 0) untilOff = 0;
                    view.Message += "\r\nThis PC switches itself off in " + Native.FormatClock(untilOff) + ".";
                }
            }

            string server = Config.ServerUrl;
            if (serverOk) lastError = "";
            view.Footer = (serverOk ? "connected to " + server : "cannot reach the panel" + (string.IsNullOrEmpty(lastError) ? "" : " (" + lastError + ")")) +
                          "   -   Ctrl+Alt+F12 for the shop owner";
            view.ShowRetry = !serverOk;

            string key = view.Key;
            if (key == lastViewKey) return;
            lastViewKey = key;
            lockForm.Apply(view);
        }

        public static Snapshot Take()
        {
            Snapshot shot = new Snapshot();
            shot.Machine = string.IsNullOrEmpty(machineName) ? Config.Hostname : machineName;
            int left = RemainingRaw();
            string clock = Native.FormatClock(left);
            switch (phase)
            {
                case Phase.Unregistered: shot.PhaseText = "not added to the shop yet"; break;
                case Phase.Admin: shot.PhaseText = "admin mode - customer time held at " + clock; break;
                case Phase.Locked: shot.PhaseText = left > 0 ? "locked - " + clock + " held" : "locked - no time left"; break;
                case Phase.Free: shot.PhaseText = "in use - " + clock + " left"; break;
                default: shot.PhaseText = serverOk ? "waiting for the panel" : "no connection to the panel"; break;
            }
            if (!serverOk && phase != Phase.Unknown) shot.PhaseText += "  (offline)";
            return shot;
        }
    }

    /// Shown on a desktop the shop has not added yet. Deliberately an ordinary
    /// window: an unenrolled PC is nobody's paying customer, and the technician
    /// still needs to be able to browse the panel to add it.
    public class NoticeForm : Form
    {
        readonly Label body = new Label();

        public NoticeForm()
        {
            Text = "JuanFi Pisonet agent";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = true;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(540, 268);
            BackColor = Color.FromArgb(17, 24, 41);

            Label heading = new Label();
            heading.Text = "AGENT INSTALLED";
            heading.Font = new Font("Segoe UI", 16f, FontStyle.Bold);
            heading.ForeColor = Color.FromArgb(255, 176, 32);
            heading.TextAlign = ContentAlignment.MiddleCenter;
            heading.SetBounds(0, 18, 540, 30);
            Controls.Add(heading);

            body.Font = new Font("Segoe UI", 10f);
            body.ForeColor = Color.White;
            body.SetBounds(24, 60, 492, 110);
            Controls.Add(body);

            Button retry = new Button();
            retry.Text = "Ask the panel again";
            retry.SetBounds(24, 188, 180, 38);
            retry.FlatStyle = FlatStyle.Flat;
            retry.BackColor = Color.FromArgb(36, 46, 70);
            retry.ForeColor = Color.White;
            retry.Click += delegate { Agent.ReconnectNow(); };
            Controls.Add(retry);

            Button open = new Button();
            open.Text = "Settings";
            open.SetBounds(214, 188, 120, 38);
            open.FlatStyle = FlatStyle.Flat;
            open.BackColor = Color.FromArgb(46, 58, 86);
            open.ForeColor = Color.White;
            open.Click += delegate { Agent.AdminRequested(); };
            Controls.Add(open);

            Button hide = new Button();
            hide.Text = "Minimize";
            hide.SetBounds(344, 188, 172, 38);
            hide.FlatStyle = FlatStyle.Flat;
            hide.BackColor = Color.FromArgb(30, 38, 58);
            hide.ForeColor = Color.FromArgb(150, 163, 188);
            hide.Click += delegate { WindowState = FormWindowState.Minimized; };
            Controls.Add(hide);
        }

        protected override void OnVisibleChanged(EventArgs e)
        {
            base.OnVisibleChanged(e);
            if (!Visible) return;
            string server = Config.ServerUrl;
            body.Text = "This PC has not been added to the shop yet.\r\n\r\n" +
                        "host  " + Config.Hostname + "\r\n" +
                        "mac   " + Config.MacAddress + "\r\n" +
                        "ip    " + Config.LocalIp + "\r\n" +
                        "panel " + (string.IsNullOrEmpty(server) ? "(not found on this network)" : server) +
                        "\r\n\r\nOpen the Pisonet page on the panel and press Add PC.";
        }
    }
}

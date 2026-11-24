// The window an admin gets after unlocking: this is where the shop changes the
// panel address, turns auto-off on, and hands the machine back. Closing it does
// not end the admin session - only Lock now, or a reboot, does that.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Threading;
using System.Windows.Forms;

namespace JuanFiCafe
{
    public class SettingsForm : Form
    {
        readonly Label statusLine = new Label();
        readonly Label detailLine = new Label();
        readonly TextBox server = new TextBox();
        readonly NumericUpDown interval = new NumericUpDown();
        readonly NumericUpDown autoOff = new NumericUpDown();
        readonly NumericUpDown adminIdle = new NumericUpDown();
        readonly CheckBox autostart = new CheckBox();
        readonly CheckBox guard = new CheckBox();
        readonly Label probe = new Label();
        readonly System.Windows.Forms.Timer refresh = new System.Windows.Forms.Timer();
        bool revealed;

        public SettingsForm()
        {
            Text = "JuanFi Pisonet - shop owner";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = true;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(620, 556);
            BackColor = Color.FromArgb(17, 24, 41);
            TopMost = true;

            Font face = new Font("Segoe UI", 10f);
            Font bold = new Font("Segoe UI", 13f, FontStyle.Bold);

            Label heading = Make("ADMIN MODE", bold, Color.FromArgb(255, 176, 32), 0, 16, 620, 28);
            heading.TextAlign = ContentAlignment.MiddleCenter;
            Controls.Add(heading);

            statusLine.SetBounds(24, 50, 572, 26);
            statusLine.Font = face;
            statusLine.ForeColor = Color.White;
            Controls.Add(statusLine);

            detailLine.SetBounds(24, 78, 572, 44);
            detailLine.Font = new Font("Segoe UI", 9f);
            detailLine.ForeColor = Color.FromArgb(150, 163, 188);
            detailLine.TextAlign = ContentAlignment.TopLeft;
            Controls.Add(detailLine);

            int y = 136;
            Controls.Add(Make("Panel address", face, Color.FromArgb(150, 163, 188), 24, y + 4, 150, 24));
            server.SetBounds(182, y, 300, 26);
            server.Font = face;
            Controls.Add(server);
            Button find = MakeButton("Find on LAN", 492, y - 2, 104, 30);
            find.Click += delegate { FindPanel(); };
            Controls.Add(find);

            y += 44;
            AddField("Heartbeat seconds (3-60)", interval, y, Config.GetInt("Interval", 3), 1, 60);
            AddField("Auto-off after expiry (minutes, 0 = never)", autoOff, y + 44, Config.GetInt("AutoOff", 0), 0, 240);
            AddField("Re-lock when idle in admin mode (min, 0 = never)", adminIdle, y + 88, Config.GetInt("AdminIdle", 0), 0, 240);

            y += 132;
            autostart.Text = "Start this agent automatically when the PC boots";
            autostart.ForeColor = Color.White;
            autostart.Font = face;
            autostart.SetBounds(24, y, 420, 24);
            autostart.Checked = Config.GetFlag("AutoStart", true);
            Controls.Add(autostart);

            guard.Text = "Block Task Manager while locked";
            guard.ForeColor = Color.White;
            guard.Font = face;
            guard.SetBounds(24, y + 28, 420, 24);
            guard.Checked = Config.GetFlag("Guard", true);
            Controls.Add(guard);

            Label note = Make("Restarting this PC always brings the lock screen back with the customer's remaining time intact -" +
                              " rebooting is never a way out, and it ends admin mode.", new Font("Segoe UI", 9f),
                              Color.FromArgb(150, 163, 188), 24, y + 62, 572, 44);
            Controls.Add(note);

            int by = 468;
            Button save = MakeButton("Save", 24, by, 130, 38);
            save.BackColor = Color.FromArgb(36, 46, 70);
            save.ForeColor = Color.White;
            save.Click += delegate { Save(); };
            Controls.Add(save);

            Button locknow = MakeButton("Lock now & hand back", 164, by, 190, 38);
            locknow.BackColor = Color.FromArgb(122, 32, 32);
            locknow.ForeColor = Color.White;
            locknow.Click += delegate { Agent.EndAdmin(true); RefreshInfo(); };
            Controls.Add(locknow);

            Button reboot = MakeButton("Restart PC", 364, by, 110, 38);
            reboot.BackColor = Color.FromArgb(46, 58, 86);
            reboot.ForeColor = Color.White;
            reboot.Click += delegate
            {
                DialogResult answer = MessageBox.Show(this,
                    "Restart now? The agent comes back on boot and this machine drops out of admin mode.",
                    "Restart", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (answer == DialogResult.Yes) Native.Reboot("Pisonet admin restart");
            };
            Controls.Add(reboot);

            Button close = MakeButton("Close", 484, by, 112, 38);
            close.BackColor = Color.FromArgb(30, 38, 58);
            close.ForeColor = Color.FromArgb(150, 163, 188);
            close.Click += delegate { Close(); };
            Controls.Add(close);

            Button reveal = MakeButton("Show ID", 24, by + 46, 100, 26);
            reveal.ForeColor = Color.FromArgb(150, 163, 188);
            reveal.BackColor = Color.FromArgb(17, 24, 41);
            reveal.Click += delegate
            {
                revealed = !revealed;
                reveal.Text = revealed ? "Hide ID" : "Show ID";
                RefreshInfo();
            };
            Controls.Add(reveal);

            probe.SetBounds(140, by + 46, 456, 26);
            probe.Font = new Font("Segoe UI", 9f);
            probe.ForeColor = Color.FromArgb(150, 163, 188);
            Controls.Add(probe);

            refresh.Interval = 1000;
            refresh.Tick += delegate { RefreshInfo(); };
            refresh.Start();
        }

        void AddField(string text, NumericUpDown box, int top, int value, int min, int max)
        {
            Controls.Add(Make(text, new Font("Segoe UI", 10f), Color.FromArgb(150, 163, 188), 24, top + 4, 420, 24));
            box.SetBounds(460, top, 80, 26);
            box.Minimum = min;
            box.Maximum = max;
            box.Value = Math.Min(max, Math.Max(min, value));
            box.Font = new Font("Segoe UI", 10f);
            Controls.Add(box);
        }

        Label Make(string text, Font font, Color color, int x, int y, int w, int h)
        {
            Label label = new Label();
            label.Text = text;
            label.Font = font;
            label.ForeColor = color;
            label.SetBounds(x, y, w, h);
            return label;
        }

        Button MakeButton(string text, int x, int y, int w, int h)
        {
            Button button = new Button();
            button.Text = text;
            button.SetBounds(x, y, w, h);
            button.FlatStyle = FlatStyle.Flat;
            button.Font = new Font("Segoe UI", 9.5f);
            return button;
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            server.Text = Config.ServerUrl;
            RefreshInfo();
        }

        void RefreshInfo()
        {
            Snapshot shot = Agent.Take();
            statusLine.Text = shot.Machine + "  -  " + shot.PhaseText;
            string token = Config.Token;
            if (token.Length > 0 && !revealed)
            {
                token = token.Length > 12
                    ? token.Substring(0, 6) + "..." + token.Substring(token.Length - 4)
                    : "set";
            }
            detailLine.Text = "host " + Config.Hostname + "    mac " + Config.MacAddress + "    ip " + Config.LocalIp +
                              "\r\nagent " + Config.Version + "    token " + (string.IsNullOrEmpty(token) ? "not registered yet" : token);

            bool installed = Config.AutostartInstalled();
            autostart.Text = "Start this agent automatically when the PC boots  (" +
                             (installed ? "installed" : "not installed") + ")";
        }

        void FindPanel()
        {
            probe.Text = "Shouting on the LAN...";
            probe.ForeColor = Color.FromArgb(150, 163, 188);
            Thread worker = new Thread(delegate()
            {
                string found = PanelClient.Discover();
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        if (string.IsNullOrEmpty(found))
                        {
                            probe.Text = "No panel answered on UDP 47808.";
                            probe.ForeColor = Color.FromArgb(255, 106, 106);
                            return;
                        }
                        server.Text = found;
                        probe.Text = "Found " + found;
                        probe.ForeColor = Color.FromArgb(120, 220, 150);
                    });
                }
                catch { }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        void Save()
        {
            string url = server.Text.Trim().TrimEnd('/');
            if (url.Length > 0 && !url.StartsWith("http://") && !url.StartsWith("https://")) url = "http://" + url;
            Config.Set("Server", url);
            Config.Set("Interval", ((int)interval.Value).ToString(CultureInfo.InvariantCulture));
            Config.Set("AutoOff", ((int)autoOff.Value).ToString(CultureInfo.InvariantCulture));
            Config.Set("AdminIdle", ((int)adminIdle.Value).ToString(CultureInfo.InvariantCulture));
            Config.Set("Guard", guard.Checked ? "1" : "0");

            bool wantStart = autostart.Checked;
            Config.Set("AutoStart", wantStart ? "1" : "0");
            bool installed;
            if (wantStart) installed = Config.InstallAutostart();
            else { Config.RemoveAutostart(); installed = false; }
            Config.Save();

            Agent.ApplyConfigChanges();

            probe.Text = "Saved.  Autostart " + (wantStart ? (installed ? "on" : "could not be written - run once as administrator") : "off");
            probe.ForeColor = wantStart && !installed ? Color.FromArgb(255, 196, 120) : Color.FromArgb(120, 220, 150);
            RefreshInfo();
        }
    }
}

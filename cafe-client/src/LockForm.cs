// What the customer sees when the meter hits zero: every screen, no title bar,
// nothing to click past. It never decides anything on its own - Agent tells it
// what to say - which keeps the whole money question on the panel.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Windows.Forms;

namespace JuanFiCafe
{
    public class LockForm : Form
    {
        readonly Label headline = new Label();
        readonly Label clock = new Label();
        readonly Label message = new Label();
        readonly Label footer = new Label();
        readonly Label machine = new Label();
        readonly Panel sheet = new Panel();
        readonly Button retry = new Button();

        static readonly Color Ink = Color.FromArgb(9, 14, 26);
        static readonly Color Sheet = Color.FromArgb(17, 24, 41);
        static readonly Color Accent = Color.FromArgb(255, 176, 32);
        static readonly Color Dim = Color.FromArgb(150, 163, 188);

        public LockForm()
        {
            Text = "JuanFi Pisonet";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Ink;
            KeyPreview = true;
            Bounds = SystemInformation.VirtualScreen;

            sheet.BackColor = Sheet;
            sheet.BorderStyle = BorderStyle.None;
            sheet.Size = new Size(720, 420);
            Controls.Add(sheet);

            headline.Dock = DockStyle.Top;
            headline.Height = 84;
            headline.TextAlign = ContentAlignment.BottomCenter;
            headline.ForeColor = Accent;
            headline.Font = new Font("Segoe UI", 26f, FontStyle.Bold);
            headline.Text = "TIME EXPIRED";

            clock.Dock = DockStyle.Top;
            clock.Height = 150;
            clock.TextAlign = ContentAlignment.MiddleCenter;
            clock.ForeColor = Color.White;
            clock.Font = new Font("Segoe UI", 64f, FontStyle.Bold);
            clock.Text = "00:00";

            message.Dock = DockStyle.Top;
            message.Height = 96;
            message.TextAlign = ContentAlignment.TopCenter;
            message.ForeColor = Dim;
            message.Font = new Font("Segoe UI", 14f, FontStyle.Regular);
            message.Text = "Ask the counter to add time on this PC.";

            machine.Dock = DockStyle.Top;
            machine.Height = 40;
            machine.TextAlign = ContentAlignment.MiddleCenter;
            machine.ForeColor = Color.White;
            machine.Font = new Font("Segoe UI", 12f, FontStyle.Bold);

            retry.Dock = DockStyle.Bottom;
            retry.Size = new Size(180, 40);
            retry.FlatStyle = FlatStyle.Flat;
            retry.ForeColor = Color.White;
            retry.BackColor = Color.FromArgb(36, 46, 70);
            retry.Text = "Reconnect";
            retry.TabStop = false;
            retry.Visible = false;
            retry.Click += delegate { Agent.ReconnectNow(); };
            sheet.Controls.Add(retry);

            footer.Dock = DockStyle.Bottom;
            footer.Height = 44;
            footer.TextAlign = ContentAlignment.MiddleCenter;
            footer.ForeColor = Dim;
            footer.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            sheet.Controls.Add(footer);
            sheet.Controls.Add(machine);
            sheet.Controls.Add(message);
            sheet.Controls.Add(clock);
            sheet.Controls.Add(headline);
            retry.BringToFront();

            Resize += delegate { Center(); };
            KeyDown += OnKeyDown;
        }

        void Center()
        {
            if (sheet.Width >= ClientSize.Width)
            {
                sheet.Width = Math.Max(320, ClientSize.Width - 40);
            }
            sheet.Location = new Point(
                (ClientSize.Width - sheet.Width) / 2,
                Math.Max(20, (ClientSize.Height - sheet.Height) / 2));
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Bounds = SystemInformation.VirtualScreen;
            Center();
            try { Focus(); } catch { }
        }

        void OnKeyDown(object sender, KeyEventArgs e)
        {
            // The low-level hook already eats these; this is the belt to that braces.
            if (e.Alt && e.Control && e.KeyCode == Keys.F12) { Agent.AdminRequested(); e.Handled = true; return; }
            e.Handled = true;
            e.SuppressKeyPress = true;
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // Alt+F4 and the taskbar have no way in while the machine is locked.
            if (Agent.ShouldHoldLock) { e.Cancel = true; return; }
            base.OnFormClosing(e);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                // No tool window flicker when we re-assert ourselves on top.
                cp.ExStyle |= 0x00800000; // WS_EX_TOOLWINDOW
                return cp;
            }
        }

        /// Called from the UI thread whenever the picture changes.
        public void Apply(LockView view)
        {
            headline.Text = view.Headline;
            clock.Text = view.Clock;
            message.Text = view.Message;
            machine.Text = string.IsNullOrEmpty(view.Machine) ? "" : view.Machine;
            footer.Text = view.Footer;
            retry.Visible = view.ShowRetry;

            Color tone = view.Tone;
            headline.ForeColor = tone;
            clock.ForeColor = Color.White;
            BackColor = Ink;
            Invalidate(true);
            sheet.Invalidate(true);
        }
    }

    /// One snapshot of what the screen should read. Keeping it a plain value object
    /// means the lock screen has no logic to get wrong.
    public class LockView
    {
        public string Headline = "LOCKED";
        public string Clock = "00:00";
        public string Message = "";
        public string Machine = "";
        public string Footer = "";
        public bool ShowRetry;
        public Color Tone = Color.FromArgb(255, 176, 32);

        public string Key
        {
            get
            {
                return string.Join("|", new string[] {
                    Headline, Clock, Message, Machine, Footer,
                    ShowRetry ? "1" : "0",
                    Tone.ToArgb().ToString(CultureInfo.InvariantCulture) });
            }
        }
    }
}

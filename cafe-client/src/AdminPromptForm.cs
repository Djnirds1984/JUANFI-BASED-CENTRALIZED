// The shop owner's way in. Ctrl+Alt+F12 anywhere on the machine opens this box;
// the password is checked by the panel, never against anything stored on the PC,
// so a stolen desktop still yields no secret.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

namespace JuanFiCafe
{
    public class AdminPromptForm : Form
    {
        readonly TextBox box = new TextBox();
        readonly Button okay = new Button();
        readonly Button cancel = new Button();
        readonly Label hint = new Label();
        readonly Label title = new Label();
        bool done;

        public AdminPromptForm()
        {
            Text = "Shop owner";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(440, 236);
            TopMost = true;
            BackColor = Color.FromArgb(17, 24, 41);
            KeyPreview = true;

            title.Text = "ADMIN UNLOCK";
            title.Font = new Font("Segoe UI", 15f, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(255, 176, 32);
            title.TextAlign = ContentAlignment.MiddleCenter;
            title.SetBounds(0, 22, 440, 34);
            Controls.Add(title);

            hint.Text = "The customer's remaining time is frozen while you use this PC.";
            hint.ForeColor = Color.FromArgb(150, 163, 188);
            hint.Font = new Font("Segoe UI", 9.5f);
            hint.TextAlign = ContentAlignment.MiddleCenter;
            hint.SetBounds(10, 58, 420, 40);
            Controls.Add(hint);

            box.SetBounds(70, 106, 300, 30);
            box.Font = new Font("Segoe UI", 14f);
            box.UseSystemPasswordChar = true;
            box.TabStop = true;
            Controls.Add(box);

            okay.Text = "Unlock";
            okay.SetBounds(70, 156, 140, 38);
            okay.FlatStyle = FlatStyle.Flat;
            okay.ForeColor = Color.White;
            okay.BackColor = Color.FromArgb(36, 46, 70);
            okay.Click += delegate { Try(); };
            Controls.Add(okay);

            cancel.Text = "Cancel";
            cancel.SetBounds(230, 156, 140, 38);
            cancel.FlatStyle = FlatStyle.Flat;
            cancel.ForeColor = Color.FromArgb(150, 163, 188);
            cancel.BackColor = Color.FromArgb(26, 34, 54);
            cancel.Click += delegate { Close(); };
            Controls.Add(cancel);

            AcceptButton = okay;
            KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.Escape) { Close(); e.Handled = true; }
            };
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Native.PasswordMode = true;
            Native.BringToFront(this);
            box.Focus();
            box.SelectAll();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            Native.PasswordMode = false;
            base.OnFormClosed(e);
            Agent.PromptClosed();
        }

        void Try()
        {
            if (done) return;
            string password = box.Text;
            if (password.Length == 0) { Fail("Type the admin password."); return; }

            done = true;
            okay.Enabled = false;
            cancel.Enabled = false;
            hint.Text = "Checking with the panel...";
            hint.ForeColor = Color.FromArgb(150, 163, 188);

            string token = Config.Token;
            Thread worker = new Thread(delegate()
            {
                Reply reply = PanelClient.Unlock(token, password);
                Done(reply);
            });
            worker.IsBackground = true;
            worker.Start();
        }

        void Done(Reply reply)
        {
            if (IsDisposed) return;
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    if (IsDisposed) return;
                    done = false;
                    okay.Enabled = true;
                    cancel.Enabled = true;
                    if (!reply.Ok) { Fail(reply.ErrorText); return; }
                    Dictionary<string, object> state = reply.Json["state"] as Dictionary<string, object>;
                    Close();
                    Agent.EnterAdmin(state);
                });
            }
            catch { }
        }

        void Fail(string message)
        {
            hint.Text = message;
            hint.ForeColor = Color.FromArgb(255, 106, 106);
            box.SelectAll();
            box.Focus();
            done = false;
            okay.Enabled = true;
            cancel.Enabled = true;
        }
    }
}

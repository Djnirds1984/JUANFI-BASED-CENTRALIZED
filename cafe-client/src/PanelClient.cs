// The agent only ever asks questions; the panel answers them. Nothing here opens
// a listener, so a customer desktop needs no inbound firewall rule at all.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace JuanFiCafe
{
    public class Reply
    {
        public int Status;
        public string Body = "";
        public Dictionary<string, object> Json = new Dictionary<string, object>();
        public string Error;

        public bool Ok { get { return Status >= 200 && Status < 300; } }

        public string ErrorText
        {
            get
            {
                string fromBody = MiniJson.Str(Json, "error", null);
                if (!string.IsNullOrEmpty(fromBody)) return fromBody;
                if (!string.IsNullOrEmpty(Error)) return Error;
                return "panel answered " + Status.ToString(CultureInfo.InvariantCulture);
            }
        }
    }

    public static class PanelClient
    {
        public const int DiscoveryPort = 47808;
        const string Hunt = "JUANFI-CAFE-HUNT";

        static PanelClient()
        {
            // The panel is plain HTTP on a LAN; TLS defaults in .NET 4 can be too
            // old for some hosts, so offer everything this box supports.
            // 4032 = Tls | Tls11 | Tls12, spelled numerically so an old mscorlib
            // without the Tls11/Tls12 members still compiles.
            try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)4032; }
            catch { }
        }

        static Reply Send(string method, string url, string json, string token)
        {
            Reply reply = new Reply();
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = method;
                req.Timeout = 5000;
                req.ReadWriteTimeout = 5000;
                req.UserAgent = "JuanFiCafe/" + Config.Version;
                if (!string.IsNullOrEmpty(token)) req.Headers["X-Cafe-Token"] = token;
                if (json != null)
                {
                    byte[] payload = Encoding.UTF8.GetBytes(json);
                    req.ContentType = "application/json";
                    req.ContentLength = payload.Length;
                    using (Stream s = req.GetRequestStream()) s.Write(payload, 0, payload.Length);
                }
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    reply.Status = (int)res.StatusCode;
                    reply.Body = ReadBody(res.GetResponseStream());
                }
            }
            catch (WebException wex)
            {
                HttpWebResponse res = wex.Response as HttpWebResponse;
                if (res != null)
                {
                    reply.Status = (int)res.StatusCode;
                    reply.Body = ReadBody(res.GetResponseStream());
                    try { res.Close(); } catch { }
                }
                else
                {
                    reply.Status = 0;
                    reply.Error = wex.Message;
                }
            }
            catch (Exception err)
            {
                reply.Status = 0;
                reply.Error = err.Message;
            }
            if (!string.IsNullOrEmpty(reply.Body))
            {
                try { reply.Json = MiniJson.ParseObject(reply.Body); }
                catch { reply.Json = new Dictionary<string, object>(); }
            }
            return reply;
        }

        static string ReadBody(Stream stream)
        {
            if (stream == null) return "";
            using (stream)
            using (MemoryStream ms = new MemoryStream())
            {
                byte[] buffer = new byte[4096];
                int read;
                while (true)
                {
                    try { read = stream.Read(buffer, 0, buffer.Length); }
                    catch { break; }
                    if (read <= 0) break;
                    ms.Write(buffer, 0, read);
                }
                return Encoding.UTF8.GetString(ms.ToArray(), 0, (int)ms.Length);
            }
        }

        // ------------------------------------------------------- endpoints

        /// "A PC with the app installed is sitting here." Also how an already-added
        /// desktop collects its token without anybody typing it.
        public static Reply Hello()
        {
            string json = "{" +
                "\"hostname\":" + MiniJson.Quote(Config.Hostname) + "," +
                "\"ip\":" + MiniJson.Quote(Config.LocalIp) + "," +
                "\"mac\":" + MiniJson.Quote(Config.MacAddress) + "," +
                "\"version\":" + MiniJson.Quote(Config.Version) + "}";
            return Send("POST", Config.PanelApi("/agent/hello"), json, null);
        }

        public static Reply Heartbeat(string token)
        {
            string json = "{" +
                "\"bootId\":" + MiniJson.Quote(Config.BootId) + "," +
                "\"hostname\":" + MiniJson.Quote(Config.Hostname) + "," +
                "\"ip\":" + MiniJson.Quote(Config.LocalIp) + "," +
                "\"version\":" + MiniJson.Quote(Config.Version) + "}";
            return Send("POST", Config.PanelApi("/agent/heartbeat"), json, token);
        }

        /// The admin password is checked by the panel and never written to this PC.
        public static Reply Unlock(string token, string password)
        {
            string json = "{\"password\":" + MiniJson.Quote(password) + "}";
            return Send("POST", Config.PanelApi("/agent/unlock"), json, token);
        }

        public static Reply Relock(string token)
        {
            return Send("POST", Config.PanelApi("/agent/relock"), "{}", token);
        }

        // ------------------------------------------------------- discovery

        /// Shout on the LAN for a panel that will answer, so an install does not
        /// need the server address typed in. One try per call, ~1s worst case.
        public static string Discover()
        {
            try
            {
                using (UdpClient udp = new UdpClient())
                {
                    udp.EnableBroadcast = true;
                    udp.Client.SendTimeout = 1000;
                    udp.Client.ReceiveTimeout = 1200;
                    byte[] probe = Encoding.ASCII.GetBytes(Hunt);
                    udp.Send(probe, probe.Length, new IPEndPoint(IPAddress.Broadcast, DiscoveryPort));

                    DateTime until = DateTime.Now.AddMilliseconds(1500);
                    while (DateTime.Now < until)
                    {
                        if (udp.Available <= 0)
                        {
                            System.Threading.Thread.Sleep(50);
                            continue;
                        }
                        IPEndPoint from = new IPEndPoint(IPAddress.Any, 0);
                        byte[] data = udp.Receive(ref from);
                        string answer = Encoding.ASCII.GetString(data, 0, data.Length);
                        if (!answer.StartsWith("JUANFI-CAFE-PANEL")) continue;
                        string[] parts = answer.Split(' ');
                        if (parts.Length < 2) continue;
                        if (parts[1].StartsWith("http://") || parts[1].StartsWith("https://")) return parts[1].TrimEnd('/');
                        // Bare host:port from an older panel - assume http.
                        return "http://" + parts[1].TrimEnd('/');
                    }
                }
            }
            catch (Exception err)
            {
                Log.Write("discovery failed: " + err.Message);
            }
            return "";
        }

        /// Confirm a hand-typed address really is a JuanFi panel before the agent
        /// starts locking a desktop against it.
        public static Reply Ping(string baseUrl)
        {
            return Send("GET", baseUrl.TrimEnd('/') + "/api/cafe/discover", null, null);
        }
    }
}

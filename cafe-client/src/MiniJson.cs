// A deliberately small JSON reader. The agent talks to one server it controls,
// so it needs objects, arrays, strings, numbers, booleans and null - nothing
// else - and it must not depend on a DLL that may or may not be on a shop PC.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace JuanFiCafe
{
    public static class MiniJson
    {
        public static Dictionary<string, object> ParseObject(string text)
        {
            if (string.IsNullOrEmpty(text)) return new Dictionary<string, object>();
            int index = 0;
            object value = ReadValue(text, ref index);
            Dictionary<string, object> table = value as Dictionary<string, object>;
            return table ?? new Dictionary<string, object>();
        }

        private static object ReadValue(string s, ref int i)
        {
            SkipBlank(s, ref i);
            if (i >= s.Length) return null;
            char c = s[i];
            if (c == '{') return ReadObj(s, ref i);
            if (c == '[') return ReadArr(s, ref i);
            if (c == '"') return ReadStr(s, ref i);
            if (c == 't' || c == 'f') return ReadBool(s, ref i);
            if (c == 'n') { i += 4; return null; }
            return ReadNum(s, ref i);
        }

        private static Dictionary<string, object> ReadObj(string s, ref int i)
        {
            Dictionary<string, object> map = new Dictionary<string, object>(StringComparer.Ordinal);
            i++;
            SkipBlank(s, ref i);
            if (i < s.Length && s[i] == '}') { i++; return map; }
            while (i < s.Length)
            {
                SkipBlank(s, ref i);
                string key = ReadStr(s, ref i);
                SkipBlank(s, ref i);
                if (i < s.Length && s[i] == ':') i++;
                map[key] = ReadValue(s, ref i);
                SkipBlank(s, ref i);
                if (i < s.Length && s[i] == ',') { i++; continue; }
                if (i < s.Length && s[i] == '}') i++;
                break;
            }
            return map;
        }

        private static List<object> ReadArr(string s, ref int i)
        {
            List<object> list = new List<object>();
            i++;
            SkipBlank(s, ref i);
            if (i < s.Length && s[i] == ']') { i++; return list; }
            while (i < s.Length)
            {
                list.Add(ReadValue(s, ref i));
                SkipBlank(s, ref i);
                if (i < s.Length && s[i] == ',') { i++; continue; }
                if (i < s.Length && s[i] == ']') i++;
                break;
            }
            return list;
        }

        private static string ReadStr(string s, ref int i)
        {
            StringBuilder sb = new StringBuilder();
            while (i < s.Length && s[i] != '"')
            {
                if (s[i] == '\\' && i + 1 < s.Length)
                {
                    i++;
                    switch (s[i])
                    {
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'u':
                            if (i + 4 < s.Length)
                            {
                                sb.Append((char)int.Parse(s.Substring(i + 1, 4), NumberStyles.HexNumber));
                                i += 4;
                            }
                            break;
                        default: sb.Append(s[i]); break;
                    }
                }
                else sb.Append(s[i]);
                i++;
            }
            if (i < s.Length) i++; // closing quote
            return sb.ToString();
        }

        private static object ReadBool(string s, ref int i)
        {
            if (s[i] == 't') { i += 4; return true; }
            i += 5;
            return false;
        }

        private static object ReadNum(string s, ref int i)
        {
            int start = i;
            while (i < s.Length && "+-.0123456789eE".IndexOf(s[i]) >= 0) i++;
            double d;
            string raw = s.Substring(start, i - start);
            if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return d;
            return 0d;
        }

        private static void SkipBlank(string s, ref int i)
        {
            while (i < s.Length && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++;
        }

        // ------------------------------------------------------------ reading

        public static string Str(Dictionary<string, object> map, string key, string fallback)
        {
            object v;
            if (map == null || !map.TryGetValue(key, out v) || v == null) return fallback;
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static int Int(Dictionary<string, object> map, string key, int fallback)
        {
            object v;
            if (map == null || !map.TryGetValue(key, out v) || v == null) return fallback;
            try { return Convert.ToInt32(v, CultureInfo.InvariantCulture); }
            catch { return fallback; }
        }

        public static bool Bool(Dictionary<string, object> map, string key, bool fallback)
        {
            object v;
            if (map == null || !map.TryGetValue(key, out v) || v == null) return fallback;
            if (v is bool) return (bool)v;
            string text = Convert.ToString(v, CultureInfo.InvariantCulture);
            if (text == "1" || text.Equals("true", StringComparison.OrdinalIgnoreCase)) return true;
            if (text == "0" || text.Equals("false", StringComparison.OrdinalIgnoreCase)) return false;
            return fallback;
        }

        // ------------------------------------------------------------ writing

        public static string Quote(string value)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append('"');
            foreach (char c in value ?? "")
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }
    }
}

using System;
using System.Collections;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Haolo.ChromeNativeHost
{
    internal sealed class HostConfig
    {
        public int protocolVersion { get; set; }
        public string pipeName { get; set; }
        public string token { get; set; }
        public string[] expectedOrigins { get; set; }
        public string desktopExecutable { get; set; }
    }

    internal static class Program
    {
        private const int ProtocolVersion = 1;
        private const int MaxMessageBytes = 1024 * 1024;
        private const string HostVersion = "0.1.0";
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxMessageBytes };
        private static readonly object ChromeWriteLock = new object();

        public static int Main(string[] args)
        {
            try
            {
                Console.InputEncoding = new UTF8Encoding(false);
                Console.OutputEncoding = new UTF8Encoding(false);
                return Run(args).GetAwaiter().GetResult();
            }
            catch (Exception error)
            {
                SafeWriteChrome(new Hashtable
                {
                    { "protocolVersion", ProtocolVersion },
                    { "type", "host.error" },
                    { "requestId", null },
                    { "payload", new Hashtable
                        {
                            { "code", "CHROME_NATIVE_HOST_FAILED" },
                            { "message", SafeMessage(error) }
                        }
                    }
                });
                Console.Error.WriteLine("[haolo-chrome-host] " + SafeMessage(error));
                return 1;
            }
        }

        private static async Task<int> Run(string[] args)
        {
            HostConfig config = ReadConfig();
            ValidateConfig(config);
            string origin = NormalizeOrigin(args != null && args.Length > 0 ? args[0] : "");
            if (!OriginAllowed(config.expectedOrigins, origin))
                throw new InvalidOperationException("The calling Chrome extension is not allowed.");

            NamedPipeClientStream pipe = await ConnectPipe(config).ConfigureAwait(false);
            try
            {
                var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 4096, true);
                var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true) { AutoFlush = true, NewLine = "\n" };
                string requestId = "host_" + Guid.NewGuid().ToString("N");
                await writer.WriteLineAsync(Json.Serialize(new Hashtable
                {
                    { "protocolVersion", ProtocolVersion },
                    { "type", "host.hello" },
                    { "requestId", requestId },
                    { "token", config.token },
                    { "origin", origin },
                    { "pid", Process.GetCurrentProcess().Id },
                    { "hostVersion", HostVersion }
                })).ConfigureAwait(false);

                string readyLine = await ReadLineWithTimeout(reader, 5000).ConfigureAwait(false);
                if (String.IsNullOrWhiteSpace(readyLine)) throw new IOException("Haolo Chrome broker did not complete the handshake.");
                IDictionary ready = Json.DeserializeObject(readyLine) as IDictionary;
                if (ready == null || Convert.ToString(ready["type"]) != "host.ready")
                    throw new IOException("Haolo Chrome broker rejected the handshake.");

                var cancellation = new CancellationTokenSource();
                Task chromeToPipe = PumpChromeToPipe(writer, cancellation.Token);
                Task pipeToChrome = PumpPipeToChrome(reader, cancellation.Token);
                Task completed = await Task.WhenAny(chromeToPipe, pipeToChrome).ConfigureAwait(false);
                cancellation.Cancel();
                try { await completed.ConfigureAwait(false); } catch (OperationCanceledException) { }
                return 0;
            }
            finally
            {
                pipe.Dispose();
            }
        }

        private static async Task PumpChromeToPipe(StreamWriter writer, CancellationToken cancellation)
        {
            Stream input = Console.OpenStandardInput();
            byte[] lengthBuffer = new byte[4];
            while (!cancellation.IsCancellationRequested)
            {
                int lengthBytes = await ReadExact(input, lengthBuffer, 0, 4, cancellation).ConfigureAwait(false);
                if (lengthBytes == 0) return;
                if (lengthBytes != 4) throw new EndOfStreamException("Chrome native message length was truncated.");
                int length = BitConverter.ToInt32(lengthBuffer, 0);
                if (length <= 0 || length > MaxMessageBytes) throw new InvalidDataException("Chrome native message size is invalid.");
                byte[] body = new byte[length];
                if (await ReadExact(input, body, 0, length, cancellation).ConfigureAwait(false) != length)
                    throw new EndOfStreamException("Chrome native message body was truncated.");
                string json = new UTF8Encoding(false, true).GetString(body);
                Json.DeserializeObject(json);
                await writer.WriteLineAsync(json).ConfigureAwait(false);
            }
        }

        private static async Task PumpPipeToChrome(StreamReader reader, CancellationToken cancellation)
        {
            while (!cancellation.IsCancellationRequested)
            {
                string line = await reader.ReadLineAsync().ConfigureAwait(false);
                if (line == null) return;
                if (Encoding.UTF8.GetByteCount(line) > MaxMessageBytes) throw new InvalidDataException("Haolo broker message is too large.");
                object value = Json.DeserializeObject(line);
                SafeWriteChrome(value);
            }
        }

        private static async Task<NamedPipeClientStream> ConnectPipe(HostConfig config)
        {
            Exception last = null;
            for (int attempt = 0; attempt < 12; attempt++)
            {
                var pipe = new NamedPipeClientStream(".", config.pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
                bool retry = false;
                try
                {
                    pipe.Connect(attempt == 0 ? 500 : 1000);
                    pipe.ReadMode = PipeTransmissionMode.Byte;
                    return pipe;
                }
                catch (Exception error)
                {
                    last = error;
                    pipe.Dispose();
                    if (attempt == 0) TryStartDesktop(config.desktopExecutable);
                    retry = true;
                }
                if (retry) await Task.Delay(400).ConfigureAwait(false);
            }
            throw new IOException("Unable to connect to the Haolo Chrome broker.", last);
        }

        private static void TryStartDesktop(string executable)
        {
            if (String.IsNullOrWhiteSpace(executable) || !File.Exists(executable)) return;
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = executable,
                    Arguments = "--from-chrome-extension",
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Normal
                });
            }
            catch { }
        }

        private static HostConfig ReadConfig()
        {
            string configuredPath = Environment.GetEnvironmentVariable("HAOLO_CHROME_HOST_CONFIG");
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string path = String.IsNullOrWhiteSpace(configuredPath)
                ? Path.Combine(appData, "haolo_desktop", "chrome-native-host.json")
                : Path.GetFullPath(configuredPath);
            if (!File.Exists(path)) throw new FileNotFoundException("Haolo Chrome host configuration is missing.", path);
            string text = File.ReadAllText(path, new UTF8Encoding(false, true));
            return Json.Deserialize<HostConfig>(text);
        }

        private static void ValidateConfig(HostConfig config)
        {
            if (config == null || config.protocolVersion != ProtocolVersion) throw new InvalidDataException("Haolo Chrome host configuration version is unsupported.");
            if (String.IsNullOrWhiteSpace(config.pipeName) || config.pipeName.Length > 200) throw new InvalidDataException("Haolo Chrome pipe name is invalid.");
            if (String.IsNullOrWhiteSpace(config.token) || config.token.Length < 32) throw new InvalidDataException("Haolo Chrome broker token is invalid.");
            if (config.expectedOrigins == null || config.expectedOrigins.Length == 0) throw new InvalidDataException("Haolo Chrome extension allowlist is empty.");
        }

        private static bool OriginAllowed(string[] allowed, string origin)
        {
            foreach (string candidate in allowed)
                if (String.Equals(NormalizeOrigin(candidate), origin, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private static string NormalizeOrigin(string value)
        {
            string origin = (value ?? "").Trim().TrimEnd('/') + "/";
            if (!origin.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase)) return "invalid/";
            return origin.ToLowerInvariant();
        }

        private static async Task<int> ReadExact(Stream stream, byte[] buffer, int offset, int count, CancellationToken cancellation)
        {
            int total = 0;
            while (total < count)
            {
                int read = await stream.ReadAsync(buffer, offset + total, count - total, cancellation).ConfigureAwait(false);
                if (read == 0) return total;
                total += read;
            }
            return total;
        }

        private static async Task<string> ReadLineWithTimeout(StreamReader reader, int timeoutMs)
        {
            Task<string> read = reader.ReadLineAsync();
            Task delay = Task.Delay(timeoutMs);
            if (await Task.WhenAny(read, delay).ConfigureAwait(false) != read) throw new TimeoutException("Haolo Chrome broker handshake timed out.");
            return await read.ConfigureAwait(false);
        }

        private static void SafeWriteChrome(object value)
        {
            try
            {
                byte[] body = Encoding.UTF8.GetBytes(Json.Serialize(value));
                if (body.Length > MaxMessageBytes) throw new InvalidDataException("Native message is too large.");
                byte[] length = BitConverter.GetBytes(body.Length);
                lock (ChromeWriteLock)
                {
                    Stream output = Console.OpenStandardOutput();
                    output.Write(length, 0, length.Length);
                    output.Write(body, 0, body.Length);
                    output.Flush();
                }
            }
            catch { }
        }

        private static string SafeMessage(Exception error)
        {
            string message = error == null ? "Chrome Native Host failed." : error.Message;
            if (message == null) return "Chrome Native Host failed.";
            return message.Length <= 1000 ? message : message.Substring(0, 1000);
        }
    }
}

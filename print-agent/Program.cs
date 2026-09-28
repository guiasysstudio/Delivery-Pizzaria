using System.Drawing;
using System.Drawing.Printing;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace DeliveryPizzaria.PrintAgent;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayContext());
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private const string StartupValueName = "DeliveryPizzariaPrintAgent";
    private readonly NotifyIcon _tray;
    private readonly LocalPrintServer _server;
    private readonly ToolStripMenuItem _startupItem;

    public TrayContext()
    {
        _server = new LocalPrintServer();
        _server.Start();

        _startupItem = new ToolStripMenuItem("Iniciar com o Windows")
        {
            Checked = IsStartupEnabled(),
            CheckOnClick = true
        };
        _startupItem.CheckedChanged += (_, _) => SetStartup(_startupItem.Checked);

        var menu = new ContextMenuStrip();
        menu.Items.Add("Status", null, (_, _) =>
        {
            MessageBox.Show(
                "Delivery Pizzaria Print Agent está ativo.\n\n" +
                "Endereço local: http://127.0.0.1:17329\n" +
                "O painel administrativo pode listar e usar as impressoras instaladas no Windows.",
                "Delivery Pizzaria Print Agent",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        });
        menu.Items.Add(_startupItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Sair", null, (_, _) => ExitThread());

        _tray = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "Delivery Pizzaria Print Agent",
            Visible = true,
            ContextMenuStrip = menu
        };

        _tray.ShowBalloonTip(
            2000,
            "Print Agent ativo",
            "O painel da pizzaria já pode usar as impressoras deste computador.",
            ToolTipIcon.Info);
    }

    protected override void ExitThreadCore()
    {
        _server.Dispose();
        _tray.Visible = false;
        _tray.Dispose();
        base.ExitThreadCore();
    }

    private static bool IsStartupEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        return key?.GetValue(StartupValueName) is string;
    }

    private static void SetStartup(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        if (enabled)
        {
            key.SetValue(StartupValueName, $"\"{Application.ExecutablePath}\"");
        }
        else
        {
            key.DeleteValue(StartupValueName, false);
        }
    }
}

internal sealed class LocalPrintServer : IDisposable
{
    private readonly HttpListener _listener = new();
    private readonly CancellationTokenSource _cts = new();
    private readonly object _printLock = new();
    private Task? _loopTask;

    public LocalPrintServer()
    {
        _listener.Prefixes.Add("http://127.0.0.1:17329/");
    }

    public void Start()
    {
        _listener.Start();
        _loopTask = Task.Run(ListenLoopAsync);
    }

    private async Task ListenLoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                var context = await _listener.GetContextAsync();
                _ = Task.Run(() => HandleAsync(context), _cts.Token);
            }
            catch (HttpListenerException) when (_cts.IsCancellationRequested)
            {
                break;
            }
            catch (ObjectDisposedException)
            {
                break;
            }
            catch
            {
                await Task.Delay(250);
            }
        }
    }

    private static bool IsAllowedOrigin(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin)) return true;

        return origin.Equals("https://guiasysstudio.github.io", StringComparison.OrdinalIgnoreCase)
            || origin.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase)
            || origin.StartsWith("http://127.0.0.1", StringComparison.OrdinalIgnoreCase);
    }

    private static void AddCors(HttpListenerContext context)
    {
        var origin = context.Request.Headers["Origin"];
        if (!string.IsNullOrWhiteSpace(origin) && IsAllowedOrigin(origin))
        {
            context.Response.Headers["Access-Control-Allow-Origin"] = origin;
            context.Response.Headers["Vary"] = "Origin";
        }

        context.Response.Headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
        context.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
        context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
        context.Response.Headers["Cache-Control"] = "no-store";
    }

    private async Task HandleAsync(HttpListenerContext context)
    {
        try
        {
            AddCors(context);

            var origin = context.Request.Headers["Origin"];
            if (!IsAllowedOrigin(origin))
            {
                await WriteJson(context, 403, new { error = "origin_not_allowed" });
                return;
            }

            if (context.Request.HttpMethod.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = 204;
                context.Response.Close();
                return;
            }

            var path = context.Request.Url?.AbsolutePath?.TrimEnd('/') ?? "";

            if (context.Request.HttpMethod == "GET" && (path == "" || path == "/health"))
            {
                await WriteJson(context, 200, new
                {
                    ok = true,
                    name = "Delivery Pizzaria Print Agent",
                    version = "1.0.0"
                });
                return;
            }

            if (context.Request.HttpMethod == "GET" && path == "/printers")
            {
                var printers = PrinterSettings.InstalledPrinters.Cast<string>()
                    .OrderBy(x => x, StringComparer.CurrentCultureIgnoreCase)
                    .ToArray();

                await WriteJson(context, 200, new { printers });
                return;
            }

            if (context.Request.HttpMethod == "POST" && path == "/print")
            {
                using var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding);
                var body = await reader.ReadToEndAsync();
                var request = JsonSerializer.Deserialize<PrintRequest>(
                    body,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                if (request is null ||
                    string.IsNullOrWhiteSpace(request.Printer) ||
                    string.IsNullOrWhiteSpace(request.Text))
                {
                    await WriteJson(context, 400, new { error = "invalid_request" });
                    return;
                }

                var installed = PrinterSettings.InstalledPrinters.Cast<string>()
                    .Any(p => string.Equals(p, request.Printer, StringComparison.CurrentCultureIgnoreCase));

                if (!installed)
                {
                    await WriteJson(context, 404, new { error = "printer_not_found" });
                    return;
                }

                try
                {
                    lock (_printLock)
                    {
                        PrintText(
                            request.Printer,
                            request.Text,
                            Math.Clamp(request.Copies <= 0 ? 1 : request.Copies, 1, 5));
                    }

                    await WriteJson(context, 200, new { ok = true });
                }
                catch (Exception ex)
                {
                    await WriteJson(context, 500, new { error = "print_failed", message = ex.Message });
                }

                return;
            }

            await WriteJson(context, 404, new { error = "not_found" });
        }
        catch
        {
            try
            {
                context.Response.StatusCode = 500;
                context.Response.Close();
            }
            catch
            {
                // ignored
            }
        }
    }

    private static void PrintText(string printerName, string text, int copies)
    {
        for (var copy = 0; copy < copies; copy++)
        {
            using var document = new PrintDocument();
            document.PrinterSettings.PrinterName = printerName;
            document.PrintController = new StandardPrintController();
            document.DocumentName = "Comanda Delivery Pizzaria";
            document.DefaultPageSettings.Margins = new Margins(8, 8, 8, 8);

            var lines = NormalizeLines(text).ToList();
            var lineIndex = 0;

            document.PrintPage += (_, e) =>
            {
                using var font = new Font("Consolas", 8.5f, FontStyle.Regular, GraphicsUnit.Point);
                using var bold = new Font("Consolas", 8.5f, FontStyle.Bold, GraphicsUnit.Point);

                var graphics = e.Graphics ?? throw new InvalidOperationException("Contexto de impressão indisponível.");
                float y = e.MarginBounds.Top;
                var lineHeight = font.GetHeight(graphics) + 1;
                var maxWidth = e.MarginBounds.Width;

                while (lineIndex < lines.Count)
                {
                    var line = lines[lineIndex];
                    var currentFont = IsStrongLine(line) ? bold : font;
                    var wrapped = WrapLine(graphics, line, currentFont, maxWidth).ToList();

                    foreach (var part in wrapped)
                    {
                        if (y + lineHeight > e.MarginBounds.Bottom)
                        {
                            e.HasMorePages = true;
                            return;
                        }

                        graphics.DrawString(part, currentFont, Brushes.Black, e.MarginBounds.Left, y);
                        y += lineHeight;
                    }

                    lineIndex++;
                }

                e.HasMorePages = false;
            };

            document.Print();
        }
    }

    private static IEnumerable<string> NormalizeLines(string text)
    {
        return text
            .Replace("\r\n", "\n")
            .Replace('\r', '\n')
            .Split('\n');
    }

    private static bool IsStrongLine(string line)
    {
        var upper = line.Trim().ToUpperInvariant();
        return upper.StartsWith("PEDIDO #")
            || upper.StartsWith("TOTAL:")
            || upper.StartsWith("PAGAMENTO:")
            || upper.StartsWith("TROCO PARA:")
            || upper.StartsWith("LEVAR TROCO:");
    }

    private static IEnumerable<string> WrapLine(Graphics graphics, string line, Font font, float maxWidth)
    {
        if (string.IsNullOrEmpty(line))
        {
            yield return "";
            yield break;
        }

        var remaining = line;

        while (remaining.Length > 0)
        {
            if (graphics.MeasureString(remaining, font).Width <= maxWidth)
            {
                yield return remaining;
                yield break;
            }

            var split = remaining.Length;

            while (split > 1 && graphics.MeasureString(remaining[..split], font).Width > maxWidth)
            {
                split--;
            }

            var breakAt = remaining.LastIndexOf(' ', Math.Max(0, split - 1), split);
            if (breakAt > 0) split = breakAt;

            yield return remaining[..split].TrimEnd();
            remaining = remaining[split..].TrimStart();
        }
    }

    private static async Task WriteJson(HttpListenerContext context, int status, object payload)
    {
        var json = JsonSerializer.Serialize(payload);
        var bytes = Encoding.UTF8.GetBytes(json);

        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.ContentLength64 = bytes.Length;
        await context.Response.OutputStream.WriteAsync(bytes);
        context.Response.Close();
    }

    public void Dispose()
    {
        _cts.Cancel();

        if (_listener.IsListening)
        {
            _listener.Stop();
        }

        _listener.Close();
        _cts.Dispose();
    }

    private sealed record PrintRequest(string Printer, string Text, int Copies);
}

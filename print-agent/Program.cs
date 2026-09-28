using System.Drawing;
using System.Drawing.Printing;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
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
    private readonly CancellationTokenSource _cts = new();
    private readonly object _printLock = new();
    private WebApplication? _app;
    private Task? _runTask;

    public void Start()
    {
        var builder = WebApplication.CreateSlimBuilder();

        builder.WebHost.UseUrls("http://127.0.0.1:17329");

        _app = builder.Build();

        _app.Use(async (context, next) =>
        {
            var origin = context.Request.Headers.Origin.ToString();

            if (!IsAllowedOrigin(origin))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new { error = "origin_not_allowed" });
                return;
            }

            if (!string.IsNullOrWhiteSpace(origin))
            {
                context.Response.Headers.AccessControlAllowOrigin = origin;
                context.Response.Headers.Vary = "Origin";
            }

            context.Response.Headers.AccessControlAllowMethods = "GET,POST,OPTIONS";
            context.Response.Headers.AccessControlAllowHeaders = "Content-Type";
            context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
            context.Response.Headers.CacheControl = "no-store";

            if (HttpMethods.IsOptions(context.Request.Method))
            {
                context.Response.StatusCode = StatusCodes.Status204NoContent;
                return;
            }

            await next();
        });

        _app.MapGet("/", () => Results.Json(new
        {
            ok = true,
            name = "Delivery Pizzaria Print Agent",
            version = "1.1.0"
        }));

        _app.MapGet("/health", () => Results.Json(new
        {
            ok = true,
            name = "Delivery Pizzaria Print Agent",
            version = "1.1.0"
        }));

        _app.MapGet("/printers", () =>
        {
            var printers = PrinterSettings.InstalledPrinters.Cast<string>()
                .OrderBy(x => x, StringComparer.CurrentCultureIgnoreCase)
                .ToArray();

            return Results.Json(new { printers });
        });

        _app.MapPost("/print", async (HttpContext context) =>
        {
            PrintRequest? request;

            try
            {
                request = await context.Request.ReadFromJsonAsync<PrintRequest>(
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true },
                    cancellationToken: context.RequestAborted);
            }
            catch
            {
                return Results.BadRequest(new { error = "invalid_json" });
            }

            if (request is null ||
                string.IsNullOrWhiteSpace(request.Printer) ||
                string.IsNullOrWhiteSpace(request.Text))
            {
                return Results.BadRequest(new { error = "invalid_request" });
            }

            var installed = PrinterSettings.InstalledPrinters.Cast<string>()
                .Any(p => string.Equals(p, request.Printer, StringComparison.CurrentCultureIgnoreCase));

            if (!installed)
            {
                return Results.NotFound(new { error = "printer_not_found" });
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

                return Results.Ok(new { ok = true });
            }
            catch (Exception ex)
            {
                return Results.Json(
                    new { error = "print_failed", message = ex.Message },
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        });

        _runTask = _app.RunAsync(_cts.Token);
    }

    private static bool IsAllowedOrigin(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin)) return true;

        if (origin.Equals("https://guiasysstudio.github.io", StringComparison.OrdinalIgnoreCase))
            return true;

        if (origin.Equals("https://guiasys.online", StringComparison.OrdinalIgnoreCase))
            return true;

        if (origin.EndsWith(".guiasys.online", StringComparison.OrdinalIgnoreCase))
            return true;

        if (origin.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase))
            return true;

        if (origin.StartsWith("http://127.0.0.1", StringComparison.OrdinalIgnoreCase))
            return true;

        return false;
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

            if (breakAt > 0)
            {
                split = breakAt;
            }

            yield return remaining[..split].TrimEnd();
            remaining = remaining[split..].TrimStart();
        }
    }

    public void Dispose()
    {
        _cts.Cancel();

        if (_app is not null)
        {
            try
            {
                _app.StopAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult();
            }
            catch
            {
                // ignored during shutdown
            }

            _app.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }

        _cts.Dispose();
    }

    private sealed record PrintRequest(string Printer, string Text, int Copies);
}

using System.Drawing;
using System.Drawing.Printing;
using System.Text.Json;
using System.Runtime.InteropServices;
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

internal static class BrandIconFactory
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    public static Icon Create()
    {
        using var bitmap = new Bitmap(64, 64);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);

            using var red = new SolidBrush(Color.FromArgb(185, 28, 28));
            using var cheese = new SolidBrush(Color.FromArgb(251, 191, 36));
            using var crust = new Pen(Color.FromArgb(180, 83, 9), 5);
            using var pepperoni = new SolidBrush(Color.FromArgb(153, 27, 27));

            g.FillEllipse(red, 2, 2, 60, 60);
            var pizza = new PointF[] { new(32, 10), new(53, 47), new(11, 47) };
            g.FillPolygon(cheese, pizza);
            g.DrawLine(crust, 12, 47, 52, 47);
            g.FillEllipse(pepperoni, 25, 25, 8, 8);
            g.FillEllipse(pepperoni, 36, 35, 7, 7);
            g.FillEllipse(pepperoni, 20, 37, 7, 7);
        }

        var handle = bitmap.GetHicon();
        try
        {
            using var temp = Icon.FromHandle(handle);
            return (Icon)temp.Clone();
        }
        finally
        {
            DestroyIcon(handle);
        }
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private const string StartupValueName = "DeliveryPizzariaPrintAgent";
    private const string AppRegistryPath = @"Software\DeliveryPizzaria\PrintAgent";
    private const string SelectedPrinterValueName = "SelectedPrinter";
    private readonly NotifyIcon _tray;
    private readonly LocalPrintServer _server;
    private readonly ToolStripMenuItem _startupItem;
    private AgentSettingsForm? _settingsForm;

    public TrayContext()
    {
        EnsureFirstRunStartup();
        EnsureSelectedPrinter();

        _server = new LocalPrintServer(GetSelectedPrinter);
        _server.Start();

        _startupItem = new ToolStripMenuItem("Iniciar com o Windows")
        {
            Checked = IsStartupEnabled(),
            CheckOnClick = true
        };
        _startupItem.CheckedChanged += (_, _) =>
        {
            SetStartup(_startupItem.Checked);
            _settingsForm?.SyncStartupState(_startupItem.Checked);
        };

        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir configurações", null, (_, _) => ShowSettings());
        menu.Items.Add("Status", null, (_, _) => ShowStatus());
        menu.Items.Add(_startupItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Sair", null, (_, _) => ExitThread());

        _tray = new NotifyIcon
        {
            Icon = BrandIconFactory.Create(),
            Text = "Delivery Pizzaria Print Agent",
            Visible = true,
            ContextMenuStrip = menu
        };

        _tray.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left)
            {
                ShowSettings();
            }
        };
        _tray.DoubleClick += (_, _) => ShowSettings();

        _tray.ShowBalloonTip(
            2500,
            "Print Agent ativo",
            "Clique no ícone para configurar impressoras e inicialização com o Windows.",
            ToolTipIcon.Info);
    }

    private void ShowSettings()
    {
        if (_settingsForm is null || _settingsForm.IsDisposed)
        {
            _settingsForm = new AgentSettingsForm(
                IsStartupEnabled,
                enabled =>
                {
                    SetStartup(enabled);
                    _startupItem.Checked = enabled;
                },
                GetSelectedPrinter,
                SetSelectedPrinter);
            _settingsForm.FormClosed += (_, _) => _settingsForm = null;
        }

        if (!_settingsForm.Visible)
            _settingsForm.Show();

        if (_settingsForm.WindowState == FormWindowState.Minimized)
            _settingsForm.WindowState = FormWindowState.Normal;

        _settingsForm.RefreshPrinters();
        _settingsForm.BringToFront();
        _settingsForm.Activate();
    }

    private static void ShowStatus()
    {
        MessageBox.Show(
            "Delivery Pizzaria Print Agent está ativo.\n\n" +
            "Endereço local: http://127.0.0.1:17329\n" +
            "Impressora selecionada: " + (GetSelectedPrinter() ?? "nenhuma") + "\n\n" +
            "A impressora física é escolhida e salva no próprio Print Agent.",
            "Delivery Pizzaria Print Agent",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
    }

    protected override void ExitThreadCore()
    {
        _settingsForm?.Close();
        _server.Dispose();
        _tray.Visible = false;
        _tray.Dispose();
        base.ExitThreadCore();
    }

    private static void EnsureFirstRunStartup()
    {
        using var appKey = Registry.CurrentUser.CreateSubKey(AppRegistryPath);
        var configured = appKey.GetValue("StartupConfigured") is int value && value == 1;

        if (!configured)
        {
            SetStartup(true);
            appKey.SetValue("StartupConfigured", 1, RegistryValueKind.DWord);
        }
        else if (IsStartupEnabled())
        {
            // Regrava o caminho caso o executável tenha sido atualizado/movido.
            SetStartup(true);
        }
    }

    private static bool IsStartupEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        return key?.GetValue(StartupValueName) is string;
    }

    private static string? GetSelectedPrinter()
    {
        using var key = Registry.CurrentUser.OpenSubKey(AppRegistryPath);
        return key?.GetValue(SelectedPrinterValueName) as string;
    }

    private static void SetSelectedPrinter(string? printerName)
    {
        using var key = Registry.CurrentUser.CreateSubKey(AppRegistryPath);

        if (string.IsNullOrWhiteSpace(printerName))
            key.DeleteValue(SelectedPrinterValueName, false);
        else
            key.SetValue(SelectedPrinterValueName, printerName.Trim());
    }

    private static void EnsureSelectedPrinter()
    {
        var printers = PrinterSettings.InstalledPrinters.Cast<string>().ToArray();
        var selected = GetSelectedPrinter();

        if (!string.IsNullOrWhiteSpace(selected) &&
            printers.Any(p => string.Equals(p, selected, StringComparison.CurrentCultureIgnoreCase)))
            return;

        var windowsDefault = new PrinterSettings().PrinterName;
        var fallback = printers.FirstOrDefault(p =>
            string.Equals(p, windowsDefault, StringComparison.CurrentCultureIgnoreCase))
            ?? printers.FirstOrDefault();

        SetSelectedPrinter(fallback);
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

internal sealed class AgentSettingsForm : Form
{
    private readonly Func<bool> _getStartup;
    private readonly Action<bool> _setStartup;
    private readonly Func<string?> _getSelectedPrinter;
    private readonly Action<string?> _setSelectedPrinter;
    private readonly CheckBox _startupCheck;
    private readonly ComboBox _printers;
    private readonly Label _statusLabel;
    private bool _refreshingPrinters;

    public AgentSettingsForm(
        Func<bool> getStartup,
        Action<bool> setStartup,
        Func<string?> getSelectedPrinter,
        Action<string?> setSelectedPrinter)
    {
        _getStartup = getStartup;
        _setStartup = setStartup;
        _getSelectedPrinter = getSelectedPrinter;
        _setSelectedPrinter = setSelectedPrinter;

        Text = "Delivery Pizzaria • Print Agent";
        Icon = BrandIconFactory.Create();
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        Width = 520;
        Height = 410;
        BackColor = Color.White;
        Font = new Font("Segoe UI", 9F);

        var title = new Label
        {
            Text = "🍕  Delivery Pizzaria Print Agent",
            Font = new Font("Segoe UI", 16F, FontStyle.Bold),
            AutoSize = true,
            Left = 22,
            Top = 22
        };

        var subtitle = new Label
        {
            Text = "Conecta o painel web às impressoras instaladas neste Windows.",
            ForeColor = Color.DimGray,
            AutoSize = true,
            Left = 24,
            Top = 62
        };

        _statusLabel = new Label
        {
            Text = "● Serviço local ativo em 127.0.0.1:17329",
            ForeColor = Color.ForestGreen,
            AutoSize = true,
            Left = 24,
            Top = 96
        };

        var printerLabel = new Label
        {
            Text = "Impressoras detectadas",
            Font = new Font("Segoe UI", 9F, FontStyle.Bold),
            AutoSize = true,
            Left = 24,
            Top = 137
        };

        _printers = new ComboBox
        {
            Left = 24,
            Top = 160,
            Width = 455,
            DropDownStyle = ComboBoxStyle.DropDownList
        };
        _printers.SelectedIndexChanged += (_, _) =>
        {
            if (_refreshingPrinters) return;
            _setSelectedPrinter(_printers.SelectedItem?.ToString());
            UpdatePrinterStatus();
        };

        var refresh = new Button
        {
            Text = "Atualizar impressoras",
            Left = 24,
            Top = 202,
            Width = 150,
            Height = 34
        };
        refresh.Click += (_, _) => RefreshPrinters();

        _startupCheck = new CheckBox
        {
            Text = "Iniciar automaticamente com o Windows",
            Checked = _getStartup(),
            AutoSize = true,
            Left = 24,
            Top = 258
        };
        _startupCheck.CheckedChanged += (_, _) => _setStartup(_startupCheck.Checked);

        var adminButton = new Button
        {
            Text = "Abrir painel da pizzaria",
            Left = 24,
            Top = 302,
            Width = 180,
            Height = 36
        };
        adminButton.Click += (_, _) =>
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = "https://guiasysstudio.github.io/Delivery-Pizzaria/admin/",
                UseShellExecute = true
            });
        };

        var closeButton = new Button
        {
            Text = "Fechar",
            Left = 379,
            Top = 302,
            Width = 100,
            Height = 36
        };
        closeButton.Click += (_, _) => Hide();

        Controls.AddRange([
            title, subtitle, _statusLabel, printerLabel, _printers,
            refresh, _startupCheck, adminButton, closeButton
        ]);

        FormClosing += (_, e) =>
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
            }
        };

        RefreshPrinters();
    }

    public void SyncStartupState(bool enabled)
    {
        if (_startupCheck.Checked != enabled)
            _startupCheck.Checked = enabled;
    }

    public void RefreshPrinters()
    {
        var selected = _printers.SelectedItem?.ToString() ?? _getSelectedPrinter();
        var printers = PrinterSettings.InstalledPrinters.Cast<string>()
            .OrderBy(x => x, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();

        _refreshingPrinters = true;
        try
        {
            _printers.Items.Clear();
            _printers.Items.AddRange(printers);

            if (printers.Length == 0)
            {
                _setSelectedPrinter(null);
                UpdatePrinterStatus();
                return;
            }

            var preferred = printers.FirstOrDefault(p =>
                string.Equals(p, selected, StringComparison.CurrentCultureIgnoreCase))
                ?? printers.FirstOrDefault(p =>
                    string.Equals(p, new PrinterSettings().PrinterName, StringComparison.CurrentCultureIgnoreCase))
                ?? printers[0];

            _printers.SelectedItem = preferred;
            _setSelectedPrinter(preferred);
            UpdatePrinterStatus();
        }
        finally
        {
            _refreshingPrinters = false;
        }
    }

    private void UpdatePrinterStatus()
    {
        var selected = _printers.SelectedItem?.ToString() ?? _getSelectedPrinter();
        if (string.IsNullOrWhiteSpace(selected))
        {
            _statusLabel.Text = "● Serviço ativo • nenhuma impressora instalada foi encontrada";
            _statusLabel.ForeColor = Color.DarkOrange;
            return;
        }

        _statusLabel.Text = "● Serviço ativo • impressora selecionada: " + selected;
        _statusLabel.ForeColor = Color.ForestGreen;
    }
}

internal sealed class LocalPrintServer : IDisposable
{
    private readonly CancellationTokenSource _cts = new();
    private readonly object _printLock = new();
    private readonly Func<string?> _getSelectedPrinter;
    private WebApplication? _app;
    private Task? _runTask;

    public LocalPrintServer(Func<string?> getSelectedPrinter)
    {
        _getSelectedPrinter = getSelectedPrinter;
    }

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
            version = "1.3.0"
        }));

        _app.MapGet("/health", () => Results.Json(new
        {
            ok = true,
            name = "Delivery Pizzaria Print Agent",
            version = "1.3.0"
        }));

        _app.MapGet("/printers", () =>
        {
            var printers = PrinterSettings.InstalledPrinters.Cast<string>()
                .OrderBy(x => x, StringComparer.CurrentCultureIgnoreCase)
                .ToArray();

            return Results.Json(new
            {
                printers,
                selectedPrinter = _getSelectedPrinter(),
                version = "1.3.0"
            });
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

            if (request is null || string.IsNullOrWhiteSpace(request.Text))
            {
                return Results.BadRequest(new { error = "invalid_request" });
            }

            // A impressora física é sempre definida pelo próprio Agent.
            // O painel web controla somente o modelo/conteúdo da comanda.
            var printerName = _getSelectedPrinter();
            if (string.IsNullOrWhiteSpace(printerName))
            {
                return Results.BadRequest(new { error = "printer_not_configured" });
            }

            var installed = PrinterSettings.InstalledPrinters.Cast<string>()
                .Any(p => string.Equals(p, printerName, StringComparison.CurrentCultureIgnoreCase));

            if (!installed)
            {
                return Results.NotFound(new { error = "printer_not_found" });
            }

            try
            {
                lock (_printLock)
                {
                    PrintText(
                        printerName,
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

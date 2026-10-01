using System.Drawing;
using System.Drawing.Printing;
using System.Text.Json;
using System.Runtime.InteropServices;
using System.Diagnostics;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Win32;

namespace DeliveryPizzaria.PrintAgent;

internal static class Program
{
    private const string InstanceMutexName = @"Local\DeliveryPizzaria.PrintAgent";
    private const string OpenEventName = @"Local\DeliveryPizzaria.PrintAgent.Open";

    [STAThread]
    private static void Main(string[] args)
    {
        // Se o executável veio da Internet, remove a marca Zone.Identifier
        // após a primeira autorização do usuário. O instalador também executa
        // esta proteção antes de iniciar o Agent.
        AttachmentSecurity.TryUnblockCurrentExecutable();

        var background = args.Any(arg =>
            string.Equals(arg, "--background", StringComparison.OrdinalIgnoreCase));

        using var mutex = new Mutex(true, InstanceMutexName, out var createdNew);
        if (!createdNew)
        {
            // O atalho da Área de Trabalho/Start Menu deve abrir a janela mesmo
            // quando o Agent já estiver ativo na bandeja.
            if (!background)
            {
                try
                {
                    using var existingEvent = EventWaitHandle.OpenExisting(OpenEventName);
                    existingEvent.Set();
                }
                catch
                {
                    // A instância existente pode estar encerrando. O atalho não
                    // deve exibir uma segunda janela de erro neste caso.
                }
            }
            return;
        }

        using var openEvent = new EventWaitHandle(
            false,
            EventResetMode.AutoReset,
            OpenEventName);

        ApplicationConfiguration.Initialize();

        try
        {
            Application.Run(new TrayContext(openEvent, showSettingsOnStart: !background));
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Não foi possível iniciar o Delivery Pizzaria Print Agent.\n\n" +
                ex.Message + "\n\n" +
                "Feche qualquer programa que esteja usando a porta 17329 e tente novamente.",
                "Print Agent",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }

        GC.KeepAlive(openEvent);
        GC.KeepAlive(mutex);
    }
}

internal static class AgentInfo
{
    public const string Version = "1.8.0";
}

internal static class AttachmentSecurity
{
    public static void TryUnblockCurrentExecutable()
    {
        try
        {
            var executablePath = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(executablePath))
                return;

            // O stream alternativo Zone.Identifier é o Mark-of-the-Web do NTFS.
            // File.Delete não faz nada se o stream não existir.
            File.Delete(executablePath + ":Zone.Identifier");
        }
        catch
        {
            // Segurança complementar: o instalador também executa Unblock-File.
            // Uma falha aqui não deve impedir o Agent de iniciar.
        }
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
    private const string UninstallRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\DeliveryPizzariaPrintAgent";
    private const string SelectedPrinterValueName = "SelectedPrinter";
    private readonly NotifyIcon _tray;
    private readonly LocalPrintServer _server;
    private readonly ToolStripMenuItem _startupItem;
    private readonly Control _dispatcher;
    private readonly RegisteredWaitHandle _openRequestWait;
    private AgentSettingsForm? _settingsForm;
    private System.Threading.Timer? _forcedExitTimer;
    private bool _exiting;

    public TrayContext(EventWaitHandle openEvent, bool showSettingsOnStart)
    {
        EnsureFirstRunStartup();
        EnsureInstallationRegistration();
        EnsureSelectedPrinter();

        _server = new LocalPrintServer(GetSelectedPrinter, SetSelectedPrinter);
        try
        {
            _server.Start();
        }
        catch (Exception ex)
        {
            _server.Dispose();
            throw new InvalidOperationException(
                "O serviço local não conseguiu abrir http://127.0.0.1:17329. A porta pode estar ocupada por outro programa.",
                ex);
        }

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
        menu.Items.Add("Imprimir teste", null, (_, _) => PrintTest());
        menu.Items.Add(_startupItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Sair do Print Agent", null, (_, _) => RequestExit());
        menu.Items.Add("Desinstalar Print Agent", null, (_, _) => RequestUninstall());

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

        _dispatcher = new Control();
        _dispatcher.CreateControl();
        _openRequestWait = ThreadPool.RegisterWaitForSingleObject(
            openEvent,
            (_, _) =>
            {
                if (_exiting || _dispatcher.IsDisposed)
                    return;

                try
                {
                    _dispatcher.BeginInvoke(ShowSettings);
                }
                catch
                {
                    // O Agent pode estar fechando enquanto o atalho é acionado.
                }
            },
            null,
            Timeout.Infinite,
            executeOnlyOnce: false);

        _tray.ShowBalloonTip(
            2500,
            "Print Agent ativo",
            "Clique no ícone ou use o atalho da Área de Trabalho para abrir as configurações.",
            ToolTipIcon.Info);

        if (showSettingsOnStart)
            ShowSettings();
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
                SetSelectedPrinter,
                PrintTest,
                RequestExit,
                RequestUninstall);
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
            "Versão: " + AgentInfo.Version + "\n" +
            "Endereço local: http://127.0.0.1:17329\n" +
            "Impressora selecionada: " + (GetSelectedPrinter() ?? "nenhuma") + "\n\n" +
            "A impressora física é escolhida e salva no próprio Print Agent.",
            "Delivery Pizzaria Print Agent",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
    }

    private void RequestExit()
    {
        if (_exiting)
            return;

        var result = MessageBox.Show(
            "Deseja encerrar o Print Agent?\n\nEnquanto ele estiver fechado, a Central Delivery não conseguirá imprimir automaticamente neste computador.",
            "Sair do Print Agent",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question,
            MessageBoxDefaultButton.Button2);

        if (result != DialogResult.Yes)
            return;

        BeginExit();
    }

    private void BeginExit()
    {
        if (_exiting)
            return;

        _exiting = true;

        // O servidor HTTP local normalmente encerra quase instantaneamente.
        // Este fallback evita que um driver/host travado deixe o processo preso
        // depois que o usuário escolheu explicitamente "Sair do Agent".
        _forcedExitTimer = new System.Threading.Timer(
            _ => Environment.Exit(0),
            null,
            TimeSpan.FromSeconds(4),
            Timeout.InfiniteTimeSpan);

        _settingsForm?.CloseForApplicationExit();
        ExitThread();
    }

    private void RequestUninstall()
    {
        if (_exiting)
            return;

        var result = MessageBox.Show(
            "Deseja desinstalar o Delivery Pizzaria Print Agent deste computador?\n\n" +
            "Isso removerá o Agent, o atalho da Área de Trabalho, o atalho do menu Iniciar " +
            "e a inicialização automática com o Windows.",
            "Desinstalar Print Agent",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning,
            MessageBoxDefaultButton.Button2);

        if (result != DialogResult.Yes)
            return;

        try
        {
            SetStartup(false);

            // Instalações 1.8+ usam Inno Setup. O desinstalador fica ao lado do
            // executável e não depende mais de .bat/.cmd.
            var innoUninstaller = Directory
                .EnumerateFiles(AppContext.BaseDirectory, "unins*.exe")
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault();

            if (!string.IsNullOrWhiteSpace(innoUninstaller) && File.Exists(innoUninstaller))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = innoUninstaller,
                    Arguments = "/SILENT /SUPPRESSMSGBOXES /NORESTART",
                    WorkingDirectory = AppContext.BaseDirectory,
                    UseShellExecute = true
                });

                BeginExit();
                return;
            }

            // Compatibilidade apenas para quem atualizou a partir da 1.7:
            // pacotes antigos possuíam Desinstalar.cmd.
            var legacyUninstaller = Path.Combine(AppContext.BaseDirectory, "Desinstalar.cmd");
            if (File.Exists(legacyUninstaller))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = $"/d /c \"\"{legacyUninstaller}\" /SILENT\"",
                    WorkingDirectory = AppContext.BaseDirectory,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                });

                BeginExit();
                return;
            }

            MessageBox.Show(
                "O desinstalador não foi encontrado. Abra Configurações do Windows → Aplicativos instalados " +
                "e remova “Delivery Pizzaria Print Agent”.",
                "Print Agent",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Não foi possível iniciar a desinstalação.\n\n" + ex.Message,
                "Print Agent",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static void PrintTest()
    {
        var printerName = GetSelectedPrinter();
        if (string.IsNullOrWhiteSpace(printerName))
        {
            MessageBox.Show(
                "Nenhuma impressora está selecionada. Escolha uma impressora nas configurações do Print Agent.",
                "Imprimir teste",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return;
        }

        try
        {
            using var document = new PrintDocument();
            document.PrinterSettings.PrinterName = printerName;
            document.PrintController = new StandardPrintController();
            document.DocumentName = "Teste Delivery Pizzaria Print Agent";
            document.PrintPage += (_, e) =>
            {
                using var titleFont = new Font("Segoe UI", 14F, FontStyle.Bold);
                using var bodyFont = new Font("Segoe UI", 9F, FontStyle.Regular);

                var graphics = e.Graphics ?? throw new InvalidOperationException("Contexto de impressão indisponível.");
                float x = e.MarginBounds.Left;
                float y = e.MarginBounds.Top;

                graphics.DrawString("Delivery Pizzaria Print Agent", titleFont, Brushes.Black, x, y);
                y += titleFont.GetHeight(graphics) + 12;
                graphics.DrawString("TESTE DE IMPRESSÃO", bodyFont, Brushes.Black, x, y);
                y += bodyFont.GetHeight(graphics) + 6;
                graphics.DrawString("Versão: " + AgentInfo.Version, bodyFont, Brushes.Black, x, y);
                y += bodyFont.GetHeight(graphics) + 6;
                graphics.DrawString("Impressora: " + printerName, bodyFont, Brushes.Black, x, y);
                y += bodyFont.GetHeight(graphics) + 6;
                graphics.DrawString("Data: " + DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss"), bodyFont, Brushes.Black, x, y);
                e.HasMorePages = false;
            };

            document.Print();

            MessageBox.Show(
                "Página de teste enviada para:\n\n" + printerName,
                "Imprimir teste",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Não foi possível imprimir o teste.\n\n" + ex.Message,
                "Imprimir teste",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    protected override void ExitThreadCore()
    {
        _exiting = true;
        _settingsForm?.CloseForApplicationExit();

        // Some da bandeja imediatamente; o restante da limpeza pode levar
        // alguns instantes se o host local estiver finalizando uma requisição.
        _tray.Visible = false;
        _tray.Dispose();

        try
        {
            _server.Dispose();
        }
        catch
        {
            // O encerramento do Agent deve continuar mesmo se o servidor local
            // ou um driver de impressão estiver em processo de desligamento.
        }
        finally
        {
            _openRequestWait.Unregister(null);
            _dispatcher.Dispose();
            _forcedExitTimer?.Dispose();
            _forcedExitTimer = null;
            base.ExitThreadCore();
        }
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

    private static void EnsureInstallationRegistration()
    {
        try
        {
            var expectedDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DeliveryPizzaria",
                "PrintAgent");

            var currentDirectory = Path.GetFullPath(AppContext.BaseDirectory)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var normalizedExpected = Path.GetFullPath(expectedDirectory)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

            // Não registra "Aplicativos instalados" se alguém executou o EXE
            // diretamente de Downloads/ZIP sem passar pelo instalador.
            if (!string.Equals(
                    currentDirectory,
                    normalizedExpected,
                    StringComparison.OrdinalIgnoreCase))
                return;

            var executable = Application.ExecutablePath;
            var uninstaller = Path.Combine(currentDirectory, "Desinstalar.cmd");

            using var key = Registry.CurrentUser.CreateSubKey(UninstallRegistryPath);
            key.SetValue("DisplayName", "Delivery Pizzaria Print Agent");
            key.SetValue("DisplayVersion", AgentInfo.Version);
            key.SetValue("Publisher", "GuiaSys Studio");
            key.SetValue("InstallLocation", currentDirectory);
            key.SetValue("DisplayIcon", executable);
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);

            if (File.Exists(uninstaller))
            {
                key.SetValue(
                    "UninstallString",
                    $"cmd.exe /d /c \"\"{uninstaller}\"\"");
                key.SetValue(
                    "QuietUninstallString",
                    $"cmd.exe /d /c \"\"{uninstaller}\" /SILENT\"");
            }
        }
        catch
        {
            // O registro em "Aplicativos instalados" é conveniência. Uma falha
            // aqui não deve impedir o Agent de iniciar/imprimir.
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
            key.SetValue(StartupValueName, $"\"{Application.ExecutablePath}\" --background");
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
    private readonly Action _printTest;
    private readonly Action _requestExit;
    private readonly Action _requestUninstall;
    private bool _refreshingPrinters;
    private bool _allowClose;

    public AgentSettingsForm(
        Func<bool> getStartup,
        Action<bool> setStartup,
        Func<string?> getSelectedPrinter,
        Action<string?> setSelectedPrinter,
        Action printTest,
        Action requestExit,
        Action requestUninstall)
    {
        _getStartup = getStartup;
        _setStartup = setStartup;
        _getSelectedPrinter = getSelectedPrinter;
        _setSelectedPrinter = setSelectedPrinter;
        _printTest = printTest;
        _requestExit = requestExit;
        _requestUninstall = requestUninstall;

        Text = "Delivery Pizzaria • Print Agent";
        Icon = BrandIconFactory.Create();
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        Width = 575;
        Height = 500;
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

        var versionLabel = new Label
        {
            Text = "Versão " + AgentInfo.Version,
            ForeColor = Color.DimGray,
            AutoSize = true,
            Left = 24,
            Top = 118
        };

        var printerLabel = new Label
        {
            Text = "Impressoras detectadas",
            Font = new Font("Segoe UI", 9F, FontStyle.Bold),
            AutoSize = true,
            Left = 24,
            Top = 150
        };

        _printers = new ComboBox
        {
            Left = 24,
            Top = 174,
            Width = 505,
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
            Top = 218,
            Width = 155,
            Height = 34
        };
        refresh.Click += (_, _) => RefreshPrinters();

        var testButton = new Button
        {
            Text = "Imprimir teste",
            Left = 189,
            Top = 218,
            Width = 125,
            Height = 34
        };
        testButton.Click += (_, _) => _printTest();

        var windowsPrintersButton = new Button
        {
            Text = "Impressoras do Windows",
            Left = 324,
            Top = 218,
            Width = 205,
            Height = 34
        };
        windowsPrintersButton.Click += (_, _) =>
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "ms-settings:printers",
                    UseShellExecute = true
                });
            }
            catch
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "control.exe",
                    Arguments = "printers",
                    UseShellExecute = true
                });
            }
        };

        _startupCheck = new CheckBox
        {
            Text = "Iniciar automaticamente com o Windows",
            Checked = _getStartup(),
            AutoSize = true,
            Left = 24,
            Top = 272
        };
        _startupCheck.CheckedChanged += (_, _) => _setStartup(_startupCheck.Checked);

        var adminButton = new Button
        {
            Text = "Abrir painel da pizzaria",
            Left = 24,
            Top = 312,
            Width = 180,
            Height = 36
        };
        adminButton.Click += (_, _) =>
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = "https://pizzaria.guiasys.online/admin/",
                UseShellExecute = true
            });
        };

        var closeButton = new Button
        {
            Text = "Fechar janela",
            Left = 24,
            Top = 372,
            Width = 130,
            Height = 36
        };
        closeButton.Click += (_, _) => Hide();

        var exitButton = new Button
        {
            Text = "Sair do Agent",
            Left = 164,
            Top = 372,
            Width = 135,
            Height = 36
        };
        exitButton.Click += (_, _) => _requestExit();

        var uninstallButton = new Button
        {
            Text = "Desinstalar Print Agent",
            Left = 309,
            Top = 372,
            Width = 220,
            Height = 36,
            ForeColor = Color.DarkRed
        };
        uninstallButton.Click += (_, _) => _requestUninstall();

        var closeHint = new Label
        {
            Text = "Fechar janela mantém o Agent ativo ao lado do relógio. “Sair do Agent” encerra o serviço de impressão.",
            ForeColor = Color.DimGray,
            AutoSize = false,
            Left = 24,
            Top = 421,
            Width = 505,
            Height = 38
        };

        Controls.AddRange([
            title, subtitle, _statusLabel, versionLabel, printerLabel, _printers,
            refresh, testButton, windowsPrintersButton, _startupCheck,
            adminButton, closeButton, exitButton, uninstallButton, closeHint
        ]);

        FormClosing += (_, e) =>
        {
            if (!_allowClose && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
            }
        };

        RefreshPrinters();
    }

    public void CloseForApplicationExit()
    {
        if (IsDisposed)
            return;

        _allowClose = true;
        Close();
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
    private const string AgentVersion = AgentInfo.Version;
    private const int MaxRequestBodyBytes = 128 * 1024;
    private const int MaxPrintTextLength = 64_000;
    private const int MaxLogoUrlLength = 2048;
    private static readonly HashSet<int> AllowedLocalDevPorts = [80, 3000, 5000, 5500, 8000, 8080];
    private static readonly HttpClient LogoHttpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(5)
    };

    private readonly CancellationTokenSource _cts = new();
    private readonly object _printLock = new();
    private readonly Func<string?> _getSelectedPrinter;
    private readonly Action<string?> _setSelectedPrinter;
    private WebApplication? _app;
    private Task? _runTask;
    private bool _disposed;

    public LocalPrintServer(Func<string?> getSelectedPrinter, Action<string?> setSelectedPrinter)
    {
        _getSelectedPrinter = getSelectedPrinter;
        _setSelectedPrinter = setSelectedPrinter;
    }

    public void Start()
    {
        var builder = WebApplication.CreateSlimBuilder();

        builder.WebHost.UseUrls("http://127.0.0.1:17329");
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Limits.MaxRequestBodySize = MaxRequestBodyBytes;
        });

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

            if (HttpMethods.IsPost(context.Request.Method) && string.IsNullOrWhiteSpace(origin))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new { error = "origin_required" });
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
            version = AgentVersion
        }));

        _app.MapGet("/health", () => Results.Json(new
        {
            ok = true,
            name = "Delivery Pizzaria Print Agent",
            version = AgentVersion
        }));

        _app.MapGet("/printers", () =>
        {
            var printers = PrinterSettings.InstalledPrinters.Cast<string>()
                .OrderBy(x => x, StringComparer.CurrentCultureIgnoreCase)
                .ToArray();

            return Results.Json(new
            {
                printers,
                selectedPrinter = ResolveSelectedPrinter(),
                version = AgentVersion
            });
        });

        _app.MapPost("/print", async (HttpContext context) =>
        {
            if (context.Request.ContentLength is long contentLength && contentLength > MaxRequestBodyBytes)
            {
                return Results.Json(
                    new { error = "payload_too_large" },
                    statusCode: StatusCodes.Status413PayloadTooLarge);
            }

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

            if (request.Text.Length > MaxPrintTextLength)
            {
                return Results.Json(
                    new { error = "print_text_too_large" },
                    statusCode: StatusCodes.Status413PayloadTooLarge);
            }

            if (request.Copies is < 1 or > 5)
                return Results.BadRequest(new { error = "invalid_copies" });

            if (!string.IsNullOrWhiteSpace(request.Model) && !IsSupportedModel(request.Model))
                return Results.BadRequest(new { error = "invalid_model" });

            if (!string.IsNullOrWhiteSpace(request.StoreLogo) && request.StoreLogo.Length > MaxLogoUrlLength)
                return Results.BadRequest(new { error = "invalid_logo_url" });

            // A impressora física é sempre definida pelo próprio Agent.
            // Se a impressora salva sumiu/foi renomeada, o Agent recupera
            // automaticamente a padrão do Windows (ou a primeira disponível).
            var printerName = ResolveSelectedPrinter();
            if (string.IsNullOrWhiteSpace(printerName))
            {
                return Results.BadRequest(new { error = "printer_not_configured" });
            }

            using var logo = await TryLoadLogoAsync(request.StoreLogo, context.RequestAborted);

            try
            {
                lock (_printLock)
                {
                    PrintText(
                        printerName,
                        request.Text,
                        request.Copies,
                        request.Model,
                        logo);
                }

                return Results.Ok(new
                {
                    ok = true,
                    printer = printerName,
                    model = NormalizeModel(request.Model)
                });
            }
            catch (Exception ex)
            {
                Debug.WriteLine(ex);
                return Results.Json(
                    new { error = "print_failed" },
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        });

        try
        {
            _app.StartAsync(_cts.Token).GetAwaiter().GetResult();
            _runTask = _app.WaitForShutdownAsync(_cts.Token);
        }
        catch
        {
            try
            {
                _app.DisposeAsync().AsTask().GetAwaiter().GetResult();
            }
            catch
            {
                // A exceção original de inicialização é mais útil.
            }

            _app = null;
            throw;
        }
    }

    private string? ResolveSelectedPrinter()
    {
        var printers = PrinterSettings.InstalledPrinters.Cast<string>()
            .OrderBy(x => x, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();

        if (printers.Length == 0)
        {
            _setSelectedPrinter(null);
            return null;
        }

        var selected = _getSelectedPrinter();
        var installedSelection = printers.FirstOrDefault(p =>
            string.Equals(p, selected, StringComparison.CurrentCultureIgnoreCase));

        if (!string.IsNullOrWhiteSpace(installedSelection))
            return installedSelection;

        var windowsDefault = new PrinterSettings().PrinterName;
        var fallback = printers.FirstOrDefault(p =>
            string.Equals(p, windowsDefault, StringComparison.CurrentCultureIgnoreCase))
            ?? printers[0];

        _setSelectedPrinter(fallback);
        return fallback;
    }

    private static bool IsAllowedOrigin(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin))
            return true;

        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
            return false;

        var host = uri.Host;
        var https = string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase);
        var http = string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase);

        if (https && (uri.IsDefaultPort || uri.Port == 443) && (
            host.Equals("pizzaria.guiasys.online", StringComparison.OrdinalIgnoreCase) ||
            host.Equals("delivery-pizzaria-f5b08.web.app", StringComparison.OrdinalIgnoreCase) ||
            host.Equals("delivery-pizzaria-f5b08.firebaseapp.com", StringComparison.OrdinalIgnoreCase)))
            return true;

        if (http &&
            AllowedLocalDevPorts.Contains(uri.Port) &&
            (host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
             host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)))
            return true;

        return false;
    }

    private static bool IsSupportedModel(string? model)
    {
        return string.IsNullOrWhiteSpace(model) ||
            StringComparer.OrdinalIgnoreCase.Equals(model, "thermal80") ||
            StringComparer.OrdinalIgnoreCase.Equals(model, "thermal58") ||
            StringComparer.OrdinalIgnoreCase.Equals(model, "a4") ||
            StringComparer.OrdinalIgnoreCase.Equals(model, "compact") ||
            StringComparer.OrdinalIgnoreCase.Equals(model, "label");
    }

    private sealed record PrintProfile(
        string Model,
        int PaperWidth,
        int PaperHeight,
        Margins Margins,
        float FontSize,
        bool PrintLogo,
        float MaxLogoHeight);

    private static string NormalizeModel(string? model)
    {
        return StringComparer.OrdinalIgnoreCase.Equals(model, "thermal58") ? "thermal58" :
            StringComparer.OrdinalIgnoreCase.Equals(model, "a4") ? "a4" :
            StringComparer.OrdinalIgnoreCase.Equals(model, "compact") ? "compact" :
            StringComparer.OrdinalIgnoreCase.Equals(model, "label") ? "label" :
            "thermal80";
    }

    private static PrintProfile GetPrintProfile(string? model)
    {
        return NormalizeModel(model) switch
        {
            "thermal58" => new("thermal58", 228, 2000, new Margins(4, 4, 5, 5), 7.2f, true, 55f),
            "a4" => new("a4", 827, 1169, new Margins(40, 40, 40, 40), 10.5f, true, 105f),
            "compact" => new("compact", 228, 2000, new Margins(4, 4, 5, 5), 7.2f, false, 0f),
            "label" => new("label", 315, 394, new Margins(6, 6, 6, 6), 8.0f, false, 0f),
            _ => new("thermal80", 315, 2000, new Margins(6, 6, 6, 6), 8.8f, true, 70f)
        };
    }

    private static void ApplyPaperProfile(PrintDocument document, PrintProfile profile)
    {
        document.DefaultPageSettings.Margins = profile.Margins;

        try
        {
            PaperSize? paper = null;

            if (profile.Model == "a4")
            {
                paper = document.PrinterSettings.PaperSizes
                    .Cast<PaperSize>()
                    .FirstOrDefault(size => size.Kind == PaperKind.A4);
            }

            paper ??= new PaperSize(
                profile.Model switch
                {
                    "thermal58" => "Thermal 58 mm",
                    "a4" => "A4",
                    "compact" => "Compact 58 mm",
                    "label" => "Label 80 x 100 mm",
                    _ => "Thermal 80 mm"
                },
                profile.PaperWidth,
                profile.PaperHeight);

            document.DefaultPageSettings.PaperSize = paper;
        }
        catch
        {
            // Alguns drivers recusam papel customizado. Neles, preservamos
            // o tamanho configurado no próprio driver em vez de falhar a impressão.
        }
    }

    private static async Task<Image?> TryLoadLogoAsync(string? url, CancellationToken cancellationToken)
    {
        if (!IsAllowedLogoUrl(url))
            return null;

        try
        {
            var bytes = await LogoHttpClient.GetByteArrayAsync(new Uri(url!), cancellationToken);
            if (bytes.Length == 0 || bytes.Length > 2_000_000)
                return null;

            using var stream = new MemoryStream(bytes);
            using var source = Image.FromStream(stream);
            return new Bitmap(source);
        }
        catch
        {
            return null;
        }
    }

    private static bool IsAllowedLogoUrl(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            return false;

        var host = uri.Host;
        return host.Equals("raw.githubusercontent.com", StringComparison.OrdinalIgnoreCase) ||
            host.Equals("pizzaria.guiasys.online", StringComparison.OrdinalIgnoreCase) ||
            host.Equals("delivery-pizzaria-f5b08.web.app", StringComparison.OrdinalIgnoreCase) ||
            host.Equals("delivery-pizzaria-f5b08.firebaseapp.com", StringComparison.OrdinalIgnoreCase);
    }

    private static void PrintText(
        string printerName,
        string text,
        int copies,
        string? model,
        Image? logo)
    {
        var profile = GetPrintProfile(model);

        for (var copy = 0; copy < copies; copy++)
        {
            using var document = new PrintDocument();

            document.PrinterSettings.PrinterName = printerName;
            document.PrintController = new StandardPrintController();
            document.DocumentName = "Comanda Delivery Pizzaria";
            ApplyPaperProfile(document, profile);

            var lines = NormalizeLines(text).ToList();
            var lineIndex = 0;
            var logoPrinted = false;

            document.PrintPage += (_, e) =>
            {
                using var font = new Font("Consolas", profile.FontSize, FontStyle.Regular, GraphicsUnit.Point);
                using var bold = new Font("Consolas", profile.FontSize, FontStyle.Bold, GraphicsUnit.Point);

                var graphics = e.Graphics ?? throw new InvalidOperationException("Contexto de impressão indisponível.");
                float y = e.MarginBounds.Top;
                var lineHeight = font.GetHeight(graphics) + 1;
                var maxWidth = e.MarginBounds.Width;

                if (profile.PrintLogo && logo is not null && !logoPrinted)
                {
                    var scale = Math.Min(
                        maxWidth / Math.Max(1f, logo.Width),
                        profile.MaxLogoHeight / Math.Max(1f, logo.Height));
                    scale = Math.Min(scale, 1.5f);

                    var logoWidth = logo.Width * scale;
                    var logoHeight = logo.Height * scale;
                    var logoX = e.MarginBounds.Left + (maxWidth - logoWidth) / 2f;

                    graphics.DrawImage(logo, logoX, y, logoWidth, logoHeight);
                    y += logoHeight + 6f;
                    logoPrinted = true;
                }

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
            || upper.StartsWith("DESCONTO:")
            || upper.StartsWith("CUPOM:")
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
        if (_disposed)
            return;

        _disposed = true;

        try
        {
            _cts.Cancel();
        }
        catch
        {
            // ignored during shutdown
        }

        if (_app is not null)
        {
            try
            {
                using var stopCts = new CancellationTokenSource(TimeSpan.FromMilliseconds(1200));
                _app.StopAsync(stopCts.Token).GetAwaiter().GetResult();
            }
            catch
            {
                // O processo ainda será encerrado pelo ApplicationContext.
            }

            try
            {
                var disposeTask = _app.DisposeAsync().AsTask();
                disposeTask.Wait(TimeSpan.FromMilliseconds(1200));
            }
            catch
            {
                // Não bloqueia a saída por causa do host local.
            }
        }

        try
        {
            _cts.Dispose();
        }
        catch
        {
            // ignored during shutdown
        }
    }

    private sealed record PrintRequest(
        string Text,
        int Copies = 1,
        string? Model = null,
        string? StoreLogo = null);
}

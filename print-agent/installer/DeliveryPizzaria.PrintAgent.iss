#ifndef MyAppVersion
  #define MyAppVersion "1.8.0"
#endif

#define MyAppName "Delivery Pizzaria Print Agent"
#define MyAppPublisher "GuiaSys Studio"
#define MyAppExeName "DeliveryPizzaria.PrintAgent.exe"
#define MyAppId "{{7D5B70CE-5342-4D53-B9EF-D8C716630AA8}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={code:GetDefaultInstallDir}
DefaultGroupName=GuiaSys\Delivery Pizzaria Print Agent
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=DeliveryPizzaria-PrintAgent-Setup-x64
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UsePreviousAppDir=yes
CloseApplications=yes
RestartApplications=no
Uninstallable=yes
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupLogging=yes
MinVersion=10.0.17763

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\publish\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userdesktop}\Delivery Pizzaria Print Agent"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--open"; WorkingDir: "{app}"; Comment: "Abrir o Delivery Pizzaria Print Agent"
Name: "{group}\Delivery Pizzaria Print Agent"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--open"; WorkingDir: "{app}"
Name: "{group}\Desinstalar Delivery Pizzaria Print Agent"; Filename: "{uninstallexe}"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "DeliveryPizzariaPrintAgent"; ValueData: """{app}\{#MyAppExeName}"" --background"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\DeliveryPizzaria\PrintAgent"; ValueType: dword; ValueName: "StartupConfigured"; ValueData: "1"
Root: HKCU; Subkey: "Software\DeliveryPizzaria\PrintAgent"; ValueType: string; ValueName: "InstalledVersion"; ValueData: "{#MyAppVersion}"
Root: HKCU; Subkey: "Software\DeliveryPizzaria\PrintAgent"; ValueType: none; Flags: uninsdeletekey

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--open"; Description: "Abrir o Print Agent agora"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/d /c taskkill /IM {#MyAppExeName} /F >nul 2>nul"; Flags: runhidden; RunOnceId: "StopPrintAgent"

[InstallDelete]
Type: filesandordirs; Name: "{localappdata}\DeliveryPizzaria\PrintAgent"

[Code]
function GetDefaultInstallDir(Param: String): String;
begin
  { Se o computador já usa D:\Programas, respeita esse padrão. Em máquinas
    sem essa pasta, usa a pasta de programas do usuário sem exigir UAC. }
  if DirExists('D:\Programas') then
    Result := 'D:\Programas\GuiaSys\Delivery Pizzaria Print Agent'
  else
    Result := ExpandConstant('{localappdata}\Programs\GuiaSys\Delivery Pizzaria Print Agent');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  { Encerra versões antigas para permitir atualização/substituição do EXE. }
  Exec(
    ExpandConstant('{cmd}'),
    '/d /c taskkill /IM {#MyAppExeName} /F >nul 2>nul',
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  );

  { Remove apenas o cadastro de desinstalação do instalador legado 1.7.
    Preferências da impressora permanecem no registro e são reaproveitadas. }
  RegDeleteKeyIncludingSubkeys(
    HKCU,
    'Software\Microsoft\Windows\CurrentVersion\Uninstall\DeliveryPizzariaPrintAgent'
  );

  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    { Remove Mark-of-the-Web do EXE instalado quando possível. }
    Exec(
      ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' +
      '$p=''' + ExpandConstant('{app}\{#MyAppExeName}') + '''; ' +
      'Unblock-File -LiteralPath $p -ErrorAction SilentlyContinue; ' +
      'Remove-Item -LiteralPath ($p + '':Zone.Identifier'') -Force -ErrorAction SilentlyContinue"',
      '',
      SW_HIDE,
      ewWaitUntilTerminated,
      ResultCode
    );
  end;
end;

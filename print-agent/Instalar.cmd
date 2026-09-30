@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Instalar Delivery Pizzaria Print Agent

set "PACKAGE_DIR=%~dp0"
set "TARGET=%LOCALAPPDATA%\DeliveryPizzaria\PrintAgent"
set "SOURCE=%~dp0DeliveryPizzaria.PrintAgent.exe"
set "UNINSTALL_SOURCE=%~dp0Desinstalar.cmd"
set "DEST=%TARGET%\DeliveryPizzaria.PrintAgent.exe"
set "UNINSTALL_DEST=%TARGET%\Desinstalar.cmd"

echo.
echo Delivery Pizzaria Print Agent 1.6.0
echo ==================================
echo.
echo Instalando em:
echo %TARGET%
echo.

if not exist "%SOURCE%" (
  echo ERRO: DeliveryPizzaria.PrintAgent.exe nao foi encontrado ao lado deste instalador.
  echo.
  pause
  exit /b 1
)

if not exist "%UNINSTALL_SOURCE%" (
  echo ERRO: Desinstalar.cmd nao foi encontrado ao lado deste instalador.
  echo.
  pause
  exit /b 1
)

echo Removendo bloqueio de seguranca dos arquivos extraidos...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue'; Get-ChildItem -LiteralPath $env:PACKAGE_DIR -File | ForEach-Object { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue }; exit 0" >nul 2>nul

echo Encerrando versao anterior, se estiver aberta...
taskkill /IM DeliveryPizzaria.PrintAgent.exe /F >nul 2>nul

if not exist "%TARGET%" mkdir "%TARGET%" >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERRO: Nao foi possivel criar a pasta de instalacao.
  echo.
  pause
  exit /b 1
)

echo Copiando arquivos...
copy /Y /B "%SOURCE%" "%DEST%" >nul
if errorlevel 1 goto :copy_error

copy /Y /B "%UNINSTALL_SOURCE%" "%UNINSTALL_DEST%" >nul
if errorlevel 1 goto :copy_error

echo Removendo Mark-of-the-Web do arquivo instalado...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue'; @($env:DEST,$env:UNINSTALL_DEST) | ForEach-Object { Unblock-File -LiteralPath $_ -ErrorAction SilentlyContinue; Remove-Item -LiteralPath ($_ + ':Zone.Identifier') -Force -ErrorAction SilentlyContinue }; exit 0" >nul 2>nul

echo Verificando se o executavel ficou desbloqueado...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$zone=Get-Item -LiteralPath $env:DEST -Stream Zone.Identifier -ErrorAction SilentlyContinue; if($null -ne $zone){exit 9}else{exit 0}" >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERRO: o Windows ainda marcou o Print Agent como arquivo vindo da Internet.
  echo A instalacao foi interrompida para evitar o aviso a cada inicializacao.
  echo.
  echo Tente extrair o ZIP novamente e executar Instalar.cmd.
  echo.
  pause
  exit /b 9
)

echo Registrando inicializacao automatica e desinstalador...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; New-Item -Path $run -Force | Out-Null; New-ItemProperty -Path $run -Name 'DeliveryPizzariaPrintAgent' -Value ('"' + $env:DEST + '"') -PropertyType String -Force | Out-Null; $app='HKCU:\Software\DeliveryPizzaria\PrintAgent'; New-Item -Path $app -Force | Out-Null; New-ItemProperty -Path $app -Name 'StartupConfigured' -Value 1 -PropertyType DWord -Force | Out-Null; New-ItemProperty -Path $app -Name 'InstalledVersion' -Value '1.6.0' -PropertyType String -Force | Out-Null; $u='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeliveryPizzariaPrintAgent'; New-Item -Path $u -Force | Out-Null; Set-ItemProperty -Path $u -Name 'DisplayName' -Value 'Delivery Pizzaria Print Agent'; Set-ItemProperty -Path $u -Name 'DisplayVersion' -Value '1.6.0'; Set-ItemProperty -Path $u -Name 'Publisher' -Value 'GuiaSys Studio'; Set-ItemProperty -Path $u -Name 'InstallLocation' -Value $env:TARGET; Set-ItemProperty -Path $u -Name 'DisplayIcon' -Value $env:DEST; Set-ItemProperty -Path $u -Name 'UninstallString' -Value ('cmd.exe /d /c ""' + $env:UNINSTALL_DEST + '""'); Set-ItemProperty -Path $u -Name 'QuietUninstallString' -Value ('cmd.exe /d /c ""' + $env:UNINSTALL_DEST + '" /SILENT"'); New-ItemProperty -Path $u -Name 'NoModify' -Value 1 -PropertyType DWord -Force | Out-Null; New-ItemProperty -Path $u -Name 'NoRepair' -Value 1 -PropertyType DWord -Force | Out-Null" >nul 2>nul

if errorlevel 1 (
  echo.
  echo ERRO: nao foi possivel registrar a inicializacao/desinstalacao no Windows.
  echo.
  pause
  exit /b 10
)

echo Iniciando Print Agent...
start "" /D "%TARGET%" "%DEST%"

echo.
echo Instalacao concluida.
echo.
echo O Print Agent foi:
echo - instalado em AppData do usuario;
echo - desbloqueado do Mark-of-the-Web;
echo - configurado para iniciar junto com o Windows;
echo - registrado em Aplicativos instalados do Windows.
echo.
echo Nas proximas inicializacoes do Windows o Agent deve iniciar direto,
echo sem o aviso "O fornecedor nao pode ser verificado".
echo.
echo Pelo icone ao lado do relogio voce pode imprimir teste, sair ou desinstalar.
echo.
pause
exit /b 0

:copy_error
echo.
echo ERRO: Nao foi possivel copiar os arquivos do Print Agent.
echo Verifique se o arquivo esta em uso e tente novamente.
echo.
pause
exit /b 2

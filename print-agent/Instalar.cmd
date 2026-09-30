@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Instalar Delivery Pizzaria Print Agent

set "SILENT=0"
if /I "%~1"=="/SILENT" set "SILENT=1"

set "PACKAGE_DIR=%~dp0"
set "TARGET=%LOCALAPPDATA%\DeliveryPizzaria\PrintAgent"
set "SOURCE=%~dp0DeliveryPizzaria.PrintAgent.exe"
set "UNINSTALL_SOURCE=%~dp0Desinstalar.cmd"
set "DEST=%TARGET%\DeliveryPizzaria.PrintAgent.exe"
set "UNINSTALL_DEST=%TARGET%\Desinstalar.cmd"

echo.
echo Delivery Pizzaria Print Agent 1.7.0
echo ==================================
echo.
echo Instalando em:
echo %TARGET%
echo.

if not exist "%SOURCE%" (
  echo ERRO: DeliveryPizzaria.PrintAgent.exe nao foi encontrado ao lado deste instalador.
  echo.
  if "%SILENT%"=="0" pause
  exit /b 1
)

if not exist "%UNINSTALL_SOURCE%" (
  echo ERRO: Desinstalar.cmd nao foi encontrado ao lado deste instalador.
  echo.
  if "%SILENT%"=="0" pause
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
  if "%SILENT%"=="0" pause
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
  if "%SILENT%"=="0" pause
  exit /b 9
)

echo Registrando inicializacao automatica e desinstalador...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; New-Item -Path $run -Force | Out-Null; New-ItemProperty -Path $run -Name 'DeliveryPizzariaPrintAgent' -Value ('"' + $env:DEST + '"') -PropertyType String -Force | Out-Null; $app='HKCU:\Software\DeliveryPizzaria\PrintAgent'; New-Item -Path $app -Force | Out-Null; New-ItemProperty -Path $app -Name 'StartupConfigured' -Value 1 -PropertyType DWord -Force | Out-Null; New-ItemProperty -Path $app -Name 'InstalledVersion' -Value '1.7.0' -PropertyType String -Force | Out-Null; $u='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeliveryPizzariaPrintAgent'; New-Item -Path $u -Force | Out-Null; Set-ItemProperty -Path $u -Name 'DisplayName' -Value 'Delivery Pizzaria Print Agent'; Set-ItemProperty -Path $u -Name 'DisplayVersion' -Value '1.7.0'; Set-ItemProperty -Path $u -Name 'Publisher' -Value 'GuiaSys Studio'; Set-ItemProperty -Path $u -Name 'InstallLocation' -Value $env:TARGET; Set-ItemProperty -Path $u -Name 'DisplayIcon' -Value $env:DEST; Set-ItemProperty -Path $u -Name 'UninstallString' -Value ('cmd.exe /d /c ""' + $env:UNINSTALL_DEST + '""'); Set-ItemProperty -Path $u -Name 'QuietUninstallString' -Value ('cmd.exe /d /c ""' + $env:UNINSTALL_DEST + '" /SILENT"'); New-ItemProperty -Path $u -Name 'NoModify' -Value 1 -PropertyType DWord -Force | Out-Null; New-ItemProperty -Path $u -Name 'NoRepair' -Value 1 -PropertyType DWord -Force | Out-Null" >nul 2>nul

if errorlevel 1 (
  echo.
  echo ERRO: nao foi possivel registrar a inicializacao/desinstalacao no Windows.
  echo.
  if "%SILENT%"=="0" pause
  exit /b 10
)

echo Iniciando Print Agent...
start "" /D "%TARGET%" "%DEST%"

echo Verificando se o servico local iniciou corretamente...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$ok=$false; for($i=0; $i -lt 20; $i++){ try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:17329/health' -TimeoutSec 1; if($health.ok -eq $true -and $health.version -eq '1.7.0'){ $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 250 }; if($ok){exit 0}else{exit 11}" >nul 2>nul
if errorlevel 1 goto :startup_error

echo.
echo Instalacao concluida.
echo.
echo O Print Agent foi:
echo - instalado em AppData do usuario;
echo - desbloqueado do Mark-of-the-Web;
echo - configurado para iniciar junto com o Windows;
echo - registrado em Aplicativos instalados do Windows.
echo.
echo O Windows ainda pode exibir SmartScreen ou aviso de fornecedor desconhecido
echo na primeira execucao enquanto o executavel nao tiver assinatura Authenticode.
echo O instalador remove o Mark-of-the-Web para reduzir repeticoes desse aviso
echo nas proximas inicializacoes, mas nao garante eliminar todos os avisos do Windows.
echo.
echo Pelo icone ao lado do relogio voce pode imprimir teste, sair ou desinstalar.
echo.
if "%SILENT%"=="0" pause
exit /b 0

:startup_error
taskkill /IM DeliveryPizzaria.PrintAgent.exe /F >nul 2>nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "DeliveryPizzariaPrintAgent" /f >nul 2>nul
reg delete "HKCU\Software\DeliveryPizzaria\PrintAgent" /f >nul 2>nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeliveryPizzariaPrintAgent" /f >nul 2>nul
rmdir /S /Q "%TARGET%" >nul 2>nul
echo.
echo ERRO: o Print Agent foi copiado, mas o servico local nao iniciou corretamente.
echo Verifique se a porta 17329 esta em uso por outro programa e tente novamente.
echo.
if "%SILENT%"=="0" pause
exit /b 11

:copy_error
echo.
echo ERRO: Nao foi possivel copiar os arquivos do Print Agent.
echo Verifique se o arquivo esta em uso e tente novamente.
echo.
if "%SILENT%"=="0" pause
exit /b 2

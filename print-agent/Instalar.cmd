@echo off
setlocal EnableExtensions
title Instalar Delivery Pizzaria Print Agent

set "TARGET=%LOCALAPPDATA%\DeliveryPizzaria\PrintAgent"
set "SOURCE=%~dp0DeliveryPizzaria.PrintAgent.exe"
set "DEST=%TARGET%\DeliveryPizzaria.PrintAgent.exe"

echo.
echo Delivery Pizzaria Print Agent
echo =============================
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

if not exist "%TARGET%" mkdir "%TARGET%" >nul 2>nul

echo Encerrando versao anterior, se estiver aberta...
taskkill /IM DeliveryPizzaria.PrintAgent.exe /F >nul 2>nul

echo Copiando arquivos...
copy /Y /B "%SOURCE%" "%DEST%" >nul
if errorlevel 1 (
  echo.
  echo ERRO: Nao foi possivel copiar o Print Agent.
  echo Verifique se o arquivo esta em uso e tente novamente.
  echo.
  pause
  exit /b 1
)

echo Removendo bloqueio de arquivo baixado da Internet...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "try { Unblock-File -LiteralPath '%DEST%' -ErrorAction SilentlyContinue } catch {}; try { Remove-Item -LiteralPath '%DEST%:Zone.Identifier' -Force -ErrorAction SilentlyContinue } catch {}; exit 0" >nul 2>nul

echo Iniciando Print Agent...
start "" "%DEST%"

echo.
echo Instalacao concluida.
echo.
echo O Print Agent foi instalado no seu usuario do Windows e configurara
echo automaticamente a inicializacao junto com o Windows.
echo.
echo Depois desta instalacao, o executavel instalado fica desbloqueado para
echo evitar que o aviso "O fornecedor nao pode ser verificado" volte a cada login.
echo.
echo Use o icone do Print Agent ao lado do relogio para configurar impressora,
echo imprimir teste, sair do Agent ou desinstalar.
echo.
pause
exit /b 0

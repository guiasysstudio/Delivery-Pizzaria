@echo off
setlocal EnableExtensions
title Desinstalar Delivery Pizzaria Print Agent

set "TARGET=%LOCALAPPDATA%\DeliveryPizzaria\PrintAgent"

echo.
echo Delivery Pizzaria Print Agent
echo =============================
echo.
echo Esta operacao vai:
echo - encerrar o Print Agent;
echo - remover a inicializacao com o Windows;
echo - apagar as preferencias salvas do Agent;
echo - remover os arquivos instalados em AppData.
echo.
choice /C SN /N /M "Deseja continuar? [S/N]: "
if errorlevel 2 (
  echo.
  echo Desinstalacao cancelada.
  exit /b 0
)

echo.
echo Encerrando Print Agent...
taskkill /IM DeliveryPizzaria.PrintAgent.exe /F >nul 2>nul

echo Removendo inicializacao automatica...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "DeliveryPizzariaPrintAgent" /f >nul 2>nul
reg delete "HKCU\Software\DeliveryPizzaria\PrintAgent" /f >nul 2>nul

echo Removendo arquivos...
cd /d "%TEMP%"
if exist "%TARGET%" rmdir /S /Q "%TARGET%"

echo.
if exist "%TARGET%" (
  echo A desinstalacao nao conseguiu remover todos os arquivos.
  echo Reinicie o Windows e execute este desinstalador novamente.
  echo.
  pause
  exit /b 1
)

echo Desinstalacao concluida com sucesso.
echo.
pause
exit /b 0

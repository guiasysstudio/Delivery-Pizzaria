@echo off
setlocal
title Instalar Delivery Pizzaria Print Agent
set "TARGET=%LOCALAPPDATA%\DeliveryPizzaria\PrintAgent"

echo.
echo Delivery Pizzaria Print Agent
echo =============================
echo Instalando em:
echo %TARGET%
echo.

if not exist "%TARGET%" mkdir "%TARGET%"

taskkill /IM DeliveryPizzaria.PrintAgent.exe /F >nul 2>nul
copy /Y "%~dp0DeliveryPizzaria.PrintAgent.exe" "%TARGET%\DeliveryPizzaria.PrintAgent.exe" >nul

if errorlevel 1 (
  echo.
  echo Falha ao copiar o Print Agent.
  pause
  exit /b 1
)

start "" "%TARGET%\DeliveryPizzaria.PrintAgent.exe"

echo.
echo Instalacao concluida.
echo O Print Agent foi iniciado e pode ser configurado pelo icone ao lado do relogio.
echo.
pause

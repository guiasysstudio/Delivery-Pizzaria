@echo off
setlocal EnableExtensions
title Desinstalar Delivery Pizzaria Print Agent

set "TARGET=%LOCALAPPDATA%\DeliveryPizzaria\PrintAgent"
set "SILENT=0"

if /I "%~1"=="/SILENT" set "SILENT=1"
if /I "%~1"=="/FROMTEMP" goto :run

set "TEMP_UNINSTALL=%TEMP%\DeliveryPizzaria-PrintAgent-Uninstall-%RANDOM%%RANDOM%.cmd"
copy /Y "%~f0" "%TEMP_UNINSTALL%" >nul 2>nul
if errorlevel 1 (
  if "%SILENT%"=="0" (
    echo.
    echo ERRO: nao foi possivel preparar o desinstalador temporario.
    echo.
    pause
  )
  exit /b 1
)

if "%SILENT%"=="1" (
  start "" /B cmd.exe /d /c ""%TEMP_UNINSTALL%" /FROMTEMP /SILENT"
) else (
  start "" cmd.exe /d /c ""%TEMP_UNINSTALL%" /FROMTEMP"
)
exit /b 0

:run
if /I "%~2"=="/SILENT" set "SILENT=1"

if "%SILENT%"=="0" (
  echo.
  echo Delivery Pizzaria Print Agent 1.6.0
  echo ==================================
  echo.
  echo Esta operacao vai:
  echo - encerrar o Print Agent;
  echo - remover a inicializacao com o Windows;
  echo - apagar as preferencias salvas do Agent;
  echo - remover o registro em Aplicativos instalados;
  echo - remover os arquivos instalados em AppData.
  echo.
  choice /C SN /N /M "Deseja continuar? [S/N]: "
  if errorlevel 2 (
    echo.
    echo Desinstalacao cancelada.
    goto :cleanup
  )
)

taskkill /IM DeliveryPizzaria.PrintAgent.exe /F >nul 2>nul
timeout /t 1 /nobreak >nul

reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "DeliveryPizzariaPrintAgent" /f >nul 2>nul
reg delete "HKCU\Software\DeliveryPizzaria\PrintAgent" /f >nul 2>nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeliveryPizzariaPrintAgent" /f >nul 2>nul

cd /d "%TEMP%"
if exist "%TARGET%" rmdir /S /Q "%TARGET%" >nul 2>nul

if exist "%TARGET%" (
  if "%SILENT%"=="0" (
    echo.
    echo A desinstalacao nao conseguiu remover todos os arquivos.
    echo Reinicie o Windows e tente novamente.
    echo.
    pause
  )
  goto :cleanup_error
)

if "%SILENT%"=="0" (
  echo.
  echo Desinstalacao concluida com sucesso.
  echo.
  timeout /t 2 /nobreak >nul
)

:cleanup
start "" /B cmd.exe /d /c "timeout /t 1 /nobreak >nul & del /Q "%~f0" >nul 2>nul"
exit /b 0

:cleanup_error
start "" /B cmd.exe /d /c "timeout /t 1 /nobreak >nul & del /Q "%~f0" >nul 2>nul"
exit /b 2

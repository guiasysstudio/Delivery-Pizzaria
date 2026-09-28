@echo off
set "URL=https://guiasysstudio.github.io/Delivery-Pizzaria/admin/"
start "" msedge.exe "%URL%"
if errorlevel 1 start "" chrome.exe "%URL%"

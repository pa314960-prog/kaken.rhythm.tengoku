@echo off
setlocal
cd /d "%~dp0"
title リズミカ！ ランチャー
set PORT=8000

echo ==================================================
echo    リズミカ！ を起動します
echo ==================================================
echo.

rem --- Python があればローカルサーバーで起動する（おすすめ） ---
set "CMD="
where python >nul 2>nul
if %errorlevel% equ 0 set "CMD=python"
if defined CMD goto serve

where py >nul 2>nul
if %errorlevel% equ 0 set "CMD=py"
if defined CMD goto serve

goto direct

:serve
echo ローカルサーバーで起動します。
echo    アドレス : http://localhost:%PORT%/
echo.
echo ブラウザが自動で開きます。
echo 遊び終わったら、この黒い画面で Ctrl + C を押すか、
echo 画面を閉じてください。
echo.
start "" "http://localhost:%PORT%/"
%CMD% -m http.server %PORT%
goto end

:direct
echo Python が見つかりませんでした。
echo index.html をブラウザで直接開きます（この方法でも遊べます）。
echo.
start "" "index.html"
timeout /t 4 >nul
goto end

:end
endlocal

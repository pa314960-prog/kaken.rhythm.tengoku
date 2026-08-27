#!/bin/sh
# Mac / Linux 用のかんたん起動スクリプト
cd "$(dirname "$0")" || exit 1
PORT=8000
if command -v python3 >/dev/null 2>&1; then
  echo "http://localhost:$PORT/ を開きます (終了は Ctrl+C)"
  (sleep 1; (command -v open >/dev/null && open "http://localhost:$PORT/") || \
    (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT/")) &
  python3 -m http.server "$PORT"
else
  echo "python3 が無いので index.html を直接開きます"
  (command -v open >/dev/null && open index.html) || \
    (command -v xdg-open >/dev/null && xdg-open index.html)
fi

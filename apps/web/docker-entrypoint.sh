#!/bin/sh
set -eu

if [ -n "${PORT:-}" ]; then
  sed -i "s/listen 80;/listen ${PORT};/" /etc/nginx/conf.d/default.conf
fi

if [ -n "${VITE_API_BASE_URL:-}" ]; then
  escaped=$(printf '%s' "${VITE_API_BASE_URL}" | tr -d '\n\r' | sed 's/\\/\\\\/g; s/"/\\"/g; s/</\\u003c/g')
  printf 'window.__PARKVANTA_CONFIG__ = { API_BASE_URL: "%s" };\n' "$escaped" \
    > /usr/share/nginx/html/env-config.js
fi

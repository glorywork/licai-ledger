#!/usr/bin/env bash
# 发布前的一致性门禁（CI 与本地都能跑）：  bash scripts/check-version.sh
#
# 守的是三件「推上去才发现、而且很难查」的事：
#   1. APP_VER 与 sw.js 的 CACHE 不一致 —— 浏览器缓存优先，用户永远看不到新代码；
#   2. sw.js 预缓存清单里有不存在的文件 —— install 阶段静默失败，离线壳残缺；
#   3. index.html 引用了不存在的资源 —— 线上 404，装不了 PWA。
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "❌ $*" >&2; exit 1; }

app=$(sed -n 's/^const APP_VER = "v\([0-9]\+\)";.*/\1/p' app.js | head -1)
cache=$(sed -n 's/^const CACHE = "licai-ledger-v\([0-9]\+\)";.*/\1/p' sw.js | head -1)
[ -n "$app" ]   || fail "app.js 里找不到 APP_VER"
[ -n "$cache" ] || fail "sw.js 里找不到 CACHE"
[ "$app" = "$cache" ] || fail "APP_VER=v$app 与 CACHE=v$cache 不一致：改了 app.js 必须同时把 sw.js 的 CACHE 加一"

# sw.js 预缓存清单里的每个文件都要真实存在
while IFS= read -r f; do
  if [ -z "$f" ] || [ "$f" = "." ]; then continue; fi
  [ -e "$f" ] || fail "sw.js 预缓存了不存在的文件：$f"
done < <(sed -n '/const SHELL = \[/,/\];/p' sw.js | grep -oE '"\./[^"]*"' | tr -d '"' | sed 's|^\./||')

# index.html 引用的本地资源（排除 # 锚点与外部 URL）
while IFS= read -r f; do
  if [ -z "$f" ]; then continue; fi
  [ -e "$f" ] || fail "index.html 引用了不存在的文件：$f"
done < <(grep -oE '(src|href)="[^":#]+"' index.html | sed -E 's/.*="//;s/"$//' | sort -u)

echo "✅ 版本与资源清单一致（v$app）"

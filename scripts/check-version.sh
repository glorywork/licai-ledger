#!/usr/bin/env bash
# 发布前的一致性门禁（CI 与本地都能跑）：  bash scripts/check-version.sh
#
# 守的是四件「推上去才发现、而且很难查」的事：
#   1. APP_VER 与 sw.js 的 CACHE 不一致 —— 浏览器缓存优先，用户永远看不到新代码；
#   2. sw.js 预缓存清单里有不存在的文件 —— install 阶段静默失败，离线壳残缺；
#   3. index.html 引用了不存在的资源 —— 线上 404，装不了 PWA；
#   4. app.js 的 import 闭包有模块没进 SHELL —— 离线打开时那个模块 404，
#      而 app.js 是 ES module：任何一个 import 解析失败就是**整页空白**，
#      构建不报错、CI 也不报错，只有用户手机上是白的（Android 侧同理，见
#      android-src/scripts/verify-web.sh 的依赖遍历）。
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

# app.js 的 import 闭包：每个模块都要真实存在，而且要在 SHELL 里
python3 - <<'PYCD'
import os, re, sys
shell_src = open("sw.js", encoding="utf-8").read()
m = re.search(r"const SHELL = \[(.*?)\];", shell_src, re.S)
if not m:
    sys.exit("❌ sw.js 里找不到 SHELL 数组，import 闭包没法校验")
shell = {os.path.normpath(u.strip().strip('"').lstrip("./") or ".")
         for u in re.findall(r'"(\./[^"]*)"', m.group(1))}
seen, missing, unlisted = set(), [], []
queue = ["app.js"]
while queue:
    f = os.path.normpath(queue.pop())
    if f in seen:
        continue
    seen.add(f)
    if not os.path.isfile(f):
        missing.append(f)
        continue
    if f != "app.js" and f not in shell:
        unlisted.append(f)
    for rel in re.findall(r'from\s+"(\.[^"]+)"', open(f, encoding="utf-8").read()):
        queue.append(os.path.normpath(os.path.join(os.path.dirname(f), rel)))
if missing:
    sys.exit("❌ app.js 依赖的模块缺文件：" + ", ".join(missing))
if unlisted:
    sys.exit("❌ 这些模块没写进 sw.js 的 SHELL（离线打开会整页空白）：" + ", ".join(sorted(unlisted)))
print("  import 闭包 %d 个模块，全部在 SHELL 里" % len(seen))
PYCD

echo "✅ 版本与资源清单一致（v$app）"

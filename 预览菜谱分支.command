#!/bin/zsh
# Use an isolated seed inventory; never change the live data.json.
cd "$(dirname "$0")" || exit 1
export PORT="${PORT:-4570}"
if [[ "$PORT" == "4570" ]]; then
  # Only retire the known legacy preview. Never stop an unrelated service.
  legacy_dir="/Users/xianghuier/.copilot/repos/copilot-worktrees/demo5018/moonxiang1222-stunning-barnacle"
  listeners=("${(@f)$(lsof -nP -t -iTCP:4570 -sTCP:LISTEN 2>/dev/null)}")
  for pid in "${listeners[@]}"; do
    [[ -n "$pid" ]] || continue
    owner_dir="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    if [[ "$owner_dir" == "$PWD" ]]; then
      print -u2 "4570 已由本仓库的服务占用；请使用已打开的预览。"
      exit 1
    fi
    if [[ "$owner_dir" != "$legacy_dir" ]]; then
      print -u2 "4570 被其他服务占用（PID $pid，目录：${owner_dir:-未知}），未停止该服务。"
      exit 1
    fi
    print "正在停止旧 Copilot 目录的 4570 预览（PID $pid）；旧目录文件不会删除。"
    kill -TERM "$pid" || exit 1
  done
  for ((attempt=1; attempt<=25; attempt++)); do
    [[ -z "$(lsof -nP -t -iTCP:4570 -sTCP:LISTEN 2>/dev/null)" ]] && break
    sleep 0.2
  done
  if [[ -n "$(lsof -nP -t -iTCP:4570 -sTCP:LISTEN 2>/dev/null)" ]]; then
    print -u2 '旧服务尚未释放 4570；请检查占用后重试。'
    exit 1
  fi
fi
if [[ -z "$DATA_PATH" ]]; then
  preview_root="$(mktemp -d "${TMPDIR:-/tmp}/demo5018-recipe.XXXXXX")" || exit 1
  export DATA_PATH="$preview_root/data.json"
fi
print "项目：$PWD"
print "分支：$(git branch --show-current)"
print "隔离预览：http://127.0.0.1:$PORT"
print '停止服务：按 Control+C。若 4570 被其他服务占用，不会自动停止；可用 PORT=4571 指定其他端口。'
ruby server.rb

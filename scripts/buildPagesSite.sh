#!/usr/bin/env bash
# Builds the GitHub Pages site: the website at the root and the chat app under chat/.
# A ref of "." is the current checkout as it stands; an empty chat ref leaves chat/ out.
set -euo pipefail

if [[ $# -ne 3 || -z $1 || -z $3 ]]; then
  echo "usage: $0 <web-ref> <chat-ref-or-empty> <out-dir>" >&2
  exit 2
fi

web_ref=$1
chat_ref=$2
out_dir=$3
repo_root=$(git rev-parse --show-toplevel)
worktrees=()

remove_worktrees() {
  for dir in ${worktrees[@]+"${worktrees[@]}"}; do
    git -C "$repo_root" worktree remove --force "$dir" 2>/dev/null || rm -rf "$dir"
  done
}
trap remove_worktrees EXIT

fail() {
  echo "error: $*" >&2
  exit 1
}

check_out() {
  if [[ $1 == . ]]; then
    checkout_dir=$repo_root
  else
    checkout_dir=$(mktemp -d)
    worktrees+=("$checkout_dir")
    git -C "$repo_root" worktree add --detach --quiet "$checkout_dir" "$1"
  fi
}

# Neither build needs an install script; skipping them skips ffmpeg-static's download.
install() {
  [[ -d $1/node_modules ]] || (cd "$1" && npm ci --ignore-scripts)
}

require_build() {
  [[ -f $1/index.html ]] || fail "$2 build produced no $1/index.html"
}

build_website() {
  if [[ -f $1/web/package.json ]]; then
    install "$1/web"
    (cd "$1/web" && npm run build)
    website_dist=$1/web/dist
  else
    install "$1"
    (cd "$1" && npm run build --workspace apps/web)
    website_dist=$1/apps/web/dist
  fi
  require_build "$website_dist" website
}

build_chat() {
  [[ -f $1/apps/chat/package.json ]] || fail "$chat_ref has no apps/chat"
  install "$1"
  (cd "$1" && npm run build --workspace apps/chat)
  chat_dist=$1/apps/chat/dist
  require_build "$chat_dist" "chat app"
}

if [[ -e $out_dir && -n $(ls -A "$out_dir") ]]; then
  fail "$out_dir already exists and is not empty"
fi

check_out "$web_ref"
web_dir=$checkout_dir
build_website "$web_dir"
mkdir -p "$out_dir"
cp -R "$website_dist/." "$out_dir"

if [[ -n $chat_ref ]]; then
  if [[ $chat_ref == "$web_ref" ]]; then
    chat_dir=$web_dir
  else
    check_out "$chat_ref"
    chat_dir=$checkout_dir
  fi
  build_chat "$chat_dir"
  mkdir "$out_dir/chat"
  cp -R "$chat_dist/." "$out_dir/chat"
fi

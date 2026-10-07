#!/bin/sh
# Install (or remove) the DiffTD Git hooks in a project repository.
# Usage: hooks/install.sh <project-repo> [--uninstall]
# Existing hooks are preserved: a marked block is inserted right after the shebang line.
set -eu

DIFFTD_HOME=$(cd "$(dirname "$0")/.." && pwd)
repo=${1:-}
mode=${2:-install}
if [ -z "$repo" ] || [ ! -d "$repo" ]; then
  echo "usage: $0 <project-repo> [--uninstall]" >&2
  exit 2
fi
repo=$(cd "$repo" && pwd)
hooks_dir=$(cd "$repo" && git rev-parse --git-path hooks) || { echo "$repo is not a Git repository" >&2; exit 1; }
case "$hooks_dir" in /*) ;; *) hooks_dir="$repo/$hooks_dir" ;; esac
mkdir -p "$hooks_dir"

BEGIN='# >>> difftd >>>'
END='# <<< difftd <<<'

strip_block() {
  awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1;next} $0==e{skip=0;next} !skip{print}' "$1"
}

for name in post-checkout post-merge post-rewrite; do
  file="$hooks_dir/$name"
  block="$BEGIN
\"$DIFFTD_HOME/hooks/$name\" \"\$@\" || true
$END"
  if [ "$mode" = "--uninstall" ]; then
    [ -f "$file" ] || continue
    strip_block "$file" > "$file.tmp"
    if [ "$(grep -cv '^[[:space:]]*$' "$file.tmp" | tr -d ' ')" -le 1 ] && { [ ! -s "$file.tmp" ] || head -n 1 "$file.tmp" | grep -q '^#!'; }; then
      rm -f "$file" "$file.tmp"
    else
      mv "$file.tmp" "$file"
      chmod +x "$file"
    fi
    continue
  fi
  if [ -f "$file" ]; then
    strip_block "$file" > "$file.tmp"
  else
    printf '#!/bin/sh\n' > "$file.tmp"
  fi
  if head -n 1 "$file.tmp" | grep -q '^#!'; then
    { head -n 1 "$file.tmp"; printf '%s\n' "$block"; tail -n +2 "$file.tmp"; } > "$file.new"
  else
    { printf '%s\n' "$block"; cat "$file.tmp"; } > "$file.new"
  fi
  rm -f "$file.tmp"
  mv "$file.new" "$file"
  chmod +x "$file"
done

if [ "$mode" != "--uninstall" ]; then
  gitignore="$repo/.gitignore"
  if ! { [ -f "$gitignore" ] && grep -qx '\.difftd/' "$gitignore"; }; then
    printf '.difftd/\n' >> "$gitignore"
  fi
  echo "DiffTD hooks installed in $hooks_dir"
else
  echo "DiffTD hooks removed from $hooks_dir"
fi

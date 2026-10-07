# Shared by the DiffTD Git hooks (sourced, POSIX sh). See specs/001-td-version-control/contracts/git-hooks.md
# A hook must never make the Git operation fail, so everything here returns 0.

difftd_cfg_str() {
  [ -f "$DIFFTD_CONFIG" ] || return 0
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$DIFFTD_CONFIG" | head -n 1
}

difftd_cfg_num() {
  [ -f "$DIFFTD_CONFIG" ] || return 0
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" "$DIFFTD_CONFIG" | head -n 1
}

# difftd_reload <source> <old-rev> <new-rev>
difftd_reload() {
  source_name=$1
  old=$2
  new=$3
  top=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
  cd "$top" || return 0
  DIFFTD_CONFIG="$top/difftd.config.json"
  snap_dir=$(difftd_cfg_str snapshotDir)
  port=$(difftd_cfg_num reloadPort)
  : "${snap_dir:=snapshots}"
  : "${port:=9980}"

  changed=$(git -c core.quotepath=false diff --name-only "$old" "$new" -- "$snap_dir" 2>/dev/null) || return 0
  [ -n "$changed" ] || return 0

  list=""
  while IFS= read -r file; do
    case "$file" in
      *'"'* | *'\'*) continue ;;
      "$snap_dir"/*.json) ;;
      *) continue ;;
    esac
    if [ -z "$list" ]; then list="\"$file\""; else list="$list,\"$file\""; fi
  done <<EOF_FILES
$changed
EOF_FILES
  [ -n "$list" ] || return 0

  if ! command -v curl >/dev/null 2>&1; then
    echo "DiffTD: curl not found, skipped reload." >&2
    return 0
  fi
  body="{\"files\":[$list],\"source\":\"$source_name\"}"
  if ! response=$(curl --silent --show-error --max-time 15 -X POST \
      -H 'Content-Type: application/json' -d "$body" "http://127.0.0.1:$port/reload" 2>/dev/null); then
    echo "DiffTD: TouchDesigner not reachable, skipped reload." >&2
    return 0
  fi
  case "$response" in
    '{'*) ;;
    *) echo "DiffTD: unexpected answer from TouchDesigner, see .difftd/log.txt." >&2; return 0 ;;
  esac
  case "$response" in
    *'"errors": []'*) ;;
    *) echo "DiffTD: reload finished with errors, see .difftd/log.txt." >&2 ;;
  esac
  case "$response" in
    *'"backups": []'*) ;;
    *) echo "DiffTD: unsaved edits were backed up under .difftd/backups/." >&2 ;;
  esac
  return 0
}

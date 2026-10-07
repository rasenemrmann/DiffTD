#!/bin/sh
# Hook tests against throwaway repositories and a stub reload server.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PORT=${DIFFTD_TEST_PORT:-18980}
TMP=$(mktemp -d)
FAILS=0
SERVER_PID=""

cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

ok() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILS=$((FAILS + 1)); }
check() { # check <name> <command...>
  name=$1; shift
  if "$@"; then ok "$name"; else fail "$name"; fi
}
requests() { [ -f "$TMP/requests.log" ] && wc -l < "$TMP/requests.log" | tr -d ' ' || echo 0; }
last_request() { tail -n 1 "$TMP/requests.log"; }
g() { git -c user.name=T -c user.email=t@example.com -c commit.gpgsign=false "$@"; }

start_server() {
  python3 "$HERE/stub_server.py" "$PORT" "$TMP/requests.log" "$TMP/response.json" &
  SERVER_PID=$!
  i=0
  while ! curl -s -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
}
stop_server() { kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; SERVER_PID=""; }

REPO="$TMP/repo"
mkdir -p "$REPO/snapshots/p" && cd "$REPO" || exit 1
g init -q -b main
printf '{"reloadPort": %s}\n' "$PORT" > difftd.config.json
echo a > snapshots/p/a.json; echo b > snapshots/p/b.json; echo readme > README.md
g add -A && g commit -q -m base

start_server
sh "$ROOT/hooks/install.sh" "$REPO" >/dev/null
check "hooks installed with marker" grep -q '>>> difftd >>>' .git/hooks/post-merge
sh "$ROOT/hooks/install.sh" "$REPO" >/dev/null
check "install is idempotent" test "$(grep -c '>>> difftd >>>' .git/hooks/post-checkout)" = 1
check ".gitignore has .difftd/" grep -qx '\.difftd/' .gitignore
g add -A && g commit -q -m gitignore

# --- post-checkout
g checkout -q -b x
echo a2 > snapshots/p/a.json; echo readme2 > README.md
g commit -qam "change a"
before=$(requests)
g checkout -q main
check "checkout sends one request" test "$(requests)" = "$((before + 1))"
check "request lists only the changed snapshot" sh -c "last=\$(tail -n 1 '$TMP/requests.log'); case \"\$last\" in *'\"files\":[\"snapshots/p/a.json\"]'*) exit 0;; *) exit 1;; esac"
check "request uses JSON content type and /reload" sh -c "tail -n 1 '$TMP/requests.log' | grep -q '^/reload application/json '"
check "source is post-checkout" sh -c "tail -n 1 '$TMP/requests.log' | grep -q 'post-checkout'"

g checkout -q -b y
echo r3 > README.md; g commit -qam "readme only"
before=$(requests)
g checkout -q main
check "no snapshot change sends no request" test "$(requests)" = "$before"

before=$(requests)
g checkout -q x -- snapshots/p/a.json
check "file checkout sends no request" test "$(requests)" = "$before"
g checkout -q main -- snapshots/p/a.json

# --- post-merge
before=$(requests)
g merge -q --no-edit x >/dev/null 2>&1
check "merge sends a request" test "$(requests)" = "$((before + 1))"
check "source is post-merge" sh -c "tail -n 1 '$TMP/requests.log' | grep -q 'post-merge'"

# --- post-rewrite (rebase)
g checkout -q -b z
echo b2 > snapshots/p/b.json; g commit -qam "change b"
g checkout -q main
echo a-main > snapshots/p/a.json; g commit -qam "main moves"
g checkout -q z
before=$(requests)
g rebase main >/dev/null 2>&1
check "rebase sends a request" test "$(requests)" -gt "$before"
check "source is post-rewrite" sh -c "grep -q 'post-rewrite' '$TMP/requests.log'"

# --- errors and backups reported, exit stays 0
printf '{"errors": [{"file": "x", "message": "bad"}], "backups": [{"root": "/p/a", "file": "f"}]}' > "$TMP/response.json"
g checkout -q main
g checkout -q -b w
echo a3 > snapshots/p/a.json; g commit -qam "a3"
out=$(g checkout main 2>&1); code=$?
check "checkout still succeeds" test "$code" = 0
check "errors are reported" sh -c "echo '$out' | grep -q 'finished with errors'"
check "backups are reported" sh -c "echo '$out' | grep -q 'backed up'"
rm -f "$TMP/response.json"

# --- server down
stop_server
g checkout -q w
out=$(g checkout main 2>&1); code=$?
check "checkout succeeds when TouchDesigner is down" test "$code" = 0
check "notice printed when unreachable" sh -c "echo '$out' | grep -q 'not reachable'"

# --- existing hook preserved, uninstall removes only our block
REPO2="$TMP/repo2"
mkdir -p "$REPO2/snapshots/p" && cd "$REPO2" || exit 1
g init -q -b main
printf '#!/bin/sh\ntouch "%s/custom-ran"\n' "$TMP" > .git/hooks/post-merge
chmod +x .git/hooks/post-merge
echo a > snapshots/p/a.json; g add -A; g commit -q -m base
sh "$ROOT/hooks/install.sh" "$REPO2" >/dev/null
check "existing hook content kept after install" grep -q 'custom-ran' .git/hooks/post-merge
check "marker block follows the shebang" sh -c "sed -n 2p .git/hooks/post-merge | grep -q '>>> difftd >>>'"
g checkout -q -b f; echo a2 > snapshots/p/a.json; g commit -qam f; g checkout -q main
g merge -q --no-edit f >/dev/null 2>&1
check "existing hook still runs" test -f "$TMP/custom-ran"
sh "$ROOT/hooks/install.sh" "$REPO2" --uninstall >/dev/null
check "uninstall keeps the foreign hook" grep -q 'custom-ran' .git/hooks/post-merge
check "uninstall removes our block" sh -c "! grep -q difftd .git/hooks/post-merge"
check "uninstall deletes hooks we created" test ! -e .git/hooks/post-checkout

echo
if [ "$FAILS" -eq 0 ]; then echo "all hook tests passed"; exit 0; else echo "$FAILS hook test(s) failed"; exit 1; fi

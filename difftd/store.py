"""File-system side of DiffTD: atomic snapshot writes, last-export hashes, log, backups."""

import json
import os
import tempfile
import time
from pathlib import Path

STATE_DIR = ".difftd"


class Store:
    def __init__(self, repo_root):
        self.repo_root = Path(repo_root)
        self.state_dir = self.repo_root / STATE_DIR

    # -- snapshot files
    def write_text(self, rel_path, text):
        """Atomically write text to repo_root/rel_path. Returns False if content is unchanged."""
        target = self.repo_root / rel_path
        data = text.encode("utf-8")
        if target.is_file() and target.read_bytes() == data:
            return False
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".tmp-", suffix=".json")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.replace(tmp, target)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        return True

    def read_text(self, rel_path):
        return (self.repo_root / rel_path).read_text(encoding="utf-8")

    # -- last-export hashes
    @property
    def _hash_file(self):
        return self.state_dir / "last-export.json"

    def _read_hashes(self):
        try:
            return json.loads(self._hash_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def get_hash(self, root_path):
        return self._read_hashes().get(root_path)

    def set_hash(self, root_path, digest):
        hashes = self._read_hashes()
        hashes[root_path] = digest
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.write_text(f"{STATE_DIR}/last-export.json", json.dumps(hashes, indent=2, sort_keys=True) + "\n")

    # -- backups
    def backup(self, stamp, root_name, text):
        """Write text to .difftd/backups/<stamp>/<root_name>.json; returns the relative path."""
        rel = f"{STATE_DIR}/backups/{stamp}/{root_name}.json"
        self.write_text(rel, text)
        return rel

    @staticmethod
    def stamp():
        return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())

    # -- log
    def log(self, message):
        try:
            self.state_dir.mkdir(parents=True, exist_ok=True)
            with open(self.state_dir / "log.txt", "a", encoding="utf-8") as handle:
                handle.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {message}\n")
        except OSError:
            pass

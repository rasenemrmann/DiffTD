"""Command line: `python3 -m difftd convert|serve ...`."""

import argparse
import json
import sys
from pathlib import Path

from . import snapshot as S
from . import toe


def cmd_convert(args):
    roots = toe.convert(args.file, args.toeexpand)
    if args.root is None:
        args.root = "project1" if "project1" in roots else next(iter(roots))
    if args.root not in roots:
        sys.exit(f"no top-level node '{args.root}'. Available: {', '.join(roots)}")
    text = S.serialize(roots[args.root])
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
        print(f"wrote {args.output} ({len(roots[args.root]['nodes'])} nodes, root {args.root})")
    else:
        sys.stdout.write(text)


def cmd_serve(args):
    from .server import serve

    serve(args.folder, args.port, args.open, args.toeexpand)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="difftd", description="Compare TouchDesigner project versions")
    parser.add_argument("--toeexpand", help="path to TouchDesigner's toeexpand (auto-detected by default)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("convert", help="convert a .toe/.tox to a snapshot JSON (for the viewer's Two files mode)")
    p.add_argument("file")
    p.add_argument("--root", help="top-level node to export (default: project1)")
    p.add_argument("-o", "--output")
    p.set_defaults(func=cmd_convert)

    p = sub.add_parser("serve", help="open the comparison GUI (optionally for a folder of .toe versions)")
    p.add_argument("folder", nargs="?", default=None, help="optional: folder with .toe/.tox versions; otherwise import them in the page")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--open", action="store_true", help="open the browser")
    p.set_defaults(func=cmd_serve)

    args = parser.parse_args(argv)
    try:
        args.func(args)
    except toe.ToeError as exc:
        sys.exit(f"difftd: {exc}")


if __name__ == "__main__":
    main()

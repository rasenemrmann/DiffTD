"""Run inside TouchDesigner (paste into a Text DAT and run, or `exec(op('probe').text)`).

Checks each TD API item DiffTD relies on (research.md R1/R2) and prints OK/FAIL per item.
Pass a COMP path to probe, e.g. probe('/project1/geo1'); defaults to a scratch COMP.
"""


def probe(sample_path=None):
    import td

    results = []

    def check(name, fn):
        try:
            detail = fn()
            results.append((True, name, detail))
        except Exception as exc:  # noqa: BLE001
            results.append((False, name, repr(exc)))

    scratch = None
    if sample_path:
        comp = td.op(sample_path)
    else:
        parent = td.op("/project1") or td.op("/")
        scratch = parent.create(td.baseCOMP, "difftd_probe")
        comp = scratch
        chop = comp.create(td.waveCHOP, "wave1")
        math = comp.create(td.mathCHOP, "math1")
        math.inputConnectors[0].connect(chop.outputConnectors[0])
        text = comp.create(td.textDAT, "text1")
        text.text = "a\nb"
        table = comp.create(td.tableDAT, "table1")
        table.appendRow(["x", "1"])

    try:
        check("COMP.findChildren() returns descendants", lambda: len(comp.findChildren()))
        some = comp.findChildren()[0] if comp.findChildren() else comp
        check("OP.OPType is a string like 'waveCHOP'", lambda: str(some.OPType))
        check("OP.path / OP.name / OP.isCOMP", lambda: (some.path, some.name, some.isCOMP))
        check("OP.pars() lists Par objects", lambda: len(some.pars()))
        par = some.pars()[0] if some.pars() else None
        if par is not None:
            check("Par.name / Par.val / Par.default", lambda: (par.name, par.val, par.default))
            check("Par.mode stringifies as 'ParMode.CONSTANT'", lambda: str(par.mode))
            check("Par.expr / Par.bindExpr readable", lambda: (par.expr, par.bindExpr))
            check("Par.isPulse / Par.readOnly readable", lambda: (par.isPulse, par.readOnly))
            check("Par.exportSource attribute", lambda: hasattr(par, "exportSource"))
        check("td.ParMode has CONSTANT/EXPRESSION/BIND/EXPORT",
              lambda: [td.ParMode.CONSTANT, td.ParMode.EXPRESSION, td.ParMode.BIND, td.ParMode.EXPORT])
        check("inputConnectors / outputConnectors / .connections / .owner / .index",
              lambda: [(c.index, [x.owner.path for x in c.connections]) for o in comp.findChildren() for c in o.inputConnectors])
        check("COMP.create(td.<type>, name) and OP.destroy()", lambda: _create_destroy(td, comp))
        check("getattr(td, 'waveCHOP') resolves operator class", lambda: getattr(td, "waveCHOP"))
        check("textDAT.text readable/writable", lambda: _text_roundtrip(td, comp))
        check("tableDAT.rows() / clear() / appendRow()", lambda: _table_roundtrip(td, comp))
        check("project.folder / project.name", lambda: (td.project.folder, td.project.name))
        check("ui.status settable", lambda: setattr(td.ui, "status", "DiffTD probe"))
        check("Connector.connect() accepts an output connector", lambda: _connect(td, comp))
        check("op.TDModules.mod.TDJSON available", lambda: hasattr(td.op.TDModules.mod, "TDJSON"))
        check("TDJSON.opToJSONOp exists", lambda: callable(getattr(td.op.TDModules.mod.TDJSON, "opToJSONOp", None)))
    finally:
        if scratch is not None:
            scratch.destroy()

    for ok, name, detail in results:
        print(("OK   " if ok else "FAIL ") + name + "  ->  " + str(detail)[:120])
    failed = [r for r in results if not r[0]]
    print(f"\n{len(results) - len(failed)} OK, {len(failed)} FAIL")
    return results


def _create_destroy(td, comp):
    tmp = comp.create(td.constantCHOP, "difftd_tmp")
    name = tmp.name
    tmp.destroy()
    return name


def _text_roundtrip(td, comp):
    dat = comp.create(td.textDAT, "difftd_tmp_text")
    dat.text = "a\nb\n"
    value = dat.text
    dat.destroy()
    return repr(value)


def _table_roundtrip(td, comp):
    dat = comp.create(td.tableDAT, "difftd_tmp_table")
    dat.clear()
    dat.appendRow(["a", "b"])
    rows = [[c.val for c in r] for r in dat.rows()]
    dat.destroy()
    return rows


def _connect(td, comp):
    a = comp.create(td.constantCHOP, "difftd_tmp_a")
    b = comp.create(td.nullCHOP, "difftd_tmp_b")
    b.inputConnectors[0].connect(a.outputConnectors[0])
    n = len(b.inputConnectors[0].connections)
    a.destroy()
    b.destroy()
    return n


if __name__ == "__main__":
    probe()

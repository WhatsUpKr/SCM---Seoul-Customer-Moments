"""Bundle the replay page into one self-contained HTML file.

docs/ is a no-build page: index.html + styles.css + ES modules + data.json.
This script inlines all of it into dist/seoul-customer-moments.html, which
opens from disk, attaches to an email, or publishes as a single-page artifact.
Standard library only. It understands the import/export style used in docs/js
(named imports and exports), nothing more.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
IMPORT = re.compile(r'^import\s+\{([^}]*)\}\s+from\s+"\./(\w+)\.js";\s*$', re.M)
EXPORT = re.compile(r"^export\s+(?:async\s+)?(?:function|const|let|class)\s+([\w$]+)", re.M)


def load(name, seen, order):
    """Depth-first over imports, so every module comes after the ones it needs."""
    if name in seen:
        return
    seen.add(name)
    src = (DOCS / "js" / f"{name}.js").read_text()
    for _, dep in IMPORT.findall(src):
        load(dep, seen, order)
    order.append((name, src))


def module(name, src):
    exports = EXPORT.findall(src)

    def imports(m):
        names = ", ".join(part.strip().replace(" as ", ": ") for part in m.group(1).split(",") if part.strip())
        return f"const {{ {names} }} = __{m.group(2)};"

    body = re.sub(r"^export\s+", "", IMPORT.sub(imports, src), flags=re.M)
    if re.search(r"^\s*(import|export)\s", body, flags=re.M):
        sys.exit(f"bundle: {name}.js uses an import or export form this script does not handle")
    return f"const __{name} = (() => {{\n{body}\nreturn {{ {', '.join(exports)} }};\n}})();\n"


def bundle() -> str:
    order = []
    load("main", set(), order)
    js = "\n".join(module(n, s) for n, s in order)
    html = (DOCS / "index.html").read_text()
    data = json.dumps(json.loads((DOCS / "data.json").read_text()), ensure_ascii=False).replace("</", "<\\/")
    html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + (DOCS / "styles.css").read_text() + "</style>")
    html = html.replace('<script id="scm-data" type="application/json"></script>',
                        '<script id="scm-data" type="application/json">' + data + "</script>")
    html = html.replace('<script type="module" src="js/main.js"></script>',
                        "<script>\n(async () => {\n\"use strict\";\n" + js.replace("</script", "<\\/script") + "})();\n</script>")
    if "styles.css" in html or 'src="js/main.js"' in html or 'type="application/json"></script>' in html:
        sys.exit("bundle: a placeholder in docs/index.html was not found")
    return html


if __name__ == "__main__":
    out = ROOT / "dist"
    out.mkdir(exist_ok=True)
    target = out / "seoul-customer-moments.html"
    target.write_text(bundle())
    print(f"{target.relative_to(ROOT)}: {target.stat().st_size // 1024} KB, one file")

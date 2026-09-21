#!/usr/bin/env python3
"""Create a self-contained HTML preview and the separate-repository source ZIP."""
import base64
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
args.output.mkdir(parents=True, exist_ok=True)
html = (root / 'index.html').read_text()
data = (root / 'data.js').read_text().replace('export ', '')
viewer = '\n'.join((root / 'viewer.js').read_text().splitlines()[1:])
for path in (root / 'assets').glob('*.svg'):
    url = 'data:image/svg+xml;base64,' + base64.b64encode(path.read_bytes()).decode()
    data = data.replace("'assets/" + path.name + "'", "'" + url + "'")
viewer = viewer.replace("setTool('pan');repositoryData();", "setTool('pan');sample();")
css = (root / 'viewer.css').read_text()
html = html.replace('<link rel="stylesheet" href="viewer.css">', '<style>' + css + '</style>')
html = html.replace('<script type="module" src="viewer.js"></script>', '')
html = html.replace('</body>', '<script>' + data + '\n' + viewer + '</script></body>')
standalone = args.output / 'ShuntView-standalone.html'
standalone.write_text(html, encoding='utf-8')
archive = args.output / 'shunt-viewer.zip'
with ZipFile(archive, 'w', ZIP_DEFLATED) as package:
    for path in sorted(root.rglob('*')):
        if not path.is_file() or any(part in {'.git','__pycache__','node_modules','_site'} for part in path.parts):
            continue
        package.write(path, 'shunt-viewer/' + path.relative_to(root).as_posix())
    package.write(standalone, 'shunt-viewer/ShuntView-standalone.html')
print(standalone)
print(archive)

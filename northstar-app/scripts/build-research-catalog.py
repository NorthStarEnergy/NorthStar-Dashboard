"""Build the browser catalogue from reviewed research snapshots; no external fetches."""
from pathlib import Path
import base64
import hashlib
import json
import mimetypes

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / 'research'

def main():
    catalog = json.loads((RESEARCH / 'catalog.json').read_text(encoding='utf-8'))
    for project in catalog['projects']:
        for item in project['files']:
            path = (RESEARCH / 'projects' / project['id'] / item['name']).resolve()
            if not path.is_relative_to((RESEARCH / 'projects' / project['id']).resolve()):
                raise ValueError('Research file is outside its project')
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != item['sourceSha256']:
                raise ValueError(f'Research source hash does not match: {path.name}')
            item.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
                        mime=mimetypes.guess_type(path.name)[0] or 'application/octet-stream',
                        base64=base64.b64encode(data).decode('ascii'))
            if path.suffix in {'.md', '.txt', '.csv', '.json'}:
                item['text'] = data.decode('utf-8-sig')
    (RESEARCH / 'catalog.js').write_text('window.NorthstarResearchCatalog = ' + json.dumps(catalog, ensure_ascii=True) + ';\n', encoding='utf-8')
    print(f"Built {len(catalog['projects'])} projects, {sum(len(p['files']) for p in catalog['projects'])} files")

if __name__ == '__main__':
    main()

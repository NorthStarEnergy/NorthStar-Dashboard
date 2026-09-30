"""Local controlled intake. Imports always remain pending human review."""
import argparse
import csv
import base64
import getpass
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import northstar_operator_knowledge as knowledge

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('command', choices=['status', 'bootstrap', 'import'])
parser.add_argument('--manifest', type=Path, help='UTF-8 CSV: title,file,siteId,sourceKey,revision,owner')
args = parser.parse_args()
actor = 'local-import:' + getpass.getuser()
if args.command == 'import':
    if not args.manifest: parser.error('--manifest is required')
    manifest = args.manifest.resolve()
    with manifest.open(encoding='utf-8-sig', newline='') as stream:
        rows = list(csv.DictReader(stream))
    prepared = []
    for number, row in enumerate(rows, 2):
        file = (manifest.parent / row.get('file', '')).resolve()
        if not file.is_file() or file.suffix.lower() not in knowledge.SUFFIXES or not 0 < file.stat().st_size <= knowledge.MAX_BYTES:
            raise SystemExit(f'Row {number}: missing, unsupported or oversized file')
        if not all(row.get(field, '').strip() for field in ('title','sourceKey','revision')):
            raise SystemExit(f'Row {number}: title, sourceKey and revision are required')
        knowledge.access(actor, row.get('siteId', ''))
        prepared.append((row, file))
    results = []
    for row, file in prepared:
        source = knowledge.upload(row | {'filename':file.name, 'contentBase64':base64.b64encode(file.read_bytes()).decode()}, actor)
        results.append({'id':source['id'], 'title':source['title'], 'status':source['status'], 'deduplicated':source.get('deduplicated', False)})
    print(json.dumps(results, indent=2))
else:
    print(json.dumps(knowledge.bootstrap() if args.command == 'bootstrap' else knowledge.status(actor), indent=2))

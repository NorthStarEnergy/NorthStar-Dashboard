"""Explicit live inference smoke test using only a synthetic circuit and temporary DB."""
import io
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if "--live" not in sys.argv:
    raise SystemExit("Pass --live to run the authorized OpenAI inference smoke test")

from PIL import Image, ImageDraw, ImageFont
import northstar_store as store
import northstar_uwpc_desk as desk

image = Image.new("RGB", (1000, 420), "white")
draw = ImageDraw.Draw(image)
font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 24)
draw.text((35, 25), "SYNTHETIC TEST CIRCUIT - NOT PLANT DATA - REV TEST-1", fill="black", font=font)
draw.text((70, 120), "BUS-A", fill="black", font=font)
draw.line((150, 170, 150, 290), fill="black", width=7)
draw.line((150, 230, 415, 230), fill="black", width=4)
draw.rectangle((415, 200, 465, 260), outline="black", width=4)
draw.text((385, 155), "CB-TEST", fill="black", font=font)
draw.line((465, 230, 800, 230), fill="black", width=4)
draw.text((730, 175), "LOAD-Z", fill="black", font=font)
draw.text((35, 345), "Equipment positions / isolation / grounding: NOT SPECIFIED", fill="black", font=font)
buffer = io.BytesIO(); image.save(buffer, format="PNG")
output = Path(__file__).resolve().parents[1] / "outputs" / "UWPC"
output.mkdir(parents=True, exist_ok=True)
(output / "synthetic-circuit.png").write_bytes(buffer.getvalue())
with tempfile.TemporaryDirectory(prefix="uwpc-live-smoke-") as temporary:
    store.DB_PATH = Path(temporary) / "test.db"
    store.init_db()
    row = desk.create({"title": "Synthetic supporting guarantee review", "site": "TEST ONLY", "asset": "CB-TEST",
                       "scope": "Prepare a draft request for supporting guarantee review from the supplied synthetic circuit. Identify missing information; do not provide switching steps.",
                       "kind": "REQUEST_GUARANTEE", "template": "pc2-sg", "diagramRevision": "TEST-1", "authority": "TEST controller"}, "fixture_author")
    row = desk.add_source(row["id"], row["version"], "synthetic-circuit.png", "diagram", buffer.getvalue(), "fixture_author")
    row = desk.generate(row["id"], {"version": row["version"]}, "fixture_author")
    text = row["generation"]["text"]
    assert "CB-TEST" in text and "TEST-1" in text
    assert row["sources"][0]["id"] in text
    assert row["status"] == "GENERATED" and row["review"] is None
    (output / "synthetic-generated-proposal.txt").write_text(text, encoding="utf-8")
    print(json.dumps({"result": "PASS", "model": row["generation"]["model"], "status": row["status"],
                      "sourceCitationPresent": True, "documentCharacters": len(text), "liveOperationalWrites": 0}))

"""Editable presentation sheets stored with each outage form revision."""
import base64
import io
import re

FONTS = {"Arial": "Helvetica", "Georgia": "Times-Roman", "Courier New": "Courier"}


def validate(layout):
    if not isinstance(layout, dict):
        raise ValueError("Invalid form layout")
    rows = layout.get("rows")
    if not isinstance(rows, list) or len(rows) > 120:
        raise ValueError("Use at most 120 form rows")
    result = []
    for row in rows:
        if not isinstance(row, dict) or row.get("font") not in FONTS or row.get("size") not in range(8, 33):
            raise ValueError("Invalid form row formatting")
        if any(not isinstance(row.get(k), str) or len(row[k]) > n for k, n in (("label", 180), ("text", 4000))):
            raise ValueError("Form row text is too long")
        result.append({k: row[k] for k in ("label", "text", "font", "size")})
    photo = layout.get("photo", "")
    if not isinstance(photo, str) or len(photo) > 450000:
        raise ValueError("Photo is too large")
    if photo:
        from PIL import Image
        try:
            raw = base64.b64decode(photo, validate=True)
            with Image.open(io.BytesIO(raw)) as im:
                if im.format != "JPEG" or max(im.size) > 1200:
                    raise ValueError()
                im.load()
        except Exception as exc:
            raise ValueError("Use a JPEG photo up to 1200 pixels wide or tall") from exc
    return {"rows": result, "photo": photo}


def pdf(original, layout):
    from html import escape
    from pypdf import PdfReader, PdfWriter
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer
    buffer = io.BytesIO()
    story = []
    for row in layout["rows"]:
        style = ParagraphStyle("row", fontName=FONTS[row["font"]], fontSize=row["size"], leading=row["size"] * 1.25)
        for key in ("label", "text"):
            story.append(Paragraph(escape(row[key]).replace("\n", "<br/>"), style))
        story.append(Spacer(1, 8))
    if layout["photo"]:
        picture = Image(io.BytesIO(base64.b64decode(layout["photo"])))
        picture._restrictSize(420, 480)
        story.append(picture)
    SimpleDocTemplate(buffer).build(story)
    writer = PdfWriter()
    for source in (buffer, io.BytesIO(original)):
        writer.append(PdfReader(source))
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def xlsx(original, layout):
    from openpyxl import load_workbook
    from openpyxl.drawing.image import Image
    from openpyxl.styles import Alignment, Font
    wb = load_workbook(io.BytesIO(original))
    sheet = wb.create_sheet("Edited form", 0)
    wb.active = 0
    sheet.column_dimensions["A"].width = 34
    sheet.column_dimensions["B"].width = 84
    for n, row in enumerate(layout["rows"], 1):
        for col, key in enumerate(("label", "text"), 1):
            cell = sheet.cell(n, col, row[key])
            cell.data_type = "s"
            cell.font = Font(name=row["font"], size=row["size"])
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    if layout["photo"]:
        picture = Image(io.BytesIO(base64.b64decode(layout["photo"])))
        sheet.add_image(picture, f"A{len(layout['rows']) + 2}")
    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()

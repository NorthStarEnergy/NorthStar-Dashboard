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
        if "formatting" in row:
            fmt = row["formatting"]
            if not isinstance(fmt, dict):
                raise ValueError("Invalid row formatting")
            colors = {k: fmt.get(k) for k in ("color", "fill")}
            if any(not isinstance(v, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", v) for v in colors.values()):
                raise ValueError("Invalid row color")
            inset = fmt.get("inset")
            if type(inset) is not int or not 0 <= inset <= 160 or fmt.get("border") not in ("none", "line", "box"):
                raise ValueError("Invalid row border")
            style = {**colors, "inset": inset, "border": fmt["border"]}
            if fmt.get("image"):
                style["image"] = validate_photo(fmt["image"])
            result[-1]["formatting"] = style
    photo = validate_photo(layout.get("photo", ""))
    if len(photo) + sum(len(row.get("formatting", {}).get("image", "")) for row in result) > 1500000:
        raise ValueError("Reduce the number or size of images")
    return {"rows": result, "photo": photo}


def validate_photo(photo):
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
    return photo


def pdf(original, layout):
    from html import escape
    from pypdf import PdfReader, PdfWriter
    from reportlab.lib.colors import HexColor
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer
    buffer = io.BytesIO()
    story = []
    for row in layout["rows"]:
        style = ParagraphStyle("row", fontName=FONTS[row["font"]], fontSize=row["size"], leading=row["size"] * 1.25)
        fmt = row.get("formatting", {})
        if fmt:
            style.textColor = HexColor(fmt["color"])
            from reportlab.platypus import Table, TableStyle
            content = [Paragraph(escape(row[k]).replace("\n", "<br/>"), style) for k in ("label", "text")]
            indent = fmt["inset"] * 0.75
            if fmt.get("image"):
                picture = Image(io.BytesIO(base64.b64decode(fmt["image"])))
                picture._restrictSize(410 - indent, 180)
                content.append(picture)
            table = Table([[content]], colWidths=[420 - indent], hAlign="RIGHT", splitInRow=1)
            commands = [("BACKGROUND", (0, 0), (-1, -1), HexColor(fmt["fill"]))]
            if fmt["border"] != "none":
                commands.append(("BOX" if fmt["border"] == "box" else "LINEBELOW", (0, 0), (-1, -1), 1, style.textColor))
            table.setStyle(TableStyle(commands))
            story.extend([table, Spacer(1, 8)])
            continue
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
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
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
            fmt = row.get("formatting")
            cell.alignment = Alignment(wrap_text=True, vertical="top", indent=fmt["inset"] / 12 if fmt else 0)
            if fmt:
                cell.font = Font(name=row["font"], size=row["size"], color=fmt["color"][1:])
                cell.fill = PatternFill("solid", fgColor=fmt["fill"][1:])
                edge = Side(style="thin", color=fmt["color"][1:])
                if fmt["border"] == "box":
                    cell.border = Border(top=edge, bottom=edge, left=edge if col == 1 else None, right=edge if col == 2 else None)
                elif fmt["border"] == "line":
                    cell.border = Border(bottom=edge)
        if row.get("formatting", {}).get("image"):
            picture = Image(io.BytesIO(base64.b64decode(row["formatting"]["image"])))
            scale = min(1, 240 / max(picture.width, picture.height))
            picture.width *= scale
            picture.height *= scale
            sheet.add_image(picture, f"C{n}")
            sheet.row_dimensions[n].height = picture.height * 0.75 + 4
    if layout["photo"]:
        picture = Image(io.BytesIO(base64.b64decode(layout["photo"])))
        sheet.add_image(picture, f"A{len(layout['rows']) + 2}")
    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()

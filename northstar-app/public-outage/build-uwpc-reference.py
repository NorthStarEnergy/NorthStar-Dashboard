"""Build visitor reference files from NorthStar's blank draft templates."""
import base64
import io
import json
from pathlib import Path
import sys
from xml.sax.saxutils import escape

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import northstar_outage_manager as manager
import northstar_uwpc_templates as templates


def pdf(title, description, lines, worksheet=False):
    output = io.BytesIO()
    doc = SimpleDocTemplate(output, pagesize=letter, title=title, author="NorthStar", leftMargin=36, rightMargin=36)
    styles = getSampleStyleSheet()
    flow = [Paragraph("NORTHSTAR  /  UWPC REFERENCE", styles["Heading3"]),
            Paragraph(escape(title), styles["Title"]), Paragraph(escape(description), styles["BodyText"]), Spacer(1, 12)]
    if worksheet:
        rows = [[Paragraph(escape(line), styles["BodyText"]), ""] for line in lines]
        table = Table(rows, colWidths=[206, 334], hAlign="LEFT", splitByRow=1)
        table.setStyle(TableStyle([("GRID",(0,0),(-1,-1),0.45,colors.HexColor("#acbfc2")),
                                   ("BACKGROUND",(0,0),(0,-1),colors.HexColor("#edf4f3")),
                                   ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),6)]))
        flow.append(table)
    else:
        flow.extend(Paragraph(escape(line), styles["BodyText"]) for line in lines)
    def footer(canvas, _doc):
        canvas.setFont("Helvetica", 8)
        canvas.drawString(36, 28, "NorthStar reference worksheet  |  For planning and training")
        canvas.drawRightString(576, 28, str(canvas.getPageNumber()))
    doc.build(flow,onFirstPage=footer,onLaterPages=footer)
    return output.getvalue()


def excel(title, description, fields):
    book=Workbook()
    sheet=book.active
    sheet.title="Worksheet"
    sheet.append([title]);sheet.merge_cells("A1:B1")
    sheet["A1"].font=Font(bold=True,color="FFFFFF",size=15)
    sheet["A1"].fill=PatternFill("solid",fgColor="205557")
    sheet.row_dimensions[1].height=26
    sheet.append([description]);sheet.merge_cells("A2:B2")
    sheet["A2"].alignment=Alignment(wrap_text=True,vertical="center");sheet.row_dimensions[2].height=45
    sheet.append(["Field","Entry"])
    for field in fields:sheet.append([field,""])
    sheet.column_dimensions["A"].width=43;sheet.column_dimensions["B"].width=62
    sheet.freeze_panes="B4";sheet.sheet_view.showGridLines=True
    for i in range(3,sheet.max_row+1):
        sheet.row_dimensions[i].height=30
        sheet.cell(i,1).alignment=Alignment(wrap_text=True,vertical="center")
    stream=io.BytesIO();book.save(stream);return stream.getvalue()


def build():
    writer=PdfWriter()
    sections=[];topics=[];forms=[];questions=[];files={}
    def add(raw,title):
        start=len(writer.pages)+1
        writer.append(PdfReader(io.BytesIO(raw)),import_outline=False)
        writer.add_outline_item(title,start-1)
        topics.append({"title":title,"page":start})
        return start
    sections.append([1,"Forms & Tags"])
    template_ids={"pc3-pc15-series":"pc3","pc3-pc15":"pc3","pc10c":"pc10c-sg",
                  "caution-record":"caution","series-caution":"caution"}
    for key,(code,title,original_pages) in manager.FORMS.items():
        spec=templates.template(template_ids.get(key,key))
        fields=[f["label"] for f in spec["fields"]]
        if key in {"pc3-pc15-series","series-caution"}:fields+=["Series identifier","Tag sequence"]
        if key=="caution-record":fields+=["Tag identifier","Recorded by","Date and time"]
        label=f"{code} · {title}"
        description=f"NorthStar blank worksheet. UWPC 2024 source illustration: PDF p. {', '.join(map(str,original_pages))}."
        raw=pdf(label,description,fields,True)
        page=add(raw,label)
        files[key]=base64.b64encode(raw).decode()
        files[key+".xlsx"]=base64.b64encode(excel(label,description,fields)).decode()
        forms.append({"id":key,"code":code,"title":title,"pages":[page]})
    sections.append([len(writer.pages)+1,"Practice Questions"])
    for q,a,cl,p in manager.QUESTIONS:
        page=add(pdf(q,f"UWPC 2024 · {cl} · manual PDF p. {p}",[a]),q)
        questions.append([q,a,cl,page])
    stream=io.BytesIO();writer.add_metadata({"/Title":"NorthStar UWPC reference guide"});writer.write(stream)
    raw=stream.getvalue()
    texts=[p.extract_text() or "" for p in PdfReader(io.BytesIO(raw)).pages]
    files["book"]=base64.b64encode(raw).decode()
    return {"catalog":{"title":"NorthStar UWPC reference guide","guide":True,"pages":len(texts),"sections":sections,
                       "topics":topics,"forms":forms,"questions":questions},"texts":texts,"files":files}


if __name__=="__main__":
    Path(sys.argv[1]).write_text(json.dumps(build(),ensure_ascii=False,separators=(",",":")),encoding="utf-8")

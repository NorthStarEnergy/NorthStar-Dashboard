from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "desktop" / "manager.ico"
SCALE = 4
SIZE = 256

image = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
q = lambda value: round(value * SCALE)

# Distinct from the dashboard's NorthStar symbol: a monitor with a live pulse.
draw.rounded_rectangle((q(14), q(14), q(242), q(242)), radius=q(54), fill="#10242D", outline="#2F7181", width=q(5))
draw.rounded_rectangle((q(43), q(47), q(213), q(177)), radius=q(16), fill="#091319", outline="#58B8D3", width=q(9))
draw.line([(q(91), q(204)), (q(165), q(204))], fill="#58B8D3", width=q(10))
draw.line([(q(128), q(178)), (q(128), q(203))], fill="#58B8D3", width=q(10))
draw.line([(q(63), q(116)), (q(89), q(116)), (q(103), q(91)), (q(122), q(142)), (q(139), q(107)), (q(153), q(116)), (q(193), q(116))], fill="#F2B84B", width=q(10), joint="curve")
draw.ellipse((q(176), q(38), q(218), q(80)), fill="#55D89A", outline="#10242D", width=q(5))

image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
image.save(OUT, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(OUT)

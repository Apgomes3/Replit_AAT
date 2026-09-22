import fitz
from pathlib import Path

PDF = Path(".agents/outputs/bio-degas-plenum-visual-reference.pdf")
OUT = Path(".agents/outputs/plenum-rendered")
OUT.mkdir(parents=True, exist_ok=True)

doc = fitz.open(PDF)
for index, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    pix.save(OUT / f"page-{index + 1:02d}.png")

print(f"Rendered {doc.page_count} pages from {PDF}")
print(f"Page size: {doc[0].rect.width:.1f} × {doc[0].rect.height:.1f} pt")
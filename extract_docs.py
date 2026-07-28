from pathlib import Path
from PyPDF2 import PdfReader
import zipfile
import re
import xml.etree.ElementTree as ET

root = Path(r"c:\Users\AD\Assignment")

pdf_path = root / "data" / "logistics-spec.pdf"
print("PDF exists:", pdf_path.exists())
if pdf_path.exists():
    reader = PdfReader(str(pdf_path))
    print("PDF pages:", len(reader.pages))
    text_parts = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        text_parts.append(text)
        print(f"===== PAGE {i+1} =====")
        print(text[:5000])
        print()
    print("TOTAL PDF TEXT LENGTH:", sum(len(t) for t in text_parts))

word_path = root / "Coding_assignment.docx"
print("DOCX exists:", word_path.exists())
if word_path.exists():
    with zipfile.ZipFile(word_path) as z:
        xml = z.read("word/document.xml")
    root_xml = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    texts = []
    for p in root_xml.findall('.//w:p', ns):
        parts = []
        for t in p.findall('.//w:t', ns):
            if t.text:
                parts.append(t.text)
        if parts:
            texts.append(''.join(parts))
    print("DOCX paragraphs:", len(texts))
    for i, para in enumerate(texts[:40], 1):
        print(f"--- PARA {i} ---")
        print(para[:4000])
        print()

csv_path = root / "mock_logistics_data.csv"
print("CSV exists:", csv_path.exists())
if csv_path.exists():
    print(csv_path.read_text(encoding='utf-8-sig').splitlines()[:10])

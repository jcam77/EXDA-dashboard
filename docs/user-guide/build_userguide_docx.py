#!/usr/bin/env python3
"""Build docs/EXDA-UserGuide.docx from docs/EXDA-UserGuide.md.

The Markdown file is the source. This script renders it into a Word document
that uses the styles, header and footer of a Word template (fonts, heading
numbering, page layout). The template's body text is not copied.

Usage:
    python3 docs/user-guide/build_userguide_docx.py --template <template.docx>

Supports the Markdown used by the guide: headings, paragraphs, bullet and
numbered lists, pipe tables, block quotes, images, links, **bold**, `code`,
and one fenced block (the project folder tree, rendered as a table).
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

DOCS = Path(__file__).resolve().parents[1]
SOURCE = DOCS / "EXDA-UserGuide.md"
OUTPUT = DOCS / "EXDA-UserGuide.docx"
IMAGE_WIDTH = Cm(15.5)
INLINE = re.compile(r"(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)")


def clear_body(doc):
    body = doc.element.body
    for child in list(body):
        if child.tag != qn("w:sectPr"):
            body.remove(child)


def style_or(doc, *names):
    existing = {s.name for s in doc.styles}
    for name in names:
        if name in existing:
            return name
    return None


def add_hyperlink(paragraph, url, text, bold=False):
    part = paragraph.part
    r_id = part.relate_to(url, RT.HYPERLINK, is_external=True)
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), r_id)
    run = OxmlElement("w:r")
    props = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "0563C1")
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    props.append(color)
    props.append(underline)
    if bold:
        props.append(OxmlElement("w:b"))
    run.append(props)
    t = OxmlElement("w:t")
    t.text = text
    t.set(qn("xml:space"), "preserve")
    run.append(t)
    link.append(run)
    paragraph._p.append(link)


def add_inline(paragraph, text):
    for piece in INLINE.split(text):
        if not piece:
            continue
        if piece.startswith("**") and piece.endswith("**"):
            add_inline_bold(paragraph, piece[2:-2])
        elif piece.startswith("`") and piece.endswith("`"):
            run = paragraph.add_run(piece[1:-1])
            run.font.name = "Consolas"
            run.font.size = Pt(9.5)
        elif piece.startswith("[") and "](" in piece:
            label, url = re.match(r"\[([^\]]+)\]\(([^)]+)\)", piece).groups()
            if url.startswith("#"):
                paragraph.add_run(label)
            else:
                add_hyperlink(paragraph, url, label)
        elif piece.startswith("*") and piece.endswith("*") and len(piece) > 2:
            paragraph.add_run(piece[1:-1]).italic = True
        else:
            paragraph.add_run(piece)


def add_inline_bold(paragraph, text):
    # bold text may itself contain a link
    for piece in re.split(r"(\[[^\]]+\]\([^)]+\))", text):
        if not piece:
            continue
        m = re.match(r"\[([^\]]+)\]\(([^)]+)\)", piece)
        if m:
            add_hyperlink(paragraph, m.group(2), m.group(1), bold=True)
        else:
            paragraph.add_run(piece).bold = True


def add_toc(doc):
    p = doc.add_paragraph()
    run = p.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = 'TOC \\o "1-1" \\h \\z \\u'
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "Right-click and choose “Update Field” to show the table of contents."
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for el in (begin, instr, sep, text, end):
        run._r.append(el)
    # Ask Word to refresh fields (the TOC) when the document is opened.
    settings = doc.settings.element
    update = settings.find(qn("w:updateFields"))
    if update is None:
        update = OxmlElement("w:updateFields")
        settings.append(update)
    update.set(qn("w:val"), "true")


def add_table(doc, header, rows):
    table = doc.add_table(rows=1, cols=len(header))
    grid = style_or(doc, "Table Grid")
    if grid:
        table.style = grid
    for i, cell_text in enumerate(header):
        cell = table.rows[0].cells[i]
        cell.paragraphs[0].text = ""
        add_inline_bold(cell.paragraphs[0], cell_text.replace("**", ""))
        shade = OxmlElement("w:shd")
        shade.set(qn("w:val"), "clear")
        shade.set(qn("w:fill"), "E7EEF3")
        cell._tc.get_or_add_tcPr().append(shade)
    for row in rows:
        cells = table.add_row().cells
        for i, cell_text in enumerate(row[: len(header)]):
            cells[i].paragraphs[0].text = ""
            add_inline(cells[i].paragraphs[0], cell_text)
    for row in table.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
                for run in paragraph.runs:
                    run.font.size = Pt(9.5)
    doc.add_paragraph()


def tree_to_rows(lines):
    rows = []
    for line in lines:
        m = re.match(r"^[\s│├└─]*([^\s].*?)\s{2,}(.+)$", line)
        if m:
            rows.append([m.group(1).strip(), m.group(2).strip()])
        elif line.strip():
            rows.append([re.sub(r"^[\s│├└─]*", "", line).strip(), ""])
    return rows


def split_row(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def build(template: Path):
    doc = Document(str(template))
    clear_body(doc)
    normal = style_or(doc, "Normal-001-EMP2X", "Normal")
    bullet = style_or(doc, "List Bullet")
    number = style_or(doc, "List Number")

    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    lines = drop_contents_section(lines)
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("# "):
            doc.add_paragraph(stripped[2:].strip(), style=style_or(doc, "Title"))
            add_toc(doc)
            i += 1
            continue
        if stripped.startswith("## "):
            title = re.sub(r"^\d+\.\s*", "", stripped[3:].strip())
            doc.add_paragraph(title, style="Heading 1")
            i += 1
            continue
        if stripped in ("---", ""):
            i += 1
            continue
        if stripped.startswith("```"):
            block = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                block.append(lines[i])
                i += 1
            i += 1
            add_table(doc, ["Folder", "Contents"], tree_to_rows(block))
            continue
        if stripped.startswith("|"):
            header = split_row(stripped)
            i += 2  # skip separator
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(split_row(lines[i]))
                i += 1
            add_table(doc, header, rows)
            continue
        image = re.match(r"!\[([^\]]*)\]\(([^)]+)\)", stripped)
        if image:
            doc.add_picture(str(DOCS / image.group(2)), width=IMAGE_WIDTH)
            caption = doc.add_paragraph(image.group(1), style=normal)
            caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for run in caption.runs:
                run.italic = True
                run.font.size = Pt(9)
                run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
            i += 1
            continue
        if stripped.startswith(">"):
            text = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                text.append(lines[i].strip().lstrip(">").strip())
                i += 1
            p = doc.add_paragraph(style=normal)
            add_inline(p, " ".join(text))
            for run in p.runs:
                run.italic = True
            continue
        list_match = re.match(r"^(\s*)(-|\d+\.)\s+(.*)$", line)
        if list_match:
            items = []
            while i < len(lines):
                m = re.match(r"^(\s*)(-|\d+\.)\s+(.*)$", lines[i])
                if m:
                    items.append([m.group(2), m.group(3)])
                    i += 1
                elif lines[i].startswith("   ") and lines[i].strip() and items:
                    items[-1][1] += " " + lines[i].strip()
                    i += 1
                else:
                    break
            for marker, text in items:
                ordered = marker != "-"
                style = number if ordered else bullet
                p = doc.add_paragraph(style=style or style_or(doc, "List Paragraph") or normal)
                if not style:
                    p.add_run(f"{marker} " if ordered else "• ")
                    p.paragraph_format.left_indent = Cm(0.8)
                    p.paragraph_format.first_line_indent = Cm(-0.5)
                add_inline(p, text)
                p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            continue
        # paragraph (joins wrapped lines)
        text = [stripped]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||>|!\[|```|-\s|\d+\.\s|---)", lines[i].strip()):
            text.append(lines[i].strip())
            i += 1
        p = doc.add_paragraph(style=normal)
        add_inline(p, " ".join(text))

    doc.core_properties.title = "EXDA User Guide — MVP mode"
    doc.core_properties.subject = "EXDA 4.0.0"
    doc.save(str(OUTPUT))
    return OUTPUT


def drop_contents_section(lines):
    out, skipping = [], False
    for line in lines:
        if line.strip() == "## Contents":
            skipping = True
            continue
        if skipping and line.strip() == "---":
            skipping = False
            continue
        if not skipping:
            out.append(line)
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True, help="Word template (.docx) providing styles, header and footer")
    args = parser.parse_args()
    print(build(Path(args.template)))

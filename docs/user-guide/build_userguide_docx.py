#!/usr/bin/env python3
"""Build docs/EXDA-UserGuide.docx from docs/EXDA-UserGuide.md.

The Markdown file is the source. This script renders it into a Word document
based on a report template:

* The template's cover page is kept as it is (logo, project banner, document
  information table). Only the title, the subtitle and the Document, Version
  and Date cells are filled in for the guide.
* The title paragraph at the top of page 2 is kept and gets the guide title,
  followed by a table of contents.
* The template's body text after that is removed. The guide is written with
  the template's own formats: its section heading, body paragraph and dash
  list paragraphs are copied and reused.
* Styles, header (logo), footer (page numbers) and page layout come from the
  template unchanged.

Usage:
    python3 docs/user-guide/build_userguide_docx.py [--template <template.docx>]

The default template is docs/Reports_Template.docx.

Supports the Markdown used by the guide: headings, paragraphs, bullet and
numbered lists, pipe tables, block quotes, images, links, **bold**, `code`,
and one fenced block (the project folder tree, rendered as a table).
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from docx.text.paragraph import Paragraph

DOCS = Path(__file__).resolve().parents[1]
SOURCE = DOCS / "EXDA-UserGuide.md"
OUTPUT = DOCS / "EXDA-UserGuide.docx"
DEFAULT_TEMPLATE = DOCS / "Reports_Template.docx"
IMAGE_WIDTH = Cm(14.5)
INLINE = re.compile(r"(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)")
TABLE_HEADER_FILL = "EEEEEE"  # same grey as the cover's information table


# --------------------------------------------------------------------------
# Template handling
# --------------------------------------------------------------------------

def text_of(element):
    return "".join(t.text or "" for t in element.iter(qn("w:t")))


def has_page_break(element):
    return bool(element.xpath('.//w:br[@w:type="page"]'))


def set_text(paragraph_element, text):
    """Replace a paragraph's text, keeping the formatting of its first text run
    and any page-break runs."""
    text_runs = [r for r in paragraph_element.iter(qn("w:r")) if r.find(qn("w:t")) is not None]
    if not text_runs:
        return
    first = text_runs[0]
    for t in first.findall(qn("w:t"))[1:]:
        first.remove(t)
    t = first.find(qn("w:t"))
    t.text = text
    t.set(qn("xml:space"), "preserve")
    for run in text_runs[1:]:
        run.getparent().remove(run)


def fill_cover(body_elements, cover):
    """Fill the cover page: title lines by their template text, and the
    information table by its row labels (the value is the next cell)."""
    for el in body_elements:
        if el.tag == qn("w:p"):
            current = text_of(el).strip()
            if current in cover["paragraphs"]:
                set_text(el, cover["paragraphs"][current])
        elif el.tag == qn("w:tbl"):
            for row in el.iter(qn("w:tr")):
                cells = row.findall(qn("w:tc"))
                for i, cell in enumerate(cells[:-1]):
                    label = text_of(cell).strip()
                    if label in cover["table"]:
                        value_paragraph = cells[i + 1].find(qn("w:p"))
                        set_text(value_paragraph, cover["table"][label])


def split_template(doc):
    """Return (cover elements incl. the page-2 title paragraph, prototypes)
    and remove the template's remaining body text."""
    body = doc.element.body
    children = [c for c in body if c.tag != qn("w:sectPr")]
    title_index = next((i for i, c in enumerate(children) if c.tag == qn("w:p") and has_page_break(c)), None)
    if title_index is None:
        raise SystemExit("Template has no cover page (no paragraph with a page break found).")

    def first(predicate):
        return next((c for c in children[title_index + 1:] if c.tag == qn("w:p") and predicate(c)), None)

    def style_of(p):
        style = p.find(qn("w:pPr") + "/" + qn("w:pStyle"))
        return style.get(qn("w:val")) if style is not None else None

    heading = first(lambda p: (style_of(p) or "").startswith("Heading") and text_of(p).strip())
    bullet = first(lambda p: style_of(p) == "ListParagraph" and p.find(".//" + qn("w:numPr")) is not None)
    paragraph = first(lambda p: style_of(p) is None and len(text_of(p)) > 80)
    prototypes = {name: deepcopy(p.find(qn("w:pPr"))) if p is not None else None
                  for name, p in (("heading", heading), ("bullet", bullet), ("paragraph", paragraph))}
    for name in ("bullet", "paragraph"):  # drop paragraph-mark formatting (bold, colour)
        ppr = prototypes[name]
        if ppr is not None and ppr.find(qn("w:rPr")) is not None:
            ppr.remove(ppr.find(qn("w:rPr")))

    for c in children[title_index + 1:]:
        body.remove(c)
    return children[: title_index + 1], prototypes


def styled_paragraph(doc, ppr_prototype, fallback_style=None):
    p = doc.add_paragraph(style=fallback_style if ppr_prototype is None else None)
    if ppr_prototype is not None:
        existing = p._p.find(qn("w:pPr"))
        if existing is not None:
            p._p.remove(existing)
        p._p.insert(0, deepcopy(ppr_prototype))
    return p


# --------------------------------------------------------------------------
# Inline Markdown
# --------------------------------------------------------------------------

def add_hyperlink(paragraph, url, text, bold=False):
    r_id = paragraph.part.relate_to(url, RT.HYPERLINK, is_external=True)
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), r_id)
    run = OxmlElement("w:r")
    props = OxmlElement("w:rPr")
    style = OxmlElement("w:rStyle")
    style.set(qn("w:val"), "Hyperlink")
    props.append(style)
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


# --------------------------------------------------------------------------
# Blocks
# --------------------------------------------------------------------------

def add_toc_after(title_paragraph):
    """Insert 'Contents' and a TOC field right after the page-2 title."""
    label = OxmlElement("w:p")
    title_paragraph.addnext(label)
    label_p = Paragraph(label, title_paragraph.getparent())
    label_p.paragraph_format.space_before = Pt(24)
    run = label_p.add_run("Contents")
    run.bold = True
    run.font.size = Pt(14)

    field = OxmlElement("w:p")
    label.addnext(field)
    r = OxmlElement("w:r")
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = 'TOC \\o "1-2" \\h \\z \\u'
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "Right-click and choose “Update Field” to show the table of contents."
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for el in (begin, instr, sep, text, end):
        r.append(el)
    field.append(r)


def ask_word_to_update_fields(doc):
    settings = doc.settings.element
    update = settings.find(qn("w:updateFields"))
    if update is None:
        update = OxmlElement("w:updateFields")
        settings.append(update)
    update.set(qn("w:val"), "true")


def add_table(doc, header, rows):
    table = doc.add_table(rows=1, cols=len(header))
    if "Table Grid" in {s.name for s in doc.styles}:
        table.style = "Table Grid"
    for i, cell_text in enumerate(header):
        cell = table.rows[0].cells[i]
        cell.paragraphs[0].text = ""
        add_inline_bold(cell.paragraphs[0], cell_text.replace("**", ""))
        shade = OxmlElement("w:shd")
        shade.set(qn("w:val"), "clear")
        shade.set(qn("w:color"), "auto")
        shade.set(qn("w:fill"), TABLE_HEADER_FILL)
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
                fmt = paragraph.paragraph_format
                fmt.line_spacing = 1.0
                fmt.space_before = Pt(3)
                fmt.space_after = Pt(3)
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


def add_heading(doc, text, prototypes, page_break):
    p = styled_paragraph(doc, prototypes["heading"], fallback_style="Heading 2")
    if page_break:
        p.paragraph_format.page_break_before = True
    run = p.add_run(text)
    run.bold = True


def add_list(doc, items, prototypes):
    for marker, text in items:
        ordered = marker != "-"
        if ordered or prototypes["bullet"] is None:
            p = doc.add_paragraph(style="List Paragraph")
            p.paragraph_format.left_indent = Cm(1.27)
            p.paragraph_format.first_line_indent = Cm(-0.63)
            p.paragraph_format.line_spacing = 1.15
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            p.add_run(f"{marker}\t" if ordered else "–\t")
        else:
            p = styled_paragraph(doc, prototypes["bullet"])
        add_inline(p, text)
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def parse_title(lines):
    title_line = next(line for line in lines if line.startswith("# "))
    full = title_line[2:].strip()
    title, _, subtitle = full.partition("—")
    version = re.search(r"version\s+([\d.]+)", full)
    return title.strip(), subtitle.strip(), version.group(1) if version else ""


def build(template: Path):
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    title, subtitle, version = parse_title(lines)
    lines = drop_contents_section(lines)

    doc = Document(str(template))
    cover, prototypes = split_template(doc)
    page2_title = cover[-1]
    template_title = text_of(page2_title).strip()
    fill_cover(cover, {
        "paragraphs": {
            template_title: title,                         # cover title and page-2 title
            "(2026-2028)": subtitle,                       # cover subtitle
        },
        "table": {
            "Document": "EXDA-UserGuide",
            "Version": version,
            "Date": dt.date.today().strftime("%d-%m-%Y"),
        },
    })
    add_toc_after(page2_title)
    ask_word_to_update_fields(doc)

    caption_style = "Caption" if "Caption" in {s.name for s in doc.styles} else None
    first_section = True
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("# "):
            i += 1
            continue
        if stripped.startswith("## "):
            add_heading(doc, stripped[3:].strip(), prototypes, page_break=True)
            first_section = False
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
            picture = doc.paragraphs[-1]
            picture.alignment = WD_ALIGN_PARAGRAPH.CENTER
            picture.paragraph_format.space_before = Pt(6)
            picture.paragraph_format.space_after = Pt(0)
            picture.paragraph_format.keep_with_next = True
            caption = doc.add_paragraph(image.group(1), style=caption_style)
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
            p = styled_paragraph(doc, prototypes["paragraph"])
            add_inline(p, " ".join(text))
            for run in p.runs:
                run.italic = True
            continue
        if re.match(r"^(\s*)(-|\d+\.)\s+(.*)$", line):
            items = []
            while i < len(lines):
                m = re.match(r"^(\s*)(-|\d+\.)\s+(.*)$", lines[i])
                if m:
                    items.append([m.group(2), m.group(3)])
                    i += 1
                elif (items and lines[i].strip() and lines[i][:1].isspace()
                      and not re.match(r"^(#|\||>|!\[|```)", lines[i].strip())):
                    # wrapped continuation line of the previous item
                    items[-1][1] += " " + lines[i].strip()
                    i += 1
                else:
                    break
            add_list(doc, items, prototypes)
            continue
        # paragraph (joins wrapped lines)
        text = [stripped]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||>|!\[|```|-\s|\d+\.\s|---)", lines[i].strip()):
            text.append(lines[i].strip())
            i += 1
        p = styled_paragraph(doc, prototypes["paragraph"])
        add_inline(p, " ".join(text))

    if first_section:
        raise SystemExit("No sections (## headings) found in the guide.")
    doc.core_properties.title = f"{title} — {subtitle}" if subtitle else title
    doc.core_properties.subject = f"EXDA {version}".strip()
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
    parser.add_argument("--template", default=str(DEFAULT_TEMPLATE),
                        help="Word report template (.docx) with a cover page; default: docs/Reports_Template.docx")
    args = parser.parse_args()
    print(build(Path(args.template)))

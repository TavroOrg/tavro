"""Standalone PDF generation utility using fpdf2.

Extracted from tavro_library/agent_library.py to avoid pulling in MCP-server-only
module-level imports (utils.db, services.db.db_functions) into the tavro_api container.
"""
from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path
from typing import Any, Dict

_UNICODE_REPLACEMENTS: Dict[str, str] = {
    "—": "--",
    "–": "-",
    "‒": "-",
    "―": "--",
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "…": "...",
    " ": " ",
    "•": "-",
    "‣": "-",
    "●": "-",
    "→": "->",
    "←": "<-",
    "×": "x",
    "®": "(R)",
    "©": "(C)",
    "™": "(TM)",
    "‐": "-",
    "‑": "-",
}

# In the container, tavro_api/ is copied to /app/, so pdf_utils.py is at /app/api/pdf_utils.py.
# Two levels up reaches /app/ where the utils/ directory lives.
_APP_DIR = Path(__file__).resolve().parent.parent
_LOGO_PATH = str(_APP_DIR / "utils" / "travo_logo.png")
_INTER_REGULAR = str(_APP_DIR / "utils" / "fonts" / "Inter-Regular.ttf")
_INTER_BOLD = str(_APP_DIR / "utils" / "fonts" / "Inter-Bold.ttf")


def _load_pdf_visual_format() -> Dict[str, Any]:
    defaults: Dict[str, Any] = {
        "header_height": 48.0,
        "header_background": (255, 255, 255),
        "header_border": (226, 232, 240),
        "accent": (203, 213, 225),
        "accent_height": 0.0,
        "name_color": (30, 41, 59),
        "name_size": 18.0,
        "name_y": 18.0,
        "type_color": (71, 85, 105),
        "type_size": 11.0,
        "type_y": 25.0,
        "subtitle_color": (100, 116, 139),
        "subtitle_size": 7.5,
        "subtitle_y": 31.0,
        "date_color": (100, 116, 139),
        "date_size": 7.5,
        "date_y": 31.0,
        "footer_background": (248, 250, 252),
        "footer_border": (226, 232, 240),
        "footer_text": (148, 163, 184),
        "footer_height": 12.0,
        "content_start_y": 52.0,
    }
    template_candidates = [
        Path(os.getenv("TAVRO_PDF_TEMPLATE_PATH", "")),
        _APP_DIR / "templates" / "pdf-document-template.md",
        _APP_DIR / "tavro_app" / "copilot-server" / "templates" / "pdf-document-template.md",
    ]
    text = ""
    for tp in template_candidates:
        if not str(tp):
            continue
        try:
            if tp.exists():
                text = tp.read_text(encoding="utf-8")
                break
        except Exception:
            continue
    if not text:
        return defaults

    config_match = re.search(r"<!--\s*pdf-visual-config\s*\n([\s\S]+?)\n-->", text, re.IGNORECASE)
    if config_match:
        try:
            cfg = json.loads(config_match.group(1))
            key_map = {
                "headerHeight": "header_height",
                "accentHeight": "accent_height",
                "nameSize": "name_size",
                "nameY": "name_y",
                "typeSize": "type_size",
                "typeY": "type_y",
                "subtitleSize": "subtitle_size",
                "subtitleY": "subtitle_y",
                "dateSize": "date_size",
                "dateY": "date_y",
                "footerHeight": "footer_height",
                "contentStartY": "content_start_y",
            }
            for source_key, target_key in key_map.items():
                value = cfg.get(source_key)
                if isinstance(value, (int, float)):
                    defaults[target_key] = float(value)
        except Exception:
            pass

    def rgb_for(label: str, fallback: tuple) -> tuple:
        match = re.search(label + r"[^\n]*rgb\s+(\d+)\s+(\d+)\s+(\d+)", text, re.IGNORECASE)
        return tuple(int(match.group(i)) for i in range(1, 4)) if match else fallback

    defaults.update({
        "header_background": rgb_for("Background", defaults["header_background"]),
        "header_border": rgb_for("Bottom border", defaults["header_border"]),
        "accent": rgb_for("Header divider line", defaults["accent"]),
        "name_color": rgb_for("Name", defaults["name_color"]),
        "type_color": rgb_for("Type", defaults["type_color"]),
        "subtitle_color": rgb_for("Subtitle", defaults["subtitle_color"]),
        "date_color": rgb_for("Generation date", defaults["date_color"]),
        "footer_background": rgb_for(r"Footer[\s\S]*?Background", defaults["footer_background"]),
        "footer_border": rgb_for("Top border line", defaults["footer_border"]),
        "footer_text": rgb_for("Page X of Y", defaults["footer_text"]),
    })
    return defaults


def markdown_to_pdf(markdown_content: str, agent_name: str = "", doc_type: str = "") -> bytes:
    """Convert a markdown string to PDF bytes using fpdf2."""
    from datetime import datetime
    from fpdf import FPDF

    for char, replacement in _UNICODE_REPLACEMENTS.items():
        markdown_content = markdown_content.replace(char, replacement)
    markdown_content = markdown_content.encode("latin-1", errors="replace").decode("latin-1")
    _agent_name = agent_name.encode("latin-1", errors="replace").decode("latin-1")
    _doc_type = doc_type.encode("latin-1", errors="replace").decode("latin-1")

    _use_inter = os.path.exists(_INTER_REGULAR) and os.path.exists(_INTER_BOLD)
    _main_font = "Inter" if _use_inter else "Helvetica"
    _visual = _load_pdf_visual_format()

    _doc_title = ""
    for _ln in markdown_content.split("\n"):
        if _ln.strip().startswith("# "):
            _doc_title = _ln.strip()[2:].strip()
            break

    _now = datetime.now()
    _hour = _now.hour % 12 or 12
    _ampm = "AM" if _now.hour < 12 else "PM"
    _today_str = f"Generated: {_now.month}/{_now.day}/{_now.year}, {_hour}:{_now.minute:02d}:{_now.second:02d} {_ampm}"

    class _PDF(FPDF):
        doc_title: str = _doc_title
        today_str: str = _today_str
        hdr_agent_name: str = _agent_name
        hdr_doc_type: str = _doc_type
        main_font: str = _main_font
        visual: Dict[str, Any] = _visual

        def header(self):
            if self.page_no() != 1:
                return
            v = self.visual
            self.set_fill_color(*v["header_background"])
            self.rect(0, 0, self.w, v["header_height"], "F")
            self.set_draw_color(*v["header_border"])
            self.set_line_width(0.3)
            self.line(0, v["header_height"] - 0.3, self.w, v["header_height"] - 0.3)
            if v["accent_height"] > 0:
                self.set_fill_color(*v["accent"])
                self.rect(20, v["header_height"] - v["accent_height"] - 1, self.w - 40, v["accent_height"], "F")

            logo_h = 11
            logo_y = (v["header_height"] - logo_h) / 2
            logo_w = min(round(logo_h * (469 / 463)), 38)
            logo_x = 20
            text_x = logo_x + logo_w + 5
            try:
                if os.path.exists(_LOGO_PATH):
                    self.image(_LOGO_PATH, x=logo_x, y=logo_y, w=logo_w, h=logo_h, type="PNG")
            except Exception:
                pass

            if self.hdr_agent_name and self.hdr_doc_type:
                name_display = self.hdr_agent_name[:65]
                avail_w = self.w - text_x - 22
                name_size = v["name_size"]
                self.set_font(self.main_font, "B", name_size)
                while name_size > 10 and self.get_string_width(name_display) > avail_w:
                    name_size -= 0.5
                    self.set_font(self.main_font, "B", name_size)
                self.set_text_color(*v["name_color"])
                self.set_xy(text_x, v["name_y"])
                self.cell(avail_w, 6, name_display)

                self.set_font(self.main_font, "", v["type_size"])
                self.set_text_color(*v["type_color"])
                self.set_xy(text_x, v["type_y"])
                self.cell(self.w - text_x - 20, 5, self.hdr_doc_type)

                self.set_font(self.main_font, "", v["subtitle_size"])
                self.set_text_color(*v["subtitle_color"])
                self.set_xy(text_x, v["subtitle_y"])
                self.cell(self.w - text_x - 20, 5, "Tavro AI Governance Platform")

                self.set_font(self.main_font, "", v["date_size"])
                self.set_text_color(*v["date_color"])
                self.set_xy(20, v["date_y"])
                self.cell(self.w - 40, 5, self.today_str, align="R")
            else:
                title = self.doc_title[:65] if self.doc_title else "Tavro Report"
                self.set_font(self.main_font, "B", 13)
                self.set_text_color(*v["name_color"])
                self.set_xy(text_x, 19)
                self.cell(self.w - text_x - 20, 7, title)

                self.set_font(self.main_font, "", v["subtitle_size"])
                self.set_text_color(*v["subtitle_color"])
                self.set_xy(text_x, 27)
                self.cell(self.w - text_x - 20, 5, "Tavro AI Governance Platform")

                self.set_font(self.main_font, "", v["date_size"])
                self.set_text_color(*v["date_color"])
                self.set_xy(20, 27)
                self.cell(self.w - 40, 5, self.today_str, align="R")

        def footer(self):
            v = self.visual
            ph = self.h
            self.set_fill_color(*v["footer_background"])
            self.rect(0, ph - v["footer_height"], self.w, v["footer_height"], "F")
            self.set_draw_color(*v["footer_border"])
            self.set_line_width(0.3)
            self.line(0, ph - v["footer_height"], self.w, ph - v["footer_height"])
            self.set_font(self.main_font, "", 7)
            self.set_text_color(*v["footer_text"])
            self.set_xy(15, ph - 8)
            self.cell(self.w - 30, 5, "Tavro AI Governance Platform  *  Confidential")
            self.set_xy(15, ph - 8)
            self.cell(self.w - 30, 5, f"Page {self.page_no()} of {{nb}}", align="R")

    pdf = _PDF()
    if _use_inter:
        try:
            pdf.add_font("Inter", "", _INTER_REGULAR, uni=True)
            pdf.add_font("Inter", "B", _INTER_BOLD, uni=True)
            pdf.add_font("Inter", "I", _INTER_REGULAR, uni=True)
            pdf.add_font("Inter", "BI", _INTER_BOLD, uni=True)
        except Exception:
            pdf.main_font = "Helvetica"
    pdf.alias_nb_pages()
    pdf.set_margins(20, 50, 20)
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()
    pdf.set_y(_visual["content_start_y"])
    pdf.set_top_margin(22)

    def _to_latin1(text: str) -> str:
        for char, replacement in _UNICODE_REPLACEMENTS.items():
            text = text.replace(char, replacement)
        return text.encode("latin-1", errors="replace").decode("latin-1")

    def _strip_inline(text: str) -> str:
        text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
        text = re.sub(r"\*(.+?)\*", r"\1", text)
        text = re.sub(r"`(.+?)`", r"\1", text)
        text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
        return _to_latin1(text.strip())

    def _is_table_sep(line: str) -> bool:
        s = line.strip()
        return bool(s) and all(c in "|:- " for c in s)

    lines = markdown_content.split("\n")
    i = 0
    _first_h1_skipped = False  # always skip first H1 — it duplicates the header
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()

        if stripped.startswith("# "):
            if not _first_h1_skipped:
                _first_h1_skipped = True
                i += 1
                continue
            pdf.set_font(_main_font, "B", 18)
            pdf.set_text_color(30, 30, 30)
            pdf.multi_cell(0, 10, _strip_inline(stripped[2:]))
            pdf.ln(3)

        elif stripped.startswith("## "):
            pdf.set_font(_main_font, "B", 14)
            pdf.set_text_color(40, 40, 40)
            pdf.ln(3)
            pdf.multi_cell(0, 8, _strip_inline(stripped[3:]))
            pdf.ln(1)

        elif stripped.startswith("### "):
            pdf.set_font(_main_font, "B", 12)
            pdf.set_text_color(50, 50, 50)
            pdf.ln(2)
            pdf.multi_cell(0, 7, _strip_inline(stripped[4:]))
            pdf.ln(1)

        elif stripped.startswith("#### "):
            pdf.set_font(_main_font, "BI", 11)
            pdf.set_text_color(60, 60, 60)
            pdf.multi_cell(0, 6, _strip_inline(stripped[5:]))

        elif stripped.startswith("- [ ] ") or stripped.startswith("- [x] ") or stripped.startswith("- [X] "):
            checked = stripped[3] in ("x", "X")
            text = ("[x] " if checked else "[ ] ") + _strip_inline(stripped[6:])
            pdf.set_font(_main_font, "", 11)
            pdf.set_text_color(60, 60, 60)
            pdf.set_x(26)
            pdf.multi_cell(0, 6, text)

        elif stripped.startswith("- ") or stripped.startswith("* "):
            indent = len(raw) - len(raw.lstrip())
            bullet_text = _strip_inline(stripped[2:])
            pdf.set_font(_main_font, "", 11)
            pdf.set_text_color(60, 60, 60)
            left_margin = 20 + min(indent // 2, 3) * 4
            pdf.set_x(left_margin)
            pdf.cell(5, 6, chr(149))
            pdf.multi_cell(0, 6, bullet_text)

        elif stripped and stripped[0].isdigit() and ". " in stripped[:5]:
            pdf.set_font(_main_font, "", 11)
            pdf.set_text_color(60, 60, 60)
            pdf.set_x(24)
            pdf.multi_cell(0, 6, _strip_inline(stripped))

        elif stripped.startswith("|") and not _is_table_sep(stripped):
            cols = [_strip_inline(c.strip()) for c in stripped.strip("|").split("|")]
            n = max(len(cols), 1)
            avail_w = pdf.w - pdf.l_margin - pdf.r_margin
            is_header = i + 1 < len(lines) and _is_table_sep(lines[i + 1])

            if n == 1:
                col_widths = [avail_w]
            elif n == 2:
                col_widths = [avail_w * 0.38, avail_w * 0.62]
            elif n == 3:
                col_widths = [avail_w * 0.30, avail_w * 0.17, avail_w * 0.53]
            else:
                col_widths = [avail_w / n] * n

            line_h = 5
            padding = 1.0

            def _render_row(col_texts, widths, font_style, fill_color, text_color, do_fill):
                pdf.set_font(_main_font, font_style, 9)
                space_w = pdf.get_string_width(" ")
                max_lines = 1
                for text_cell, w in zip(col_texts, widths):
                    inner = max(w - 2 * padding, 1)
                    if not text_cell:
                        continue
                    ln_count = 1
                    cur_w = 0.0
                    for word in (text_cell or "").split(" "):
                        if not word:
                            continue
                        ww = pdf.get_string_width(word)
                        if ww > inner:
                            if cur_w > 0:
                                ln_count += 1
                                cur_w = 0.0
                            extra = math.ceil(ww / inner) - 1
                            ln_count += extra
                            cur_w = ww - extra * inner
                        elif cur_w == 0:
                            cur_w = ww
                        elif cur_w + space_w + ww <= inner:
                            cur_w += space_w + ww
                        else:
                            ln_count += 1
                            cur_w = ww
                    max_lines = max(max_lines, ln_count)

                row_h = max_lines * line_h + 2 * padding + 1
                if pdf.will_page_break(row_h):
                    pdf.add_page()

                x0, y0 = pdf.l_margin, pdf.get_y()
                pdf.set_draw_color(100, 100, 100)
                cur_x = x0
                for w in widths:
                    style = "FD" if do_fill else "D"
                    if do_fill:
                        pdf.set_fill_color(*fill_color)
                    pdf.rect(cur_x, y0, w, row_h, style)
                    cur_x += w

                pdf.set_text_color(*text_color)
                cur_x = x0
                for text_cell, w in zip(col_texts, widths):
                    pdf.set_xy(cur_x + padding, y0 + padding)
                    pdf.multi_cell(w - 2 * padding, line_h, text_cell, border=0, fill=False, align="L")
                    cur_x += w
                pdf.set_xy(x0, y0 + row_h)

            if is_header:
                _render_row(cols, col_widths, "B", (215, 215, 215), (30, 30, 30), True)
                i += 2
                continue
            else:
                _render_row(cols, col_widths, "", (255, 255, 255), (60, 60, 60), False)

        elif stripped.startswith("**") and stripped.endswith("**") and len(stripped) > 4:
            pdf.set_font(_main_font, "B", 11)
            pdf.set_text_color(40, 40, 40)
            pdf.multi_cell(0, 6, _to_latin1(stripped[2:-2].strip()))

        elif stripped in ("---", "***", "___"):
            pdf.ln(2)
            pdf.set_draw_color(200, 200, 200)
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(2)

        elif stripped == "":
            pdf.ln(2)

        else:
            pdf.set_font(_main_font, "", 11)
            pdf.set_text_color(60, 60, 60)
            pdf.multi_cell(0, 6, _strip_inline(stripped))

        i += 1

    return bytes(pdf.output())

#!/usr/bin/env python3
"""
build_sandbox.py — per-market build (COUNTRY env) that fits the Cowork sandbox (3 GB RAM, ~3-minute
calls). Produces the SAME workbook as run.py (build_full_base.py + merchant_base_model.py)
but in three resumable steps, because the normal pipeline reloads the whole Full Base
sheet into openpyxl for the model step, which cannot hold 673k x 94 cells in 3 GB.

    COUNTRY=ES python3 build_sandbox.py prep     q1_export.csv work/      -> work/skeleton.xlsx
    COUNTRY=ES python3 build_sandbox.py chunk    q1_export.csv work/      -> work/rows_NNNN.xml (resumable)
    COUNTRY=ES python3 build_sandbox.py assemble q1_export.csv work/ OUT  -> OUT (final workbook)

prep      every tab EXCEPT the Full Base rows, via the existing generators (write-only).
          Full Base carries the header row + ONE fully styled sample row, which is how the
          style ids for every column are discovered in `chunk`.
chunk     streams the CSV into raw <row> XML, 150k rows per call, writing the base
          columns + GTV_CONFIDENCE + ACTION + spacer + the 25 model formulas (only where
          POS_GTV_12M_USD > 0, as in merchant_base_model.py).
assemble  copies skeleton.xlsx to OUT, replacing the Full Base sheet XML with
          header + chunks + autofilter. Nothing large is ever held in memory.

The workbook is saved with fullCalcOnLoad, so Excel computes every formula on first
open (the sandbox cannot run the LibreOffice recalc inside the call cap). Column layout
is identical to the US file: A..BN generated, BO ACTION, BP spacer, BQ..CP model.
"""
import csv, os, re, sys, glob, time, zipfile, shutil, gzip, datetime as dt
from xml.sax.saxutils import escape
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE

import openpyxl
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Alignment, PatternFill
from openpyxl.utils import get_column_letter as gcl

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_full_base as B
import merchant_base_model as M

CHUNK_ROWS = 150_000
CALL_BUDGET = 140          # seconds of work per call before pausing (cap is ~175s)
EPOCH = dt.datetime(1899, 12, 30)


def base_headers(csv_path):
    with open(csv_path, newline="", encoding="utf-8-sig") as fh:
        h = [x.strip().upper() for x in next(csv.reader(fh))]
    return h + ["GTV_CONFIDENCE"]


def layout(headers):
    """Column index (1-based) for every column in the final sheet."""
    n = len(headers)
    cols = {h: i + 1 for i, h in enumerate(headers)}
    cols["ACTION"] = n + 1
    model = {}
    start = n + 3                       # one spacer after ACTION
    for i, key in enumerate(M.MODEL):
        model[key] = start + i
    return cols, model


def col_fmt(h):
    if h in B.MONEY_COLS: return '$#,##0.00;($#,##0.00);-'
    if h in B.PCT_COLS:   return '0.0%;-0.0%;-'
    if h in B.INT_COLS:   return '#,##0;(#,##0);-'
    if h in B.NUM_COLS:   return '0.00'
    if h in B.DATE_COLS:  return 'yyyy-mm-dd'
    return None


# ------------------------------------------------------------------ prep ----
def prep(csv_path, work):
    os.makedirs(work, exist_ok=True)
    headers = base_headers(csv_path)
    cols, model = layout(headers)
    B.expect_from_csv(csv_path)

    wb = Workbook(write_only=True)
    try:
        normal = wb._named_styles["Normal"]; normal.font.name = "Arial"; normal.font.sz = 10
    except Exception:
        pass

    # ---- Full Base: header + one styled sample row -------------------------
    ws = wb.create_sheet(B.DATA_SHEET)
    for h, i in cols.items():
        L = gcl(i)
        ws.column_dimensions[L].width = B.WIDE.get(h, max(11, min(20, len(h) + 3)))
    ws.column_dimensions[gcl(cols["ACTION"])].width = 34
    for key, i in model.items():
        ws.column_dimensions[gcl(i)].width = 17
    ws.freeze_panes = "C2"

    hdr = [B.cell(ws, h, font=B.HDR_F, fill=B.NAVY, align="center", wrap=True) for h in headers]
    hdr.append(B.cell(ws, "ACTION", font=B.HDR_F, fill=B.NAVY, align="center", wrap=True))
    hdr.append(None)
    for key, (header, fmt, f) in M.MODEL.items():
        if header is None:
            hdr.append(None); continue
        c = WriteOnlyCell(ws, value=header)
        c.font, c.fill = M.HDR_F, PatternFill("solid", fgColor=M.NAVY)
        c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        hdr.append(c)
    ws.append(hdr)

    sample = []
    for h in headers:
        c = WriteOnlyCell(ws, value=1 if col_fmt(h) else "x")
        c.font = B.BODY_F
        f = col_fmt(h)
        if f: c.number_format = f
        sample.append(c)
    c = WriteOnlyCell(ws, value="x"); c.font = B.BODY_F; sample.append(c)   # ACTION
    sample.append(None)                                                      # spacer
    for key, (header, fmt, f) in M.MODEL.items():
        if header is None:
            sample.append(None); continue
        c = WriteOnlyCell(ws, value=1); c.font = M.BODY_F
        if fmt: c.number_format = fmt
        sample.append(c)
    ws.append(sample)

    # ---- one streaming pass over the CSV: row count, months, snapshot rows ----
    # (pandas on 673k x 65 strings does not fit in 3 GB; stream instead)
    src = {c: (headers.index(c) if c in headers else None)
           for c in ("POS_GTV_L30D_USD", "POS_MEDIAN_TICKET_USD", "GTV_DATA_FLAG",
                     "IS_TRANSACTING", "PAYMENTS_TXNS", "PAYMENTS_VOLUME_USD")}
    keep = [h for h in headers if h]
    i_month = headers.index("MONTH_JOINED_POS"); i_email = headers.index("EMAIL")
    sel = {name: [] for name in M.SNAPSHOTS}
    seen = {}
    months = set(); nrows = 0
    with open(csv_path, newline="", encoding="utf-8-sig") as fh:
        rdr = csv.reader(fh); next(rdr)
        for rec in rdr:
            nrows += 1
            if rec[i_month]: months.add(rec[i_month])
            rec = rec + [B._confidence(rec, src)]
            r = dict(zip(headers, rec))
            for name, cfg in M.SNAPSHOTS.items():
                if cfg["rule"](r):
                    sel[name].append(r)
                    e = rec[i_email]
                    if e and e not in seen:
                        seen[e] = (name, M._num(r.get("POS_GTV_12M_USD")))
    months = sorted(months)
    B.build_read_me(wb, nrows, len(headers))
    B.build_base_summary(wb, headers, nrows)
    B.build_funnel(wb, headers)
    B.build_cohorts(wb, headers, months)
    B.build_gtv(wb, headers)
    B.build_coverage(wb, headers, nrows)

    # ---- Margin Assumptions (write-only emulation of M.build_assumptions) --
    ws = wb.create_sheet("Margin Assumptions")
    ws.column_dimensions["A"].width = 58
    for c in "BCD": ws.column_dimensions[c].width = 18
    gtv_letter = gcl(cols["POS_GTV_12M_USD"])
    remap = {k: gcl(v) for k, v in model.items()}
    def _r(letter): return f"'{B.DATA_SHEET}'!${letter}${M.DATA_START}:${letter}${M.MAXROW}"
    rngs = {f"{k}_R": _r(L) for k, L in remap.items() if M.MODEL[k][0]}
    rngs["GTV_R"] = _r(gtv_letter)
    grid, merges = {}, []
    for r, c, v, kind in M.ASSUMPTIONS:
        grid[(r, c)] = (v, kind)
        if kind == "note" and c == 1: merges.append(r)
    for r, c, v, kind in M.OUTPUTS:
        val = v.format(**rngs) if isinstance(v, str) and "{" in v else v
        grid[(r, c)] = (val, kind)
    maxr = max(r for r, _ in grid); maxc = max(c for _, c in grid)
    for r in range(1, maxr + 1):
        row = []
        for c in range(1, maxc + 1):
            if (r, c) in grid:
                v, kind = grid[(r, c)]
                cell = WriteOnlyCell(ws, value=v); M.style(cell, kind); row.append(cell)
            else:
                row.append(None)
        ws.append(row)
    for r in merges:
        try: ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
        except Exception: pass

    # ---- snapshot tabs (rule-driven, same rules as the model script) -------
    counts = {}
    for name, cfg in M.SNAPSHOTS.items():
        ws = wb.create_sheet(name)
        c = WriteOnlyCell(ws, value=f"{name} — {cfg['note']}")
        c.font = M.NOTE_F; c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.append([c])
        try: ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=12)
        except Exception: pass
        hrow = []
        for h in keep:
            c = WriteOnlyCell(ws, value=h); c.font, c.fill = M.HDR_F, PatternFill("solid", fgColor=M.NAVY)
            hrow.append(c)
        ws.append(hrow)
        rows_sel = sel[name]
        try: rows_sel.sort(key=cfg["sort"])
        except TypeError: pass
        for r in rows_sel:
            ws.append([_typed(ws, r[h], h) for h in keep])
        ws.freeze_panes = "C3"
        counts[name] = len(rows_sel)
    ws = wb.create_sheet("EMAIL BASE")
    hrow = []
    for h in ["EMAIL", "BASE", "GTV L12M"]:
        c = WriteOnlyCell(ws, value=h); c.font, c.fill = M.HDR_F, PatternFill("solid", fgColor=M.NAVY)
        hrow.append(c)
    ws.append(hrow)
    for e, (nm, g) in sorted(seen.items(), key=lambda kv: -kv[1][1]):
        c = WriteOnlyCell(ws, value=g); c.number_format = M.MONEY
        ws.append([e, nm, c])
    counts["EMAIL BASE"] = len(seen)
    for k, v in counts.items():
        print(f"  snapshot {k:32} {v:>7,} rows")

    order = ["Read Me", "Base Summary", "Payments Funnel", "GTV & Opportunity",
             "By Cohort Month", "Data Coverage", B.DATA_SHEET, "Margin Assumptions",
             *M.SNAPSHOTS.keys(), "EMAIL BASE"]
    wb._sheets = [wb[s] for s in order if s in wb.sheetnames]
    wb.calculation.fullCalcOnLoad = True
    out = os.path.join(work, "skeleton.xlsx")
    wb.save(out)
    print(f"wrote {out} ({os.path.getsize(out)/1e6:.1f} MB); {nrows:,} rows in CSV")


def _typed(ws, v, h):
    if isinstance(v, str) and ILLEGAL_CHARACTERS_RE.search(v):
        v = ILLEGAL_CHARACTERS_RE.sub("", v)      # control chars are illegal in sheet XML
    if v in ("", None): return None
    if h in B.MONEY_COLS or h in B.INT_COLS or h in B.PCT_COLS or h in B.NUM_COLS:
        try:
            f = float(v); return int(f) if f.is_integer() else f
        except ValueError: return v
    if h in B.DATE_COLS:
        return B._parse_dt(v)
    if isinstance(v, str) and v.startswith("="):
        c = WriteOnlyCell(ws, value=v); c.data_type = "s"; return c   # literal text, never a formula
    return v


# ----------------------------------------------------------------- chunk ----
def _sheet_xml_name(zpath, sheet):
    with zipfile.ZipFile(zpath) as z:
        wbxml = z.read("xl/workbook.xml").decode()
        rels = z.read("xl/_rels/workbook.xml.rels").decode()
    rid = {}
    for rel in re.findall(r'<Relationship [^>]*>', rels):
        i = re.search(r'Id="([^"]+)"', rel); t = re.search(r'Target="([^"]+)"', rel)
        if i and t: rid[i.group(1)] = t.group(1)
    for m in re.finditer(r'<sheet[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"', wbxml):
        if m.group(1) == sheet:
            t = rid[m.group(2)].lstrip("/")
            return t if t.startswith("xl/") else "xl/" + t
    raise RuntimeError("sheet not found")


def style_ids(work):
    """Style id per column letter, read from the sample row (row 2) of the skeleton."""
    sk = os.path.join(work, "skeleton.xlsx")
    name = _sheet_xml_name(sk, B.DATA_SHEET)
    with zipfile.ZipFile(sk) as z:
        xml = z.read(name).decode()
    row2 = re.search(r'<row r="2"[^>]*>(.*?)</row>', xml, re.S).group(1)
    ids = {}
    for m in re.finditer(r'<c r="([A-Z]+)2"(?: s="(\d+)")?', row2):
        ids[m.group(1)] = m.group(2)
    return ids


def _serial(v):
    d = B._parse_dt(v)
    if isinstance(d, dt.datetime):
        delta = d - EPOCH
    elif isinstance(d, dt.date):
        delta = dt.datetime(d.year, d.month, d.day) - EPOCH
    else:
        return None
    return delta.days + delta.seconds / 86400.0


def chunk(csv_path, work):
    t0 = time.time()
    headers = base_headers(csv_path)
    cols, model = layout(headers)
    sid = style_ids(work)
    letters = [gcl(i) for i in range(1, len(headers) + 1)]
    kinds = []
    for h in headers:
        if h in B.MONEY_COLS or h in B.INT_COLS or h in B.PCT_COLS or h in B.NUM_COLS: kinds.append("n")
        elif h in B.DATE_COLS: kinds.append("d")
        else: kinds.append("s")
    src = {c: (headers.index(c) if c in headers else None)
           for c in ("POS_GTV_L30D_USD", "POS_MEDIAN_TICKET_USD", "GTV_DATA_FLAG",
                     "IS_TRANSACTING", "PAYMENTS_TXNS", "PAYMENTS_VOLUME_USD")}
    i_gtv = headers.index("POS_GTV_12M_USD")
    G, R = gcl(i_gtv + 1), gcl(headers.index("POS_RECEIPTS_12M") + 1)
    remap = {k: gcl(v) for k, v in model.items()}
    # pre-render model formula templates with {row} placeholder only
    templates = []
    for key, (header, fmt, f) in M.MODEL.items():
        if f is None: continue
        expr = f.format(G=G, R=R, row="{row}")
        for k, L in remap.items():
            if k != L: expr = expr.replace(f"${k}{{row}}", f"${L}{{row}}")
        expr = escape(expr[1:])     # drop leading '=', escape & < >
        L = remap[key]
        s = sid.get(L)
        templates.append((L, f' s="{s}"' if s else "", expr))
    sattr = {L: (f' s="{sid[L]}"' if sid.get(L) else "") for L in letters}
    conf_letter = letters[-1]

    done = {int(os.path.basename(p)[5:9]) for p in glob.glob(os.path.join(work, "rows_*.xml.gz"))}
    with open(csv_path, newline="", encoding="utf-8-sig") as fh:
        rdr = csv.reader(fh); next(rdr)
        ci = 0
        while True:
            if ci in done:
                for _ in range(CHUNK_ROWS):
                    if next(rdr, None) is None: print("all chunks present"); return
                ci += 1; continue
            if time.time() - t0 > CALL_BUDGET:
                print(f"pausing before chunk {ci}; re-run"); sys.exit(3)
            tmp = os.path.join(work, f"rows_{ci:04d}.xml.gz.tmp")
            n = 0
            with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=3) as out:
                for k in range(CHUNK_ROWS):
                    rec = next(rdr, None)
                    if rec is None: break
                    r = ci * CHUNK_ROWS + k + 2
                    parts = [f'<row r="{r}">']
                    for i, v in enumerate(rec):
                        if v == "": continue
                        L = letters[i]; kd = kinds[i]
                        if kd == "n":
                            try:
                                f = float(v); parts.append(f'<c r="{L}{r}"{sattr[L]}><v>{int(f) if f.is_integer() else f}</v></c>'); continue
                            except ValueError: pass
                        elif kd == "d":
                            sv = _serial(v)
                            if sv is not None:
                                parts.append(f'<c r="{L}{r}"{sattr[L]}><v>{sv}</v></c>'); continue
                        if ILLEGAL_CHARACTERS_RE.search(v): v = ILLEGAL_CHARACTERS_RE.sub("", v)
                        parts.append(f'<c r="{L}{r}"{sattr[L]} t="inlineStr"><is><t xml:space="preserve">{escape(v)}</t></is></c>')
                    cf = B._confidence(rec, src)
                    parts.append(f'<c r="{conf_letter}{r}"{sattr[conf_letter]} t="inlineStr"><is><t>{escape(cf)}</t></is></c>')
                    if B._num(rec[i_gtv]) > 0:
                        for L, s, expr in templates:
                            parts.append(f'<c r="{L}{r}"{s}><f>{expr.replace("{row}", str(r))}</f></c>')
                    parts.append("</row>\n")
                    out.write("".join(parts)); n += 1
            if n == 0:
                os.remove(tmp); print("all chunks written"); return
            os.rename(tmp, os.path.join(work, f"rows_{ci:04d}.xml.gz"))
            print(f"  chunk {ci}: {n:,} rows ({time.time()-t0:.0f}s)", flush=True)
            if n < CHUNK_ROWS: print("all chunks written"); return
            ci += 1


# -------------------------------------------------------------- assemble ----
def assemble(csv_path, work, out):
    headers = base_headers(csv_path)
    cols, model = layout(headers)
    last_col = gcl(max(model.values()))
    sk = os.path.join(work, "skeleton.xlsx")
    name = _sheet_xml_name(sk, B.DATA_SHEET)
    chunks = sorted(glob.glob(os.path.join(work, "rows_*.xml.gz")))
    nrows = 0
    with zipfile.ZipFile(sk) as z:
        xml = z.read(name).decode()
    head, rest = xml.split("<sheetData>", 1)
    rows_xml, tail = rest.split("</sheetData>", 1)
    row1 = re.search(r'<row r="1".*?</row>', rows_xml, re.S).group(0)
    tmp = os.path.join(work, "assemble.tmp.xlsx")   # work dir: the Desktop mount refuses deletes
    with zipfile.ZipFile(sk) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename != name:
                zout.writestr(item, zin.read(item.filename)); continue
            with zout.open(name, "w", force_zip64=True) as w:
                w.write(head.encode()); w.write(b"<sheetData>"); w.write(row1.encode())
                for ch in chunks:
                    carry = b""
                    with gzip.open(ch, "rb") as fh:
                        while True:
                            b = fh.read(1 << 20)
                            if not b: break
                            w.write(b)
                            nrows += (carry + b).count(b"</row>") - carry.count(b"</row>")
                            carry = b[-5:]          # a '</row>' can straddle two reads
                w.write(b"</sheetData>")
                w.write(f'<autoFilter ref="A1:{last_col}{nrows + 1}"/>'.encode())
                w.write(tail.encode())
    # dimension ref lives in `head`; patch it in a second light pass over that one member
    with zipfile.ZipFile(tmp) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename != name:
                zout.writestr(item, zin.read(item.filename)); continue
            with zin.open(name) as rfh, zout.open(name, "w", force_zip64=True) as w:
                first = rfh.read(4096).decode()
                first = re.sub(r'<dimension ref="[^"]*"/>', f'<dimension ref="A1:{last_col}{nrows + 1}"/>', first, 1)
                w.write(first.encode())
                shutil.copyfileobj(rfh, w, 1 << 20)
    os.remove(tmp)
    print(f"wrote {out} ({os.path.getsize(out)/1e6:.1f} MB), {nrows:,} data rows, filter A1:{last_col}{nrows+1}")


if __name__ == "__main__":
    step, csv_path, work = sys.argv[1:4]
    if step == "prep": prep(csv_path, work)
    elif step == "chunk": chunk(csv_path, work)
    elif step == "assemble": assemble(csv_path, work, sys.argv[4])
    else: sys.exit(__doc__)

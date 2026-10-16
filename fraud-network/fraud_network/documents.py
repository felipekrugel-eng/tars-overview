"""Forensics on the files merchants send us.

Case LOY-FRAUD-2026-0924 turned on documents, and every finding a human made
by hand in that investigation is mechanical:

  * A Wells Fargo statement submitted for Deleon Black Construction still had
    an earlier revision inside it, addressed to Future Falls LLC at a New
    Jersey address. The file carries two %%EOF markers and a modification date
    four days after its creation date. Both are one line of code to spot.
  * Three invoices from three unrelated merchants each carried an embedded
    "Content Credentials" manifest naming ChatGPT. Three strangers do not
    independently submit AI-generated invoices in the same fortnight.
  * An IRS CP-575 letter was produced by openhtmltopdf, and a BlueVine bank
    letter by WeasyPrint. Neither institution renders its letters that way.

None of that proves forgery, and this module never says it does. A PDF
generator is not a crime, a modification date is not an edit anybody can name,
and an unauthenticated document is not a false one. What the module does is
find the documents a person should look at first, and say exactly why.

No network calls: everything here reads bytes already in hand.
"""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .model import CONFIRMED, Edge, STRONG, SUSPECTED

# Renderers that produce a PDF from markup. Legitimate everywhere; notable only
# when the document claims to come from an institution that has its own
# document system, such as a bank or a tax authority.
MARKUP_RENDERERS = (
    "openhtmltopdf", "weasyprint", "wkhtmltopdf", "prince", "puppeteer",
    "headless chrome", "dompdf", "tcpdf", "mpdf", "reportlab", "prawn",
)

# Institutions whose documents do not normally come out of a markup renderer.
CLAIMED_ISSUERS = (
    "irs", "internal revenue", "wells fargo", "chase", "jpmorgan", "bank of america",
    "bluevine", "m&t", "citibank", "capital one", "pnc", "truist", "us bank",
    "hmrc", "companies house", "secretary of state",
)

# ReportLab's untouched defaults. A real invoicing system fills these in.
DEFAULT_METADATA = {
    "author": {"anonymous", "unknown", "user"},
    "creator": {"anonymous", "unknown"},
    "title": {"untitled", "document", "untitled document"},
    "subject": {"unspecified", "none"},
}

AI_MARKERS = ("chatgpt", "openai", "dall-e", "midjourney", "firefly", "gemini",
              "claude", "stable diffusion")

MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], start=1)}


@dataclass
class Document:
    """One merchant-submitted file, and everything the bytes say about it."""

    account: str
    filename: str
    sha256: str
    size: int
    producer: str | None = None
    creator: str | None = None
    author: str | None = None
    title: str | None = None
    subject: str | None = None
    created: datetime | None = None
    modified: datetime | None = None
    revisions: int = 1
    embedded: list = field(default_factory=list)
    ai_generator: str | None = None
    text: str = ""
    # Text of the earliest revision still inside the file, when there is one.
    prior_text: str = ""
    # The account holder this document is supposed to belong to, when known.
    account_name: str | None = None

    @property
    def edited_after_creation(self):
        """True when the file was changed after it was first written.

        On its own this is ordinary. Alongside a second revision it is the
        signature of the Deleon statement.
        """
        if not (self.created and self.modified):
            return False
        return (self.modified - self.created).total_seconds() > 60

    @property
    def base_producer(self):
        """The producer that first wrote the file, without any editing suffix.

        iText appends "; modified using ..." when it rewrites an existing PDF,
        so the raw string differs between a file that was edited and its
        untouched sibling even though one tool made both.
        """
        if not self.producer:
            return None
        return re.split(r";\s*modified using", self.producer, maxsplit=1)[0].strip()

    @property
    def declares_modification(self):
        """The file states in its own metadata that it was edited after writing."""
        return bool(self.producer and re.search(r"modified using", self.producer, re.I))

    @property
    def generator_timestamp(self):
        """A key that is identical for two files made in the same render run."""
        if not (self.created and self.base_producer):
            return None
        return f"{self.base_producer}|{self.created.isoformat()}"


# A street address: a number, one to four capitalised words, a street type.
# Tightened deliberately - a loose pattern turns every "...0318 Card Purchase"
# line on a bank statement into an address.
STREET = re.compile(
    r"\b(\d{1,5})\s+((?:[A-Z][A-Za-z'\-]{1,14}\s+){0,3}[A-Z][A-Za-z'\-]{1,14})\s+"
    r"(ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|BLVD|BOULEVARD|LN|LANE|CT|COURT|"
    r"WAY|CIR|CIRCLE|PL|PLACE|TER|TERRACE|HWY|PKWY)\b\.?",
    re.IGNORECASE)

# A company name: capitalised words ending in a legal form.
COMPANY = re.compile(
    r"\b((?:[A-Z][A-Za-z'&\-]{1,20}\s+){1,5})(LLC|L\.L\.C\.|INC|INC\.|CORP|"
    r"CORPORATION|LLP|LP|LTD)\b", re.IGNORECASE)

STREET_NOISE = {"card", "purchase", "interest", "transfer", "payment", "balance",
                "deposit", "withdrawal", "check", "fee", "total", "page"}

# Bank statements prefix a counterparty with the rail that moved the money.
# "Zelle From Future Falls LLC" and "Future Falls LLC" are one company.
LEDGER_PREFIXES = ("ZELLE FROM", "ZELLE TO", "PAYPAL TRANSFER", "PAYMENT FROM",
                   "PAYMENT TO", "DEPOSIT FROM", "TRANSFER FROM", "TRANSFER TO",
                   "ACH CREDIT", "ACH DEBIT", "WIRE FROM", "WIRE TO", "PAID TO",
                   "BILL TO", "SHIP TO", "SOLD TO", "FROM", "TO")

# "32 Heckel Street" on an invoice and "32 HECKEL ST" on a bank statement are
# the same address. Without this they are two unrelated strings and the link
# between the documents is never made.
SUFFIX_CANON = {
    "STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "DRIVE": "DR",
    "BOULEVARD": "BLVD", "LANE": "LN", "COURT": "CT", "CIRCLE": "CIR",
    "PLACE": "PL", "TERRACE": "TER", "PARKWAY": "PKWY", "HIGHWAY": "HWY",
}


def street_addresses(text):
    """Street addresses appearing anywhere in a document's text."""
    out = set()
    for number, name, suffix in STREET.findall(text or ""):
        words = name.split()
        if any(w.lower() in STREET_NOISE for w in words):
            continue
        suffix = suffix.upper().replace(".", "")
        out.add(f"{number} {' '.join(words)} {SUFFIX_CANON.get(suffix, suffix)}".upper())
    return out


def company_names(text):
    """Company names appearing anywhere in a document's text."""
    out = set()
    for name, form in COMPANY.findall(text or ""):
        cleaned = " ".join(name.split()).upper().replace(".", "")
        for prefix in LEDGER_PREFIXES:
            if cleaned.startswith(prefix + " "):
                cleaned = cleaned[len(prefix) + 1:]
                break
        if len(cleaned) < 4:
            continue
        out.add(f"{cleaned} {form.upper()}".replace(".", ""))
    return out


def recover_previous_revision(raw):
    """The bytes of the earliest revision still present in an incremental PDF.

    An incremental save appends a new body and cross-reference table and
    leaves the original intact, so truncating at the first %%EOF yields a
    complete, readable copy of the document as it was before the edit. That is
    how the Future Falls version of the Deleon statement comes back without
    anybody opening a forensics tool.
    """
    marker = raw.find(b"%%EOF")
    if marker == -1 or raw.count(b"%%EOF") < 2:
        return None
    return raw[:marker + 5]


def _pdf_date(value):
    if not value:
        return None
    text = re.sub(r"^D:", "", str(value))
    match = re.match(r"(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?", text)
    if not match:
        return None
    parts = [int(p) if p else 0 for p in match.groups()]
    try:
        return datetime(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5])
    except ValueError:
        return None


def _ai_generator(blobs):
    """Read a C2PA Content Credentials manifest for the tool that made the file."""
    for blob in blobs:
        text = blob.decode("utf-8", "ignore") if isinstance(blob, bytes) else str(blob)
        lowered = text.lower()
        for marker in AI_MARKERS:
            if marker in lowered:
                # C2PA manifests are CBOR, so the model name arrives glued to
                # neighbouring keys ("gpt-5-6-thinkinggversionp..."). Keep the
                # leading version-like run and drop the rest rather than
                # printing the join artefact into a report.
                match = re.search(r"\b(gpt-[\w.]+(?:-[a-z]+)?|dall-e[\w.]*|claude-[\w.]+)", lowered)
                model = None
                if match:
                    model = re.sub(r"(?:gversion|dwhen|iversion).*$", "", match.group(1)).rstrip("-g")
                return f"{marker} {model}".strip() if model else marker
    return None


def inspect(path, account="unknown"):
    """Read one file. Never raises on a malformed document."""
    path = Path(path)
    raw = path.read_bytes()
    doc = Document(
        account=account,
        filename=path.name,
        sha256=hashlib.sha256(raw).hexdigest(),
        size=len(raw),
        # Each incremental save appends another %%EOF, so a count above one
        # means an earlier version of this file is still inside it.
        revisions=max(1, raw.count(b"%%EOF")),
    )
    if not raw.startswith(b"%PDF"):
        return doc

    try:
        import pypdf
    except ImportError:
        return doc

    # pypdf narrates damaged files to stderr. A damaged file is a finding, not
    # a reason to fill the sweep's log with library chatter.
    import logging
    logging.getLogger("pypdf").setLevel(logging.CRITICAL)

    try:
        reader = pypdf.PdfReader(str(path))
        meta = reader.metadata or {}
        doc.producer = str(meta.get("/Producer") or "") or None
        doc.creator = str(meta.get("/Creator") or "") or None
        doc.author = str(meta.get("/Author") or "") or None
        doc.title = str(meta.get("/Title") or "") or None
        doc.subject = str(meta.get("/Subject") or "") or None
        doc.created = _pdf_date(meta.get("/CreationDate"))
        doc.modified = _pdf_date(meta.get("/ModDate"))
        attachments = getattr(reader, "attachments", {}) or {}
        doc.embedded = sorted(attachments)
        doc.ai_generator = _ai_generator(
            [b for payloads in attachments.values() for b in payloads])
        doc.text = "\n".join((page.extract_text() or "") for page in reader.pages[:12])

        earlier = recover_previous_revision(raw)
        if earlier:
            try:
                import io
                prior = pypdf.PdfReader(io.BytesIO(earlier))
                doc.prior_text = "\n".join(
                    (page.extract_text() or "") for page in prior.pages[:12])
            except Exception:
                pass
    except Exception:
        # A file we cannot parse is itself worth reporting, but it must never
        # stop the sweep.
        pass
    return doc


def flags(doc):
    """Per-document observations, each phrased as a checkable fact."""
    out = []

    if doc.revisions > 1:
        out.append((STRONG,
                    f"{doc.filename} contains {doc.revisions} saved revisions, so an "
                    f"earlier version of it is still inside the submitted file."))

    if doc.prior_text:
        # The comparison that matters: not that the file was edited, but what
        # the edit changed. Names and addresses that were in the document
        # before the edit and are not in the version that was submitted.
        was = company_names(doc.prior_text) | street_addresses(doc.prior_text)
        now = company_names(doc.text) | street_addresses(doc.text)
        removed = sorted(was - now)
        added = sorted(now - was)
        if removed:
            out.append((STRONG,
                        f"The earlier revision inside {doc.filename} names "
                        f"{'; '.join(removed[:4])}, which does not appear in the version "
                        f"that was submitted."))
        if added:
            out.append((STRONG,
                        f"The submitted version of {doc.filename} names "
                        f"{'; '.join(added[:4])}, which does not appear in the earlier "
                        f"revision inside the same file."))

    if doc.edited_after_creation:
        gap = doc.modified - doc.created
        days = gap.days
        out.append((STRONG if doc.revisions > 1 else SUSPECTED,
                    f"{doc.filename} was created {doc.created:%Y-%m-%d %H:%M} and last "
                    f"modified {doc.modified:%Y-%m-%d %H:%M}, "
                    f"{days} day(s) later."))

    if doc.declares_modification:
        out.append((STRONG,
                    f"{doc.filename} records in its own metadata that it was modified after "
                    f"it was first written; its producer string reads "
                    f"\"{doc.producer[:110]}\". The file states this about itself."))

    if doc.ai_generator:
        out.append((STRONG,
                    f"{doc.filename} carries an embedded Content Credentials manifest "
                    f"naming {doc.ai_generator} as the tool that produced it."))

    foreign = company_names(doc.text) - {(doc.account_name or "").upper()}
    if doc.prior_text:
        lingering = foreign & company_names(doc.prior_text)
        if lingering:
            out.append((STRONG,
                        f"{doc.filename} was edited, but still names "
                        f"{'; '.join(sorted(lingering)[:3])} in its body - the same party "
                        f"that appears in the earlier revision. The edit changed the "
                        f"document's header without changing its contents."))

    producer = (doc.producer or "").lower()
    claimed = " ".join(filter(None, [doc.author, doc.creator, doc.title, doc.text[:2000]])).lower()
    if producer and any(r in producer for r in MARKUP_RENDERERS):
        issuer = next((i for i in CLAIMED_ISSUERS
                       if re.search(r"\b" + re.escape(i) + r"\b", claimed)), None)
        if issuer:
            out.append((SUSPECTED,
                        f"{doc.filename} presents itself as a document from "
                        f"{issuer.upper()} but was produced by {doc.producer}, a general "
                        f"markup-to-PDF renderer rather than that institution's own system."))

    defaults = [field_name for field_name, allowed in DEFAULT_METADATA.items()
                if (getattr(doc, field_name) or "").strip().lower() in allowed]
    # An absent field means the writer never set one; a field set to
    # "anonymous" means a generator wrote its own default and nobody
    # corrected it. Only the second is evidence of anything.
    if len(defaults) >= 3 and doc.producer:
        out.append((SUSPECTED,
                    f"{doc.filename} carries only its generator's placeholder metadata "
                    f"({', '.join(defaults)}), so no document system filled it in."))

    stated = _month_in_filename(doc.filename)
    covered = _months_in_text(doc.text)
    if stated and covered and stated not in covered:
        named = [k for k, v in MONTHS.items() if v in covered]
        out.append((SUSPECTED,
                    f"{doc.filename} is named for a month the document does not cover; "
                    f"its contents refer to {', '.join(sorted(named)).title()}."))

    return out


def _month_in_filename(filename):
    for name, number in MONTHS.items():
        if name in filename.lower():
            return number
    return None


def _months_in_text(text):
    return {MONTHS[m.lower()] for m in re.findall(
        r"\b(January|February|March|April|May|June|July|August|September|October|"
        r"November|December)\b", text or "")}


def set_flags(documents):
    """Observations that only exist across a merchant's whole submission.

    Montalto sent a certificate of standing and a certificate of formation,
    two documents a state registry issues on separate occasions. Both were
    written by the same generator in the same second.
    """
    out = []
    runs = defaultdict(list)
    for doc in documents:
        if doc.generator_timestamp:
            runs[doc.generator_timestamp].append(doc)
    for key, group in runs.items():
        if len(group) < 2:
            continue
        filenames = ", ".join(sorted(d.filename for d in group))
        out.append((STRONG,
                    f"{len(group)} separately submitted documents ({filenames}) were written "
                    f"by {group[0].producer} at the identical timestamp "
                    f"{key.split('|')[1][:19]}, so one render run produced them all."))

    seen = defaultdict(list)
    for doc in documents:
        seen[doc.sha256].append(doc.filename)
    for digest, filenames in seen.items():
        if len(set(filenames)) > 1:
            out.append((CONFIRMED,
                        f"The same file was submitted under {len(set(filenames))} different "
                        f"names ({', '.join(sorted(set(filenames)))})."))
    return out


def entity_edges(documents, names=None, registered=None, max_accounts=5):
    """Connections from what the documents say, not from how they were made.

    This is the detector that joins the Think Big case together. A recovered
    earlier revision inside the Deleon bank statement names Future Falls LLC
    at 32 Heckel Street; Think Big's own invoice carries the same street
    address. Neither account mentions the other anywhere in Stripe.

    `registered` maps an account to the names and addresses it legitimately
    declares, so a merchant is never linked to itself by its own letterhead.
    """
    names = names or {}
    registered = registered or {}

    by_entity = defaultdict(dict)
    for doc in documents:
        own = {str(v).upper() for v in registered.get(doc.account, [])}
        for source, label in ((doc.text, "the document"),
                              (doc.prior_text, "an earlier revision recovered from the file")):
            if not source:
                continue
            for entity in street_addresses(source) | company_names(source):
                if entity in own:
                    continue
                by_entity[entity].setdefault(doc.account, (doc.filename, label))

    edges = []
    for entity, accounts in sorted(by_entity.items()):
        if not 2 <= len(accounts) <= max_accounts:
            continue
        members = sorted(accounts)
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                file_a, where_a = accounts[a]
                file_b, where_b = accounts[b]
                edges.append(Edge(
                    a=a, b=b, kind="shared-document-entity", tier=STRONG,
                    statement=(f"\"{entity}\" appears in {where_a} {names.get(a, a)} sent "
                               f"({file_a}) and in {where_b} {names.get(b, b)} sent "
                               f"({file_b}). It is not the registered identity of either "
                               f"account."),
                    evidence={"identifier": entity, "accounts_sharing": len(accounts),
                              "documents": sorted([file_a, file_b])}))
    return edges


def document_edges(documents, names=None):
    """Connections between accounts that come from the files they sent."""
    names = names or {}

    def label(acct):
        return names.get(acct, acct)

    by_hash, by_run, by_ai, by_producer = (defaultdict(set) for _ in range(4))
    for doc in documents:
        by_hash[doc.sha256].add(doc.account)
        if doc.generator_timestamp:
            by_run[doc.generator_timestamp].add(doc.account)
        if doc.ai_generator:
            by_ai[doc.ai_generator.split()[0]].add(doc.account)
        if doc.base_producer:
            by_producer[doc.base_producer].add(doc.account)

    edges = []

    def emit(groups, kind, tier, sentence, cap=8):
        for value, accounts in groups.items():
            members = sorted(accounts)
            if not 2 <= len(members) <= cap:
                continue
            for i, a in enumerate(members):
                for b in members[i + 1:]:
                    edges.append(Edge(a=a, b=b, kind=kind, tier=tier,
                                      statement=sentence(label(a), label(b), value, len(members)),
                                      evidence={"identifier": str(value)[:120],
                                                "accounts_sharing": len(members)}))

    # The same file, byte for byte, submitted by two merchants.
    emit(by_hash, "identical-document", CONFIRMED,
         lambda a, b, v, n: (f"{a} and {b} submitted a byte-identical file "
                             f"(SHA-256 {v[:16]}...)."))

    # Two documents written by the same generator in the same second are one
    # render run. Montalto's certificate of standing and certificate of
    # formation share a timestamp to the second.
    emit(by_run, "same-render-run", STRONG,
         lambda a, b, v, n: (f"Documents submitted by {a} and {b} were produced by the same "
                             f"generator at the same instant ({v.split('|')[1][:19]}), which "
                             f"means one render run produced both."))

    # Different merchants whose official-looking paperwork came out of the
    # same library build. Weak on its own - plenty of systems use iText - so
    # it is capped hard and never rises above a lead.
    emit(by_producer, "same-document-generator", SUSPECTED,
         lambda a, b, v, n: (f"Documents submitted by {a} and {b} were produced by the same "
                             f"software build ({v[:60]}); {n} accounts in this sweep used it."),
         cap=4)

    # Three unrelated merchants submitting AI-generated invoices inside a
    # fortnight is a lead, not proof: the tool is available to everybody.
    emit(by_ai, "shared-ai-provenance", SUSPECTED,
         lambda a, b, v, n: (f"{a} and {b} both submitted documents carrying {v} "
                             f"provenance metadata; {n} accounts in this sweep did so."),
         cap=6)

    return edges

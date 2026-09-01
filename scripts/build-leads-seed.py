#!/usr/bin/env python3
"""Convertit l'export CSV « Leads » en SQL d'import.

Usage: python3 scripts/build-leads-seed.py <chemin.csv> > supabase/seed/leads.sql
"""
import csv
import re
import sys
from datetime import datetime

STATUS_MAP = {
    "": "nouveau",
    "a contacter": "a_contacter",
    "nrp": "nrp",
    "nrp2": "nrp2",
    "nrp 2": "nrp2",
    "nrp3": "nrp3",
    "nrp 3": "nrp3",
    "raccroche avant pitch": "raccroche_avant_pitch",
    "a recontacter": "a_recontacter",
    "pas interesse": "pas_interesse",
    "non qualifie": "non_qualifie",
    "call pris": "call_pris",
}

ACCENTS = str.maketrans("àâäéèêëîïôöùûüç", "aaaeeeeiioouuuc")

COLUMNS = [
    "first_name", "last_name", "full_name", "email", "phone", "company_name",
    "company_website", "company_activity", "sector", "region", "address",
    "linkedin_url", "revenue", "owner_name", "comment", "follow_up_on",
    "created_at", "status", "source", "segment",
]


def norm_status(raw):
    key = re.sub(r"\s+", " ", (raw or "").strip().lower().translate(ACCENTS))
    return STATUS_MAP.get(key, "nouveau")


def norm_money(raw):
    """« €3811533,00 » -> 3811533.00"""
    if not raw:
        return None
    cleaned = re.sub(r"[^\d,.-]", "", raw).replace(".", "").replace(",", ".")
    try:
        value = float(cleaned)
    except ValueError:
        return None
    return None if value == 0 else round(value, 2)


def norm_date(raw):
    """Les exports sont au format J/M/AAAA, éventuellement suivi d'une heure."""
    if not raw or not raw.strip():
        return None
    token = raw.strip().split(" ")[0]
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(token, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def lit(value, cast=None):
    if value is None or value == "":
        return "null" + (f"::{cast}" if cast else "")
    if isinstance(value, (int, float)):
        return str(value)
    # E'...' pour neutraliser les retours à la ligne présents dans les
    # commentaires, afin que chaque tuple tienne sur une seule ligne.
    text = str(value).replace("\\", "\\\\").replace("'", "\\'")
    text = text.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")
    return f"E'{text}'" + (f"::{cast}" if cast else "")


def main():
    rows = list(csv.DictReader(open(sys.argv[1], encoding="utf-8-sig")))
    tuples = []

    for r in rows:
        def get(key):
            return (r.get(key) or "").strip()

        first, last = get("Prénom"), get("Nom")
        # La colonne « fullname » de l'export ne contient pas un nom mais le
        # libellé de campagne (« 2026-03 - DG / Bureau d'ingénierie / ... »).
        full = get("Name") or f"{first} {last}".strip()
        if not full and not get("E-mail"):
            continue

        created = norm_date(get("Date de création"))
        cells = [
            lit(first), lit(last), lit(full), lit(get("E-mail")), lit(get("Tél")),
            lit(get("Entreprise")), lit(get("Site entreprise")), lit(get("Activité")),
            lit(get("Secteur")), lit(get("Région")), lit(get("Adresse")),
            lit(get("Url LinkedIn")), lit(norm_money(get("Valeur CA "))),
            lit(get("Owner")), lit(get("Commentaire")),
            lit(norm_date(get("Relance")), "date"),
            lit(created, "timestamptz") if created else "now()",
            lit(norm_status(get("Statut")), "public.lead_status"),
            "'import_csv'", lit(get("fullname")),
        ]
        tuples.append("  (" + ", ".join(cells) + ")")

    print("-- Généré par scripts/build-leads-seed.py — ne pas éditer à la main.")
    print(f"insert into public.leads ({', '.join(COLUMNS)}) values")
    print(",\n".join(tuples) + ";")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Importe un export CSV « Leads » dans la table public.leads via PostgREST.

Usage:
  SUPABASE_URL=... SUPABASE_KEY=... python3 scripts/import-leads.py <chemin.csv>

Le script est idempotent au sens où il n'écrase rien : il ajoute les lignes du
CSV. Pour un ré-import propre, vider la table au préalable.
"""
import csv
import json
import os
import re
import sys
import urllib.request
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


def to_row(record):
    def get(key):
        return (record.get(key) or "").strip() or None

    first, last = get("Prénom"), get("Nom")
    # La colonne « fullname » de l'export ne porte pas un nom mais le libellé de
    # campagne (« 2026-03 - DG / Bureau d'ingénierie / Normandie / 20-99 »).
    full = get("Name") or " ".join(filter(None, [first, last])) or None
    if not full and not get("E-mail"):
        return None

    created = norm_date(get("Date de création") or "")
    return {
        "first_name": first,
        "last_name": last,
        "full_name": full,
        "email": get("E-mail"),
        "phone": get("Tél"),
        "company_name": get("Entreprise"),
        "company_website": get("Site entreprise"),
        "company_activity": get("Activité"),
        "sector": get("Secteur"),
        "region": get("Région"),
        "address": get("Adresse"),
        "linkedin_url": get("Url LinkedIn"),
        "revenue": norm_money(get("Valeur CA ") or ""),
        "owner_name": get("Owner"),
        "comment": get("Commentaire"),
        "follow_up_on": norm_date(get("Relance") or ""),
        "created_at": f"{created}T09:00:00Z" if created else None,
        "status": norm_status(get("Statut") or ""),
        "segment": get("fullname"),
        "source": "import_csv",
    }


def main():
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]
    path = sys.argv[1]

    with open(path, encoding="utf-8-sig") as handle:
        rows = [row for row in (to_row(r) for r in csv.DictReader(handle)) if row]
    rows = [{k: v for k, v in row.items() if v is not None} for row in rows]

    for start in range(0, len(rows), 100):
        batch = rows[start:start + 100]
        request = urllib.request.Request(
            f"{url}/rest/v1/leads",
            data=json.dumps(batch).encode(),
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            print(f"lot {start // 100 + 1} : {len(batch)} leads -> HTTP {response.status}")

    print(f"{len(rows)} leads importés.")


if __name__ == "__main__":
    main()

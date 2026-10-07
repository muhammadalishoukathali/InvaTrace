"""Build evidence and an honest topic audit from the current reviewed catalogue."""

import argparse
import csv
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "shared" / "catalogue"

# Reviewed impact paragraphs with explicit seed, dispersal or re-establishment
# facts. A generic statement that a weed spreads is not a pathway description.
SPREAD_IN_IMPACT = frozenset(
    {
        "bidens-pilosa",
        "chromolaena-odorata",
        "cynodon-dactylon",
        "eleusine-indica",
        "impatiens-balsamina",
        "mikania-micrantha",
        "mimosa-diplotricha",
        "mimosa-pigra",
        "oxalis-corniculata",
        "psidium-guajava",
        "ruellia-blechum",
        "sida-acuta",
    }
)
TOXICITY_WARNINGS_IN_IMPACT = frozenset(
    {
        "asclepias-curassavica",
        "parthenium-hysterophorus",
        "rottboellia-cochinchinensis",
    }
)


def read(name):
    return json.loads((CATALOGUE / name).read_text())


def build(*, write_summary=True):
    reviewed = json.loads((ROOT / "data/assistant-reviewed-evidence.json").read_text())
    spread = {item["species_id"]: item for item in reviewed["spread"]}
    hazards = reviewed["hazards"]
    revisions = {r["chunk_id"]: r for r in reviewed.get("runtime_revisions", [])}
    approved = read("approved-species.json")
    details = read("catalogue-details.json")
    status = read("plant-status.json")
    sources = {s["source_id"]: s for s in approved["sources"] + details["sources"]}
    records = {r["species_id"]: r for r in approved["records"]}
    statuses = {r["species_id"]: r for r in status["records"]}
    assert len(records) == 32 and set(records) == set(statuses)
    chunks = []
    rows = []
    fields = {
        "identification": "identifying_characteristics",
        "habitat": "typical_habitat",
        "impact": "documented_impacts",
        "safe_response": "safe_response_guidance",
    }
    source_topics = {"impact": "impacts", "safe_response": "guidance"}
    for record in details["records"]:
        species_id = record["species_id"]
        species = records[species_id]
        row = {"species": species["scientific_name"]}
        for topic, field in fields.items():
            content = record[field]
            if isinstance(content, list):
                content = " ".join(content)
            ids = record["source_ids"][source_topics.get(topic, topic)]
            metadata = [sources[sid] for sid in ids]
            chunks.append(
                {
                    "chunk_id": f"CAT-{species_id}-{topic}",
                    "species_id": species_id,
                    "species": species["scientific_name"],
                    "topic": topic,
                    "content": content,
                    "source_name": metadata[0]["title"],
                    "source_url": metadata[0]["url"],
                    "sources": metadata,
                    "jurisdiction": "Malaysia project-reviewed summary",
                    "source_date": None,
                    "reviewed_at": record["reviewed_at"],
                    "provenance": "Project-owned paraphrase from the approved catalogue; no source full text.",
                    "reuse_status": "existing_project_owned_summary",
                }
            )
            revision = revisions.get(chunks[-1]["chunk_id"])
            if revision:
                chunks[-1].update(revision)
                chunks[-1]["source_name"] = revision["sources"][0]["title"]
                chunks[-1]["source_url"] = revision["sources"][0]["url"]
            row[topic] = (
                "SUPPORTED" if chunks[-1]["content"] and chunks[-1]["sources"] else "MISSING"
            )
        # Keep the complete approved paragraph and its citations: source
        # qualifications must survive reuse under an additional topic.
        if species_id in SPREAD_IN_IMPACT:
            impact = next(
                c for c in chunks if c["species_id"] == species_id and c["topic"] == "impact"
            )
            chunks.append(
                dict(
                    impact,
                    chunk_id=f"CAT-{species_id}-spread-impact",
                    topic="spread",
                    provenance="Complete existing approved impact paragraph, reviewed for explicit propagation facts.",
                )
            )
        # Trait labels/URLs alone are not reviewed dispersal facts. Only the
        # separately reviewed short factual additions can replace placeholders.
        addition = spread.get(species_id)
        if addition and addition["evidence_status"] == "reviewed":
            metadata = addition["sources"]
            content = addition["content"]
            chunks.append(
                {
                    "chunk_id": f"CAT-{species_id}-spread",
                    "species_id": species_id,
                    "species": species["scientific_name"],
                    "topic": "spread",
                    "content": content,
                    "source_name": metadata[0]["title"],
                    "source_url": metadata[0]["url"],
                    "sources": metadata,
                    "jurisdiction": addition["jurisdiction"],
                    "source_date": None,
                    "reviewed_at": addition["reviewed_at"],
                    "provenance": addition["provenance"],
                    "evidence_status": "reviewed",
                    "reuse_status": "reviewed_short_paraphrase_cc_by_4_0",
                }
            )
            row["spread"] = "PARTIAL"
        else:
            row["spread"] = "PARTIAL" if species_id in SPREAD_IN_IMPACT else "MISSING"
        for hazard in hazards:
            if hazard["species_id"] == species_id and hazard["evidence_status"] == "reviewed":
                chunks.append(
                    dict(
                        hazard,
                        species=species["scientific_name"],
                        source_name=hazard["sources"][0]["title"],
                        source_url=hazard["sources"][0]["url"],
                        source_date=None,
                    )
                )
        row.update(
            toxicity_handling="PARTIAL" if species_id in TOXICITY_WARNINGS_IN_IMPACT else "MISSING",
            removal="PARTIAL",
            lookalike="MISSING",
            reporting="PARTIAL",
        )
        row["notes"] = (
            "Safe-response instructions do not establish toxicity. Removal requires site permission; reporting has no verified local recipient."
        )
        if species_id in TOXICITY_WARNINGS_IN_IMPACT:
            row["notes"] += (
                " Existing impact text includes a toxicity/irritation warning, but does not establish safe touching or individual medical advice; dedicated scoped hazard statements are supported, not medical advice or safety assurance."
            )
        own = [c for c in chunks if c["species_id"] == species_id]
        row["source_count"] = len({s["url"] for c in own for s in c["sources"]})
        rows.append(row)
    for chunk in chunks:
        chunk["safety_critical"] = chunk["topic"] in {"safe_response", "documented_hazards"} or (
            chunk["species_id"] in TOXICITY_WARNINGS_IN_IMPACT
            and chunk["topic"] in {"impact", "spread"}
        )
        direct = reviewed.get("direct_support", {}).get(chunk["chunk_id"])
        if direct:
            chunk["direct_support"] = direct
    output = ROOT / "backend" / "app" / "data" / "plant-assistant-knowledge.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "catalogue_version": approved["catalogue_version"],
                "species_count": 32,
                "chunk_count": len(chunks),
                "chunks": chunks,
            },
            indent=2,
        )
        + "\n"
    )
    keys = [
        "species",
        "identification",
        "habitat",
        "impact",
        "spread",
        "safe_response",
        "toxicity_handling",
        "removal",
        "lookalike",
        "reporting",
        "source_count",
        "notes",
    ]
    with (ROOT / "data" / "knowledge_coverage_matrix.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=keys, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    lines = [
        "# Knowledge coverage",
        "",
        "32 supported plant categories; Unknown/Other is excluded. Topic coverage describes the available summary, not every possible question within that topic.",
        "",
        "| Topic | SUPPORTED | PARTIAL | MISSING |",
        "|---|---:|---:|---:|",
    ]
    for key in keys[1:10]:
        counts = Counter(row[key] for row in rows)
        lines.append(
            f"| {key} | {counts['SUPPORTED']} | {counts['PARTIAL']} | {counts['MISSING']} |"
        )
    lines += [
        "",
        f"128 catalogue chunks cover four core topics for all 32 categories. {len(SPREAD_IN_IMPACT)} complete impact paragraphs also provide propagation evidence. {len(spread)} independently reviewed short spread additions replace the old water templates. Spread remains partial species/topic coverage, not every pathway; missing species remain unsupported.",
        "",
        "Short new factual paraphrases have recorded government sources, attribution, licence/provenance and review context in data/assistant-reviewed-evidence.json. Existing saved sources were reused first. No DOA/MyBIS prose, GISD/CABI text, images, foreign control/law/contacts or full source corpus was imported into runtime. Foreign botanical references do not establish Malaysian law, local presence or site permission.",
        "",
        "Three impact summaries already contain toxicity/irritation warnings: Asclepias curassavica, Parthenium hysterophorus and Rottboellia cochinchinensis. They are recorded as PARTIAL, not MISSING, but do not establish safe touching or specific human/animal medical advice. Four dedicated hazard facts for these three species preserve the reviewed uncertainty/conditions and have scoped contact, handling, inhalation or ingestion applicability. Missing hazards do not establish safety. Lookalikes and named reporting recipients remain unsupported. Conditional safe-response instructions are not complete removal protocols. Legal, quantitative and site-specific claims require separate verified evidence.",
        "",
        f"Next data priority: sourced, rights-cleared spread summaries for the {32 - len({c['species_id'] for c in chunks if c['topic'] == 'spread'})} missing categories, then independent review of the {len({c['species_id'] for c in chunks if c['topic'] == 'spread'})} partial pathway records and core summaries. Reuse existing approved facts before collecting anything new. Refusals remain appropriate; data volume is not an acceptance metric.",
    ]
    if write_summary:
        (ROOT / "reports" / "knowledge_coverage_summary.md").write_text("\n".join(lines) + "\n")
    print(
        f"{len(records)} species, {len(chunks)} evidence chunks; {len(SPREAD_IN_IMPACT)} existing spread paragraphs and {len(spread)} reviewed spread additions"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-summary-report",
        action="store_true",
        help="Rebuild runtime/CSV without changing the historical coverage report",
    )
    build(write_summary=not parser.parse_args().skip_summary_report)

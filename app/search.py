"""Moteur de rapprochement question -> réponse, 100 % hors ligne.

Trois signaux complémentaires, combinés en un score de confiance calibré :

  1. BM25 sur des fréquences de termes pondérées par champ
     (la question pèse plus que le corps de la réponse).
  2. Couverture : part des termes de la question retrouvés dans le document.
     Signal très robuste, peu sensible à la longueur des textes.
  3. Similarité trigrammes : rattrape fautes de frappe et variantes morpho.

Puis des modulateurs métier : correspondance de référence normative,
appartenance au bon client, statut de validation de l'entrée.

Règle de confidentialité structurante : une entrée rattachée à un client n'est
JAMAIS proposée pour un autre client. Seules les entrées génériques
(client_id NULL) sont partagées.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

from . import textproc

# Pondération des champs dans l'index (fréquences de termes multipliées).
FIELD_WEIGHTS = {"title": 3, "tags": 2, "refs": 3, "category": 1, "body": 1}

# Paramètres BM25 classiques.
BM25_K1 = 1.4
BM25_B = 0.72

# Saturation du score BM25 vers [0, 1[. Volontairement asymptotique plutôt
# qu'écrêtée : un écrêtage à 1,0 met à égalité tous les documents qui dépassent
# le plafond, ce qui détruit le classement dès que la requête tient en un seul
# terme — cas fréquent après retrait des mots vides.
BM25_SATURATION = 1.8

# Amortissement de spécificité : une requête portant peu d'information (un mot,
# ou des mots très fréquents) ne peut pas atteindre la confiance haute, même sur
# une correspondance parfaite. La somme des IDF mesure cette information.
SPECIFICITY_FULL = 5.0
SPECIFICITY_FLOOR = 0.70

# Combinaison des signaux (somme = 1).
W_BM25 = 0.42
W_COVERAGE = 0.40
W_TRIGRAM = 0.18

REF_BONUS = 0.25
CLIENT_FACTOR = {"own": 1.0, "generic": 0.85}
STATUS_FACTOR = {"validated": 1.0, "draft": 0.85, "obsolete": 0.45}

# Seuils de confiance exposés dans l'interface. LOW est le plancher en dessous
# duquel aucune réponse n'est proposée : mieux vaut « aucune correspondance »
# qu'une suggestion hors sujet, qui coûte plus cher à corriger qu'à écrire.
HIGH = 0.62
MEDIUM = 0.38
LOW = 0.28


def band(confidence: float) -> str:
    if confidence >= HIGH:
        return "haute"
    if confidence >= MEDIUM:
        return "moyenne"
    if confidence >= LOW:
        return "faible"
    return "aucune"


@dataclass
class Document:
    """Unité indexable : une entrée de base de connaissance ou une configuration."""

    kind: str                    # 'kb' | 'config'
    id: int
    client_id: int | None
    title: str
    body: str
    category: str = ""
    tags: str = ""
    status: str = "validated"
    refs: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    # Rempli à l'indexation.
    tf: Counter = field(default_factory=Counter, repr=False)
    term_set: frozenset[str] = field(default_factory=frozenset, repr=False)
    length: int = 0
    ref_set: frozenset[str] = field(default_factory=frozenset, repr=False)
    # Calculé à la première comparaison puis conservé : inutile de payer les
    # trigrammes de titres que personne n'interroge.
    title_trigrams: frozenset[str] | None = field(default=None, repr=False)


@dataclass
class Match:
    document: Document
    confidence: float
    bm25: float
    coverage: float
    trigram: float
    ref_hit: bool
    matched_terms: list[str]

    def as_dict(self) -> dict[str, Any]:
        doc = self.document
        return {
            "kind": doc.kind,
            "id": doc.id,
            "client_id": doc.client_id,
            "title": doc.title,
            "body": doc.body,
            "category": doc.category,
            "status": doc.status,
            "refs": doc.refs,
            "confidence": round(self.confidence, 4),
            "band": band(self.confidence),
            "ref_hit": self.ref_hit,
            "matched_terms": self.matched_terms[:12],
            "extra": doc.extra,
        }


class SearchIndex:
    """Index inversé léger, construit une fois puis interrogé en boucle."""

    def __init__(self, documents: Iterable[Document]):
        self.documents: list[Document] = []
        # Listes d'affichage terme -> documents. Sans elles, chaque recherche
        # parcourrait tout le corpus pour n'en scorer qu'une poignée.
        self.postings: dict[str, list[int]] = {}
        self.ref_postings: dict[str, list[int]] = {}
        df: Counter = Counter()

        for doc in documents:
            tf: Counter = Counter()
            for field_name, weight in FIELD_WEIGHTS.items():
                raw = getattr(doc, field_name)
                text = " ".join(raw) if isinstance(raw, list) else (raw or "")
                if not text:
                    continue
                for term in textproc.terms(text):
                    tf[term] += weight
            doc.tf = tf
            doc.term_set = frozenset(tf)
            doc.length = sum(tf.values())
            doc.ref_set = frozenset(r.upper() for r in doc.refs)
            df.update(doc.term_set)

            position = len(self.documents)
            for term in doc.term_set:
                self.postings.setdefault(term, []).append(position)
            for ref in doc.ref_set:
                self.ref_postings.setdefault(ref, []).append(position)
            self.documents.append(doc)

        n = len(self.documents)
        self.n = n
        self.avg_length = (sum(d.length for d in self.documents) / n) if n else 1.0
        self.idf: dict[str, float] = {
            term: math.log(1 + (n - count + 0.5) / (count + 0.5))
            for term, count in df.items()
        }
        # Terme absent du corpus : idf maximal (il discrimine totalement).
        self.default_idf = math.log(1 + (n + 0.5) / 0.5) if n else 1.0

    def search(
        self,
        query: str,
        client_id: int | None = None,
        top_k: int = 5,
        kinds: Sequence[str] | None = None,
    ) -> list[Match]:
        query_terms = textproc.terms(query)
        if not query_terms:
            return []

        distinct = list(dict.fromkeys(query_terms))
        query_tf = Counter(query_terms)
        query_refs = frozenset(textproc.extract_refs(query))
        sum_idf = sum(self.idf.get(t, self.default_idf) for t in distinct) or 1.0
        bm25_reference = 1.5 * sum_idf
        specificity = SPECIFICITY_FLOOR + (1 - SPECIFICITY_FLOOR) * min(
            1.0, sum_idf / SPECIFICITY_FULL
        )

        # Seuls les documents partageant au moins un terme (ou une référence)
        # avec la question méritent d'être scorés.
        candidates: set[int] = set()
        for term in distinct:
            candidates.update(self.postings.get(term, ()))
        for ref in query_refs:
            candidates.update(self.ref_postings.get(ref, ()))

        query_trigrams = textproc.trigrams(query)

        matches: list[Match] = []
        for position in candidates:
            doc = self.documents[position]
            # Cloisonnement client : jamais de fuite d'un dossier vers un autre.
            if doc.client_id is not None and doc.client_id != client_id:
                continue
            if kinds and doc.kind not in kinds:
                continue

            score = 0.0
            hits: list[str] = []
            norm = BM25_K1 * (1 - BM25_B + BM25_B * doc.length / (self.avg_length or 1))
            for term in distinct:
                freq = doc.tf.get(term, 0)
                if not freq:
                    continue
                hits.append(term)
                idf = self.idf.get(term, self.default_idf)
                score += idf * (freq * (BM25_K1 + 1)) / (freq + norm) * min(query_tf[term], 3)

            # Couverture pondérée par l'IDF : retrouver « chiffrement au repos »
            # vaut bien plus que retrouver « données ». Une couverture en nombre
            # brut de termes traiterait les deux à égalité.
            coverage = sum(self.idf.get(t, self.default_idf) for t in hits) / sum_idf
            bm25_norm = 1.0 - math.exp(-BM25_SATURATION * score / bm25_reference)

            if doc.title_trigrams is None:
                doc.title_trigrams = frozenset(textproc.trigrams(doc.title))
            union = query_trigrams | doc.title_trigrams
            trigram = len(query_trigrams & doc.title_trigrams) / len(union) if union else 0.0

            confidence = (
                W_BM25 * bm25_norm + W_COVERAGE * coverage + W_TRIGRAM * trigram
            )
            ref_hit = bool(query_refs & doc.ref_set)
            if ref_hit:
                confidence += REF_BONUS

            scope = "own" if doc.client_id is not None else "generic"
            confidence *= CLIENT_FACTOR[scope]
            confidence *= STATUS_FACTOR.get(doc.status, 0.8)
            confidence *= specificity
            confidence = max(0.0, min(1.0, confidence))

            if confidence < 0.05:
                continue
            matches.append(
                Match(doc, confidence, bm25_norm, coverage, trigram, ref_hit, hits)
            )

        matches.sort(key=lambda m: m.confidence, reverse=True)
        return matches[:top_k]


# --------------------------------------------------------------------------
# Construction de l'index à partir de la base
#
# L'indexation est linéaire en nombre d'entrées (~0,8 s pour 1 000 entrées) et
# serait sinon refaite à chaque requête. On garde donc l'index en mémoire,
# invalidé par un jeton dérivé de la base plutôt que par un compteur applicatif :
# ainsi une modification faite hors de l'application est aussi détectée.
# --------------------------------------------------------------------------

_INDEX_CACHE: dict[int | None, tuple[tuple, SearchIndex]] = {}
_CACHE_MAX = 8


def _cache_token(conn, client_id: int | None) -> tuple:
    """Empreinte bon marché du contenu indexé : nombre, dernier identifiant,
    dernière modification. Toute création, suppression ou édition la change."""
    kb = conn.execute(
        """SELECT COUNT(*), COALESCE(MAX(id), 0), COALESCE(MAX(updated_at), '')
           FROM kb_entry
           WHERE status != 'obsolete' AND (client_id IS NULL OR client_id = ?)""",
        (client_id,),
    ).fetchone()
    cfg = conn.execute(
        """SELECT COUNT(*), COALESCE(MAX(id), 0), COALESCE(MAX(updated_at), '')
           FROM config_item WHERE client_id = ?""",
        (client_id,),
    ).fetchone()
    return (tuple(kb), tuple(cfg))


def build_index(conn, client_id: int | None = None) -> SearchIndex:
    """Index des entrées génériques, de celles du client, et de ses configs.

    Renvoie l'index mémorisé tant que le contenu indexé n'a pas changé.
    """
    token = _cache_token(conn, client_id)
    cached = _INDEX_CACHE.get(client_id)
    if cached and cached[0] == token:
        return cached[1]

    index = _build_index_uncached(conn, client_id)
    _INDEX_CACHE[client_id] = (token, index)
    while len(_INDEX_CACHE) > _CACHE_MAX:
        _INDEX_CACHE.pop(next(iter(_INDEX_CACHE)))
    return index


def _build_index_uncached(conn, client_id: int | None) -> SearchIndex:
    docs: list[Document] = []

    kb_sql = """
        SELECT e.*, GROUP_CONCAT(c.ref, '|') AS ctrl_refs
        FROM kb_entry e
        LEFT JOIN kb_control kc ON kc.kb_entry_id = e.id
        LEFT JOIN control c ON c.id = kc.control_id
        WHERE e.status != 'obsolete' AND (e.client_id IS NULL OR e.client_id = ?)
        GROUP BY e.id
    """
    for row in conn.execute(kb_sql, (client_id,)):
        refs = [r for r in (row["ctrl_refs"] or "").split("|") if r]
        refs += textproc.extract_refs(row["question"] or "")
        docs.append(
            Document(
                kind="kb",
                id=row["id"],
                client_id=row["client_id"],
                title=row["question"],
                body=row["answer"],
                category=row["category"] or "",
                tags=row["tags"] or "",
                status=row["status"],
                refs=sorted(set(refs)),
                extra={"evidence": row["evidence"], "source": row["source"]},
            )
        )

    if client_id is not None:
        cfg_sql = "SELECT * FROM config_item WHERE client_id = ?"
        for row in conn.execute(cfg_sql, (client_id,)):
            docs.append(
                Document(
                    kind="config",
                    id=row["id"],
                    client_id=row["client_id"],
                    # Le libellé et la catégorie forment la « question » implicite.
                    title=f"{row['category']} — {row['label']}",
                    body=f"{row['value']} {row['details'] or ''} {row['scope'] or ''}",
                    category=row["category"] or "",
                    tags=row["scope"] or "",
                    status="validated" if row["status"] == "en place" else "draft",
                    extra={
                        "label": row["label"],
                        "value": row["value"],
                        "details": row["details"],
                        "scope": row["scope"],
                        "state": row["status"],
                    },
                )
            )

    return SearchIndex(docs)


# --------------------------------------------------------------------------
# Composition de la réponse proposée
# --------------------------------------------------------------------------

def _config_line(match: Match, with_details: bool = True) -> str:
    extra = match.document.extra
    line = f"- {extra['label']} : {extra['value']}"
    if with_details and extra.get("details"):
        line += f" ({extra['details']})"
    return line


def compose_answer(matches: Sequence[Match]) -> tuple[str, float, Match | None]:
    """Rédige une proposition de réponse à partir des meilleurs candidats.

    Deux comportements qui font la différence en usage réel :

    * Quand plusieurs *configurations* d'une même famille répondent à la
      question (« décrivez le chiffrement mis en place » -> au repos, en
      transit, gestion des clés), elles sont agrégées plutôt que d'en retenir
      une seule arbitrairement.
    * Quand la meilleure réponse est une entrée de base de connaissance
      — souvent une formulation de principe — les configurations du client qui
      matchent aussi sont ajoutées en précisions. C'est ce qui transforme
      « nous chiffrons selon l'état de l'art » en « ... AES-256-GCM au repos,
      TLS 1.3 en transit ».
    """
    if not matches:
        return "", 0.0, None

    best = matches[0]
    if best.confidence < LOW:
        return "", best.confidence, None

    if best.document.kind == "config":
        family = [
            m
            for m in matches
            if m.document.kind == "config"
            and m.document.category == best.document.category
            and m.confidence >= max(MEDIUM, best.confidence * 0.75)
        ]
        if len(family) > 1:
            return "\n".join(_config_line(m) for m in family), best.confidence, best

        extra = best.document.extra
        text = f"{extra['label']} : {extra['value']}"
        if extra.get("details"):
            text += f"\n{extra['details']}"
        if extra.get("scope"):
            text += f"\nPérimètre : {extra['scope']}"
        return text, best.confidence, best

    text = best.document.body
    threshold = max(0.25, best.confidence * 0.45)
    configs = [
        m for m in matches[1:]
        if m.document.kind == "config" and m.confidence >= threshold
    ]
    if configs:
        precisions = "\n".join(_config_line(m, with_details=False) for m in configs[:4])
        text = f"{text}\n\nÉléments de configuration en place :\n{precisions}"

    return text, best.confidence, best

"""Normalisation textuelle bilingue FR/EN et extraction de références normatives.

Chaîne de traitement d'un texte :
    texte brut
      -> repli des accents + minuscules
      -> repli des expressions multi-mots (thesaurus.PHRASES)
      -> tokenisation
      -> retrait des mots vides
      -> repli sur la forme canonique (thesaurus.CANONICAL), sinon désuffixation
    -> liste de termes comparables

Les références normatives (A.8.24, IS.I.OR.205, CC6.1...) sont extraites du
texte *brut*, avant normalisation, car la ponctuation y porte le sens.
"""

from __future__ import annotations

import re
import unicodedata

from .thesaurus import CANONICAL, CONNECTORS, PHRASES, STOPWORDS

_NON_WORD = re.compile(r"[^a-z0-9]+")
_WS = re.compile(r"\s+")

# Désuffixation légère, ordonnée du suffixe le plus long au plus court.
_SUFFIXES: tuple[str, ...] = (
    "issements", "issement", "ationnel", "ations", "atrices", "ateurs", "ements",
    "isation", "atrice", "ateur", "ement", "ances", "ences", "ation", "ition",
    "sions", "tions", "ities", "ques", "eurs", "euse", "ives", "elle", "sion",
    "tion", "ance", "ence", "ings", "ique", "aux", "eur", "ive", "els", "ing",
    "ers", "ees", "ies", "er", "ee", "es", "ez", "s", "e",
)
_MIN_STEM = 4

# Références normatives reconnues, du motif le plus spécifique au plus général.
_REF_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bIS\.[ID]\.(?:OR|AR)\.\d{3}(?:\([a-z0-9]+\))?", re.I),   # EASA Part-IS
    re.compile(r"\bA\.\s?\d{1,2}\.\d{1,2}\b"),                              # ISO 27001 Annexe A
    re.compile(r"\bCC\d\.\d{1,2}\b", re.I),                                 # SOC 2
    re.compile(r"\b(?:ID|PR|DE|RS|RC|GV)\.[A-Z]{2}-\d{1,2}\b"),             # NIST CSF
    re.compile(r"\bart(?:icle)?\.?\s*\d{1,2}(?:\.\d{1,2})?\b", re.I),       # NIS2 / DORA
)


def strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalize(text: str) -> str:
    """Minuscules, sans accents, ponctuation repliée en espaces."""
    flat = strip_accents(text or "").lower()
    flat = _NON_WORD.sub(" ", flat)
    return _WS.sub(" ", flat).strip()


# --------------------------------------------------------------------------
# Repli des expressions multi-mots
#
# Un simple remplacement de chaîne serait trop rigide : « vérifications
# d'antécédents » ne correspondrait pas à « vérification des antécédents ».
# Chaque expression est donc compilée en une regex qui tolère le pluriel de
# chaque mot porteur de sens et n'importe quel mot de liaison entre eux.
# --------------------------------------------------------------------------
_CONNECTOR_ALT = "|".join(sorted(CONNECTORS, key=len, reverse=True))
_SEPARATOR = rf"\s+(?:(?:{_CONNECTOR_ALT})\s+)*"


def _compile_phrases() -> list[tuple[str, re.Pattern[str], str]]:
    rules: list[tuple[str, re.Pattern[str], str]] = []
    for phrase, token in PHRASES.items():
        content = [word for word in phrase.split() if word not in CONNECTORS]
        if not content:
            continue
        body = _SEPARATOR.join(re.escape(word) + "s?" for word in content)
        pattern = re.compile(rf"(?<![a-z0-9]){body}(?![a-z0-9])")
        rules.append((content[0], pattern, token))
    # Les expressions les plus spécifiques d'abord, pour qu'une expression
    # courte n'ampute pas une expression longue qui la contient.
    rules.sort(key=lambda rule: -len(rule[1].pattern))
    return rules


_PHRASE_RULES = _compile_phrases()


def apply_phrases(text: str) -> str:
    """Replie les expressions multi-mots connues en un jeton unique."""
    for anchor, pattern, token in _PHRASE_RULES:
        # Pré-filtre bon marché : évite d'exécuter ~180 regex sur chaque texte.
        if anchor not in text:
            continue
        text = pattern.sub(token, text)
    return text


def light_stem(token: str) -> str:
    for suffix in _SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= _MIN_STEM:
            return token[: -len(suffix)]
    return token


def _stem_augmented_canonical() -> dict[str, str]:
    """Étend le thésaurus aux formes désuffixées de ses propres entrées.

    Sans cela, chaque entrée dont le radical diffère de la forme de surface
    laisse un trou : « suites » se désuffixe en « suit », que le thésaurus ne
    connaît pas, et le terme rate sa famille alors que « suite » y figure.
    """
    mapping = dict(CANONICAL)
    for term, canonical in CANONICAL.items():
        mapping.setdefault(light_stem(term), canonical)
    return mapping


_CANONICAL_FULL = _stem_augmented_canonical()


def canonicalize(token: str) -> str:
    """Forme canonique d'un jeton : thésaurus d'abord, désuffixation ensuite."""
    if token in _CANONICAL_FULL:
        return _CANONICAL_FULL[token]
    stem = light_stem(token)
    return _CANONICAL_FULL.get(stem, stem)


def terms(text: str) -> list[str]:
    """Liste des termes canoniques d'un texte, mots vides retirés."""
    flat = apply_phrases(normalize(text))
    out: list[str] = []
    for token in flat.split():
        if token in STOPWORDS or len(token) < 2:
            continue
        # Un nombre isolé n'apporte rien, sauf s'il ressemble à une année/version.
        if token.isdigit() and not (1900 < int(token) < 2100 or len(token) <= 3):
            continue
        out.append(canonicalize(token))
    return out


def trigrams(text: str) -> set[str]:
    """Trigrammes de caractères — rattrape fautes de frappe et variantes."""
    flat = normalize(text).replace(" ", "_")
    if len(flat) < 3:
        return {flat} if flat else set()
    return {flat[i : i + 3] for i in range(len(flat) - 2)}


def trigram_similarity(a: str, b: str) -> float:
    ta, tb = trigrams(a), trigrams(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def extract_refs(text: str) -> list[str]:
    """Références normatives citées dans un texte, normalisées en majuscules."""
    found: list[str] = []
    seen: set[str] = set()
    for pattern in _REF_PATTERNS:
        for match in pattern.finditer(text or ""):
            ref = _WS.sub("", match.group(0)).upper().rstrip(".")
            if ref not in seen:
                seen.add(ref)
                found.append(ref)
    return found


_QUESTION_HINTS = (
    "?", "decri", "descri", "expliqu", "explain", "detail", "precis", "indiqu",
    "confirm", "list", "fourni", "provide", "avez-vous", "avez vous", "disposez",
    "comment", "quel", "quelle", "quels", "quelles", "combien", "est-ce",
    "does ", "do you", "have you", "are you", "is there", "how ", "what ",
    "which ", "who ", "when ", "please ", "veuillez", "specify", "identify",
    "documented", "documente", "in place", "en place", "mis en oeuvre",
    "implemented", "shall ", "doit ", "must ",
)


def looks_like_question(text: str) -> bool:
    """Heuristique : ce fragment ressemble-t-il à une question ou une exigence ?"""
    raw = (text or "").strip()
    if len(raw) < 12 or len(raw) > 2000:
        return False
    flat = strip_accents(raw).lower()
    if raw.endswith("?"):
        return True
    if not any(hint in flat for hint in _QUESTION_HINTS):
        return False
    # Un fragment doit contenir assez de mots pour être une vraie question.
    return len(raw.split()) >= 4

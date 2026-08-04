"""Journal d'audit.

Ce qui est journalisé suit les recommandations usuelles en la matière (OWASP
Logging Cheat Sheet, ISO/IEC 27001:2022 A.8.15 « Journalisation », guide
ANSSI sur la journalisation) ramenées au strict nécessaire pour un outil de
cette taille. Deux principes gouvernent le contenu :

  * **Tracer ce qui engage.** Les événements d'authentification, les
    changements de droits, les modifications de données et les sorties de
    données (exports). Les simples consultations ne sont pas journalisées :
    elles noieraient le signal sans rien prouver d'utile ici.

  * **Ne jamais journaliser de secret.** Aucun mot de passe, aucun jeton de
    session, aucun secret TOTP, aucun code de récupération, même haché, même
    tronqué. Aucun contenu métier complet non plus : on trace l'identifiant et
    le libellé de l'objet touché, pas la réponse de conformité elle-même.

Chaque entrée porte les cinq informations qui rendent une trace exploitable :
quand, qui, depuis où, quoi, et avec quel résultat.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from .db import now

# Durée de conservation. Un an couvre le cycle d'audit annuel typique tout en
# restant proportionné : conserver au-delà sans besoin établi contreviendrait
# au principe de minimisation.
RETENTION_DAYS = 365

# Catalogue des événements. Codes stables et hiérarchiques (`domaine.objet.action`)
# afin de rester filtrables et de survivre aux changements de libellé.
EVENTS: dict[str, str] = {
    # Authentification
    "auth.login.success": "Connexion réussie",
    "auth.login.failure": "Échec de connexion",
    "auth.login.locked": "Connexion bloquée (trop de tentatives)",
    "auth.logout": "Déconnexion",
    "auth.setup": "Création du compte administrateur initial",
    # Second facteur
    "mfa.enabled": "Second facteur activé",
    "mfa.disabled": "Second facteur désactivé",
    "mfa.verify.success": "Second facteur validé",
    "mfa.verify.failure": "Échec du second facteur",
    "mfa.recovery.used": "Code de récupération utilisé",
    "mfa.recovery.regenerated": "Codes de récupération régénérés",
    "mfa.reset.admin": "Second facteur réinitialisé par un administrateur",
    # Comptes
    "user.created": "Compte créé",
    "user.updated": "Compte modifié",
    "user.deleted": "Compte supprimé",
    "user.password.changed": "Mot de passe modifié",
    "user.role.changed": "Droits d'administration modifiés",
    "user.deactivated": "Compte désactivé",
    "user.reactivated": "Compte réactivé",
    # Fiche et sessions du compte, tenues par la personne elle-même
    "account.profile.updated": "Fiche du compte modifiée",
    "account.password.changed": "Mot de passe changé par son titulaire",
    "account.sessions.revoked": "Autres sessions déconnectées",
    # Données métier
    "client.created": "Client créé",
    "client.updated": "Client modifié",
    "client.deleted": "Client supprimé",
    "kb.created": "Réponse de référence créée",
    "kb.updated": "Réponse de référence modifiée",
    "kb.deleted": "Réponse de référence supprimée",
    "config.created": "Configuration technique créée",
    "config.updated": "Configuration technique modifiée",
    "config.deleted": "Configuration technique supprimée",
    "questionnaire.imported": "Questionnaire importé",
    "questionnaire.deleted": "Questionnaire supprimé",
    # Sortie de données : à tracer en priorité, c'est ce qui quitte l'outil.
    "export.generated": "Export généré",
    # Maintenance du journal lui-même
    "audit.purged": "Purge du journal d'audit",
}

# Familles proposées comme filtre dans l'interface.
CATEGORIES: dict[str, str] = {
    "auth": "Authentification",
    "mfa": "Second facteur",
    "account": "Mon compte",
    "user": "Comptes",
    "client": "Clients",
    "kb": "Base de connaissance",
    "config": "Configurations",
    "questionnaire": "Questionnaires",
    "export": "Exports",
    "audit": "Journal",
}

_UA_MAX = 180


def label(event: str) -> str:
    return EVENTS.get(event, event)


def client_ip(request) -> str:
    return request.client.host if request and request.client else "inconnu"


def _user_agent(request) -> str | None:
    if request is None:
        return None
    raw = request.headers.get("user-agent")
    return raw[:_UA_MAX] if raw else None


def record(
    conn,
    event: str,
    *,
    request=None,
    actor: dict[str, Any] | None = None,
    outcome: str = "success",
    target_type: str | None = None,
    target_id: int | None = None,
    target_label: str | None = None,
    detail: str | None = None,
    actor_name: str | None = None,
) -> None:
    """Enregistre un événement.

    `actor_name` permet de nommer un acteur non authentifié — typiquement
    l'identifiant saisi lors d'un échec de connexion, qui est justement
    l'information utile dans ce cas.
    """
    conn.execute(
        """INSERT INTO audit_log (at, event, outcome, actor_id, actor_name, ip,
                                  user_agent, target_type, target_id, target_label, detail)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            now(),
            event,
            outcome,
            actor["id"] if actor else None,
            (actor["username"] if actor else actor_name),
            client_ip(request) if request else None,
            _user_agent(request),
            target_type,
            target_id,
            (target_label[:200] if target_label else None),
            (detail[:500] if detail else None),
        ),
    )


def record_now(event: str, **kwargs) -> None:
    """Enregistre un événement dans sa propre transaction, validée aussitôt.

    Indispensable sur les chemins d'échec : `get_db()` annule la transaction
    quand une exception la traverse, si bien qu'une trace écrite juste avant un
    `raise HTTPException` disparaîtrait avec elle. Or ce sont précisément les
    échecs — connexions refusées, seconds facteurs invalides — qu'un journal
    doit conserver.
    """
    from .db import get_db

    with get_db() as conn:
        record(conn, event, **kwargs)


def purge_expired(conn) -> int:
    """Supprime les entrées au-delà de la rétention. La purge se journalise
    elle-même : un trou dans le journal doit toujours être explicable."""
    cutoff = (date.today() - timedelta(days=RETENTION_DAYS)).isoformat()
    deleted = conn.execute("DELETE FROM audit_log WHERE at < ?", (cutoff,)).rowcount or 0
    if deleted:
        record(conn, "audit.purged",
               detail=f"{deleted} entrée(s) antérieure(s) au {cutoff} supprimée(s)")
    return deleted

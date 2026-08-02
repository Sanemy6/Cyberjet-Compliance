"""Authentification par session.

Mots de passe hachés avec PBKDF2-HMAC-SHA256 (bibliothèque standard
uniquement — pas de bcrypt/argon2 pour ne pas alourdir l'installation d'une
dépendance compilée sur un poste Windows sans outillage de build). Sessions
stockées côté serveur plutôt qu'en cookie signé : une session se révoque
immédiatement (désactivation d'un compte, déconnexion) sans dépendre d'une
date d'expiration de jeton.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any

from .db import now

SESSION_COOKIE = "grc_session"
SESSION_DAYS = 30
PBKDF2_ITERATIONS = 260_000

# Nom affiché dans l'application d'authentification du téléphone.
TOTP_ISSUER = "Conformite GRC"
TOTP_STEP = 30
TOTP_DIGITS = 6
# Tolérance d'une fenêtre de part et d'autre : absorbe la dérive d'horloge du
# téléphone sans élargir inutilement la surface d'attaque.
TOTP_WINDOW = 1

RECOVERY_CODE_COUNT = 10
_RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sans I, O, 0, 1

# Anti-bruteforce simple, en mémoire : suffisant pour un outil interne à
# quelques dizaines d'utilisateurs. Réinitialisé au redémarrage du serveur,
# ce qui est acceptable — l'objectif est de ralentir, pas d'auditer.
#
# Clé (identifiant, adresse IP) et non identifiant seul : sur un réseau
# partagé, verrouiller par seul identifiant permettrait à n'importe qui
# d'empêcher un collègue de se connecter en échouant délibérément cinq fois
# à sa place depuis un autre poste.
_FAILED_ATTEMPTS: dict[str, list[float]] = {}
LOCKOUT_THRESHOLD = 5
LOCKOUT_SECONDS = 15 * 60


def _key(username: str, client_ip: str) -> str:
    return f"{username.strip().lower()}|{client_ip or 'inconnu'}"


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    _, digest = hash_password(password, bytes.fromhex(salt_hex))
    return hmac.compare_digest(digest, hash_hex)


def is_locked_out(username: str, client_ip: str) -> bool:
    key = _key(username, client_ip)
    cutoff = time.time() - LOCKOUT_SECONDS
    attempts = [t for t in _FAILED_ATTEMPTS.get(key, []) if t > cutoff]
    _FAILED_ATTEMPTS[key] = attempts
    return len(attempts) >= LOCKOUT_THRESHOLD


def register_failure(username: str, client_ip: str) -> None:
    _FAILED_ATTEMPTS.setdefault(_key(username, client_ip), []).append(time.time())


def clear_failures(username: str, client_ip: str) -> None:
    _FAILED_ATTEMPTS.pop(_key(username, client_ip), None)


def _expiry() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")


def create_session(conn, user_id: int, mfa_pending: bool = False) -> str:
    """Ouvre une session. `mfa_pending` marque une session à demi ouverte :
    le mot de passe est validé, le second facteur pas encore."""
    token = secrets.token_urlsafe(32)
    conn.execute(
        """INSERT INTO app_session (token, user_id, created_at, expires_at, mfa_pending)
           VALUES (?, ?, ?, ?, ?)""",
        (token, user_id, now(), _expiry(), int(mfa_pending)),
    )
    return token


def get_session_user(conn, token: str | None) -> dict[str, Any] | None:
    """Utilisateur d'une session pleinement authentifiée, ou None.

    Une session en attente de second facteur est délibérément traitée comme
    absente : elle ne doit ouvrir aucun accès en dehors de la vérification MFA.

    Prolonge la session à chaque appel réussi (fenêtre glissante) : un usage
    régulier sur un poste personnel ne redemande quasiment jamais de se
    reconnecter, sans pour autant garder une session active indéfiniment.
    """
    if not token:
        return None
    row = conn.execute(
        """SELECT u.* FROM app_session s JOIN app_user u ON u.id = s.user_id
           WHERE s.token = ? AND s.expires_at > ? AND u.active = 1
             AND s.mfa_pending = 0""",
        (token, now()),
    ).fetchone()
    if row is None:
        return None
    conn.execute("UPDATE app_session SET expires_at = ? WHERE token = ?", (_expiry(), token))
    return dict(row)


def get_pending_session_user(conn, token: str | None) -> dict[str, Any] | None:
    """Utilisateur d'une session en attente de second facteur, ou None."""
    if not token:
        return None
    row = conn.execute(
        """SELECT u.* FROM app_session s JOIN app_user u ON u.id = s.user_id
           WHERE s.token = ? AND s.expires_at > ? AND u.active = 1
             AND s.mfa_pending = 1""",
        (token, now()),
    ).fetchone()
    return dict(row) if row else None


def promote_session(conn, token: str) -> None:
    """Second facteur validé : la session devient pleinement authentifiée."""
    conn.execute("UPDATE app_session SET mfa_pending = 0 WHERE token = ?", (token,))


def delete_session(conn, token: str) -> None:
    conn.execute("DELETE FROM app_session WHERE token = ?", (token,))


def delete_user_sessions(conn, user_id: int, keep_token: str | None = None) -> int:
    """Révoque toutes les sessions d'un compte, sauf éventuellement la courante.

    Utilisé après un changement de mot de passe ou de configuration MFA : si
    un jeton a fuité, il ne doit pas survivre au durcissement du compte.
    """
    if keep_token:
        cur = conn.execute(
            "DELETE FROM app_session WHERE user_id = ? AND token != ?", (user_id, keep_token))
    else:
        cur = conn.execute("DELETE FROM app_session WHERE user_id = ?", (user_id,))
    return cur.rowcount or 0


def cleanup_expired_sessions(conn) -> None:
    conn.execute("DELETE FROM app_session WHERE expires_at <= ?", (now(),))


# ==========================================================================
# Second facteur : mot de passe à usage unique basé sur le temps (TOTP)
#
# RFC 6238, compatible Google Authenticator, Microsoft Authenticator, Authy,
# 1Password, Bitwarden. Implémenté sur la bibliothèque standard : le calcul
# est un HMAC-SHA1 sur un compteur temporel, inutile d'ajouter une dépendance.
# ==========================================================================

def generate_totp_secret() -> str:
    """Secret partagé de 160 bits, en base32 sans remplissage (format attendu
    par les applications d'authentification)."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _totp_at(secret_b32: str, counter: int) -> str:
    padded = secret_b32 + "=" * (-len(secret_b32) % 8)
    key = base64.b32decode(padded, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(truncated % (10**TOTP_DIGITS)).zfill(TOTP_DIGITS)


def verify_totp(secret_b32: str, code: str, last_counter: int | None = None) -> int | None:
    """Vérifie un code et renvoie le compteur consommé, ou None si invalide.

    Le compteur est renvoyé pour être mémorisé : rejouer le même code dans sa
    fenêtre de 30 secondes doit échouer, sinon un code intercepté reste
    utilisable jusqu'à expiration.
    """
    cleaned = "".join(ch for ch in (code or "") if ch.isdigit())
    if len(cleaned) != TOTP_DIGITS:
        return None
    current = int(time.time()) // TOTP_STEP
    for drift in range(-TOTP_WINDOW, TOTP_WINDOW + 1):
        counter = current + drift
        if last_counter is not None and counter <= last_counter:
            continue
        if hmac.compare_digest(_totp_at(secret_b32, counter), cleaned):
            return counter
    return None


def totp_uri(secret_b32: str, username: str) -> str:
    """URI otpauth:// à encoder en QR pour l'enrôlement."""
    label = urllib.parse.quote(f"{TOTP_ISSUER}:{username}")
    params = urllib.parse.urlencode({
        "secret": secret_b32,
        "issuer": TOTP_ISSUER,
        "algorithm": "SHA1",
        "digits": TOTP_DIGITS,
        "period": TOTP_STEP,
    })
    return f"otpauth://totp/{label}?{params}"


def totp_qr_svg(uri: str) -> str:
    """QR au format SVG : net à toute taille et sans dépendance graphique."""
    import io

    import qrcode
    import qrcode.image.svg

    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    buffer = io.BytesIO()
    img.save(buffer)
    return buffer.getvalue().decode("utf-8")


def format_secret_for_display(secret_b32: str) -> str:
    """Secret en groupes de 4 pour la saisie manuelle, quand le QR n'est pas
    scannable (poste sans caméra, application de bureau)."""
    return " ".join(secret_b32[i : i + 4] for i in range(0, len(secret_b32), 4))


# ==========================================================================
# Codes de récupération
#
# Hachés en SHA-256 et non en PBKDF2 : ces codes sont générés aléatoirement
# avec ~60 bits d'entropie, ils ne sont pas devinables par force brute comme
# le serait un mot de passe choisi par un humain. Un hachage lent obligerait
# par ailleurs à dérouler jusqu'à dix dérivations coûteuses à chaque essai.
# ==========================================================================

def _normalise_recovery(code: str) -> str:
    return "".join(ch for ch in (code or "").upper() if ch in _RECOVERY_ALPHABET)


def _hash_recovery(code: str) -> str:
    return hashlib.sha256(_normalise_recovery(code).encode("ascii")).hexdigest()


def generate_recovery_codes(conn, user_id: int) -> list[str]:
    """Remplace les codes existants et renvoie les nouveaux, en clair.

    C'est le seul moment où ils sont lisibles : seuls leurs empreintes sont
    conservées.
    """
    conn.execute("DELETE FROM app_recovery_code WHERE user_id = ?", (user_id,))
    codes: list[str] = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(12))
        pretty = f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"
        codes.append(pretty)
        conn.execute(
            "INSERT INTO app_recovery_code (user_id, code_hash, created_at) VALUES (?, ?, ?)",
            (user_id, _hash_recovery(pretty), now()),
        )
    return codes


def consume_recovery_code(conn, user_id: int, code: str) -> bool:
    """Valide un code de récupération et le marque comme utilisé (usage unique)."""
    candidate = _hash_recovery(code)
    if len(_normalise_recovery(code)) != 12:
        return False
    row = conn.execute(
        """SELECT id FROM app_recovery_code
           WHERE user_id = ? AND code_hash = ? AND used_at IS NULL""",
        (user_id, candidate),
    ).fetchone()
    if row is None:
        return False
    conn.execute("UPDATE app_recovery_code SET used_at = ? WHERE id = ?", (now(), row["id"]))
    return True


def recovery_codes_remaining(conn, user_id: int) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM app_recovery_code WHERE user_id = ? AND used_at IS NULL",
        (user_id,),
    ).fetchone()[0]


def disable_mfa(conn, user_id: int) -> None:
    """Retire le second facteur et purge tout ce qui s'y rattache."""
    conn.execute(
        """UPDATE app_user SET totp_secret = NULL, totp_pending_secret = NULL,
                               totp_enabled = 0, totp_last_counter = NULL,
                               mfa_enabled_at = NULL
           WHERE id = ?""",
        (user_id,),
    )
    conn.execute("DELETE FROM app_recovery_code WHERE user_id = ?", (user_id,))

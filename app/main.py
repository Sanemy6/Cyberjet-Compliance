"""API HTTP de l'application GRC — FastAPI.

Une seule application : l'API JSON sous /api et la SPA statique servie à la
racine. Aucune dépendance réseau, aucune donnée sortante.
"""

from __future__ import annotations

import csv
import io
import json
import re
import shutil
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import audit
from . import auth as auth_mod
from . import export as export_mod
from . import parsers, search
from .db import (BASE_DIR, DATA_DIR, DB_PATH, EXPORT_DIR, UPLOAD_DIR, get_db,
                 init_db, now, one, rows, scalar)
from .frameworks import seed_frameworks
from .search import MEDIUM, band

WEB_DIR = BASE_DIR / "web"

app = FastAPI(title="GRC — Réponse aux questionnaires sécurité", version="1.0.0")


@app.on_event("startup")
def _startup() -> None:
    init_db()
    with get_db() as conn:
        seed_frameworks(conn)
        auth_mod.cleanup_expired_sessions(conn)
        audit.purge_expired(conn)


# ==========================================================================
# Contrôle d'accès
#
# L'application est utilisable en réseau local par plusieurs personnes ; sans
# ce garde-fou, n'importe qui sur le réseau pourrait consulter ou modifier les
# dossiers clients. Tout ce qui n'est pas explicitement public passe par ici.
# ==========================================================================

_PUBLIC_PAGES = {"/login", "/setup"}
_DOCS_PATHS = {"/docs", "/openapi.json", "/redoc"}

# Liste explicite plutôt qu'un préfixe « /api/auth/ » : sinon tout endpoint
# ajouté plus tard sous ce préfixe — l'enrôlement du second facteur, par
# exemple — deviendrait public sans que personne ne s'en aperçoive.
_PUBLIC_API = {
    "/api/auth/status",
    "/api/auth/setup",
    "/api/auth/login",
    "/api/auth/logout",
}

# Endpoints franchissables avec une session à demi ouverte (mot de passe
# validé, second facteur en attente) — et rien d'autre.
_MFA_PENDING_API = {
    "/api/auth/mfa/verify",
    "/api/auth/mfa/cancel",
}


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    path = request.url.path
    request.state.user = None
    request.state.pending_user = None

    if path.startswith("/static/") or path in _PUBLIC_PAGES or path in _PUBLIC_API:
        return await call_next(request)

    token = request.cookies.get(auth_mod.SESSION_COOKIE)
    with get_db() as conn:
        user = auth_mod.get_session_user(conn, token)
        pending = None if user else auth_mod.get_pending_session_user(conn, token)
    request.state.user = user
    request.state.pending_user = pending

    if path in _MFA_PENDING_API:
        if pending is None:
            return JSONResponse(
                {"detail": "Aucune authentification en cours."}, status_code=401)
        return await call_next(request)

    if user is None and (path.startswith("/api/") or path in _DOCS_PATHS):
        return JSONResponse({"detail": "Authentification requise."}, status_code=401)

    # Pages : le shell HTML est toujours servi ; c'est la SPA qui vérifie
    # /api/auth/status au chargement et redirige vers /login si nécessaire.
    return await call_next(request)


def _require_admin(request: Request) -> dict[str, Any]:
    user = request.state.user
    if not user or not user["is_admin"]:
        raise HTTPException(403, "Réservé aux administrateurs.")
    return user


class SetupIn(BaseModel):
    username: str = Field(min_length=3, max_length=60)
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    username: str
    password: str


class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=60)
    password: str = Field(min_length=8, max_length=200)
    is_admin: bool = False


class UserPatch(BaseModel):
    password: str | None = Field(default=None, min_length=8, max_length=200)
    is_admin: bool | None = None
    active: bool | None = None


class MfaCodeIn(BaseModel):
    code: str = Field(min_length=4, max_length=32)


class PasswordConfirmIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        auth_mod.SESSION_COOKIE, token, max_age=auth_mod.SESSION_DAYS * 86400,
        httponly=True, samesite="lax",
    )


def _public_user(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"], "username": row["username"], "is_admin": bool(row["is_admin"]),
        "active": bool(row["active"]), "created_at": row["created_at"],
        "last_login_at": row["last_login_at"],
        "mfa_enabled": bool(row["totp_enabled"]),
        "mfa_enabled_at": row["mfa_enabled_at"],
    }


@app.get("/api/auth/status")
def auth_status(request: Request) -> dict[str, Any]:
    token = request.cookies.get(auth_mod.SESSION_COOKIE)
    with get_db() as conn:
        needs_setup = (scalar(conn, "SELECT COUNT(*) FROM app_user") or 0) == 0
        user = None if needs_setup else auth_mod.get_session_user(conn, token)
        pending = None if (needs_setup or user) else auth_mod.get_pending_session_user(conn, token)
        remaining = auth_mod.recovery_codes_remaining(conn, user["id"]) if user else 0
    return {
        "needs_setup": needs_setup,
        "authenticated": user is not None,
        "mfa_pending": pending is not None,
        "username": user["username"] if user else None,
        "is_admin": bool(user["is_admin"]) if user else False,
        "mfa_enabled": bool(user["totp_enabled"]) if user else False,
        "mfa_enabled_at": user["mfa_enabled_at"] if user else None,
        "recovery_codes_remaining": remaining,
    }


@app.post("/api/auth/setup", status_code=201)
def auth_setup(payload: SetupIn, request: Request, response: Response) -> dict[str, Any]:
    with get_db() as conn:
        if (scalar(conn, "SELECT COUNT(*) FROM app_user") or 0) > 0:
            raise HTTPException(409, "Un compte existe déjà : utilisez la page de connexion.")
        salt, hashed = auth_mod.hash_password(payload.password)
        cur = conn.execute(
            """INSERT INTO app_user (username, password_hash, password_salt, is_admin,
                                     active, created_at)
               VALUES (?, ?, ?, 1, 1, ?)""",
            (payload.username.strip(), hashed, salt, now()),
        )
        conn.execute("UPDATE app_user SET last_login_at = ? WHERE id = ?", (now(), cur.lastrowid))
        token = auth_mod.create_session(conn, cur.lastrowid)
        audit.record(conn, "auth.setup", request=request,
                     actor={"id": cur.lastrowid, "username": payload.username.strip()},
                     target_type="user", target_id=cur.lastrowid,
                     target_label=payload.username.strip())
    _set_session_cookie(response, token)
    return {"username": payload.username.strip(), "is_admin": True}


@app.post("/api/auth/login")
def auth_login(payload: LoginIn, request: Request, response: Response) -> dict[str, Any]:
    username = payload.username.strip()
    client_ip = audit.client_ip(request)

    if auth_mod.is_locked_out(username, client_ip):
        audit.record_now("auth.login.locked", request=request, outcome="failure",
                         actor_name=username,
                         detail="Seuil de tentatives dépassé pour ce couple identifiant/adresse")
        raise HTTPException(429, "Trop de tentatives. Réessayez dans quelques minutes.")

    with get_db() as conn:
        row = one(conn, "SELECT * FROM app_user WHERE username = ? COLLATE NOCASE AND active = 1",
                   (username,))
        if not row or not auth_mod.verify_password(
                payload.password, row["password_salt"], row["password_hash"]):
            auth_mod.register_failure(username, client_ip)
            # Volontairement : on ne distingue pas « compte inconnu » de
            # « mot de passe faux », ni dans la réponse ni dans le journal.
            audit.record_now("auth.login.failure", request=request, outcome="failure",
                             actor_name=username, detail="Identifiant ou mot de passe incorrect")
            raise HTTPException(401, "Identifiants incorrects.")

        auth_mod.clear_failures(username, client_ip)
        actor = {"id": row["id"], "username": row["username"]}

        if row["totp_enabled"]:
            # Session à demi ouverte : le second facteur reste à fournir.
            token = auth_mod.create_session(conn, row["id"], mfa_pending=True)
            _set_session_cookie(response, token)
            audit.record(conn, "auth.login.success", request=request, actor=actor,
                         detail="Mot de passe validé, second facteur attendu")
            return {"username": row["username"], "is_admin": bool(row["is_admin"]),
                    "mfa_required": True}

        conn.execute("UPDATE app_user SET last_login_at = ? WHERE id = ?", (now(), row["id"]))
        token = auth_mod.create_session(conn, row["id"])
        audit.record(conn, "auth.login.success", request=request, actor=actor,
                     detail="Sans second facteur")
    _set_session_cookie(response, token)
    return {"username": row["username"], "is_admin": bool(row["is_admin"]),
            "mfa_required": False}


@app.post("/api/auth/logout", status_code=204)
def auth_logout(request: Request, response: Response) -> None:
    token = request.cookies.get(auth_mod.SESSION_COOKIE)
    if token:
        with get_db() as conn:
            actor = request.state.user or request.state.pending_user
            if actor:
                audit.record(conn, "auth.logout", request=request, actor=actor)
            auth_mod.delete_session(conn, token)
    response.delete_cookie(auth_mod.SESSION_COOKIE)


# --------------------------------------------------------------------------
# Second facteur
# --------------------------------------------------------------------------

@app.post("/api/auth/mfa/verify")
def mfa_verify(payload: MfaCodeIn, request: Request) -> dict[str, Any]:
    """Deuxième étape de la connexion : code TOTP ou code de récupération."""
    pending = request.state.pending_user
    token = request.cookies.get(auth_mod.SESSION_COOKIE)
    client_ip = audit.client_ip(request)
    lock_key = f"mfa:{pending['username']}"

    if auth_mod.is_locked_out(lock_key, client_ip):
        raise HTTPException(429, "Trop de tentatives. Réessayez dans quelques minutes.")

    actor = {"id": pending["id"], "username": pending["username"]}
    with get_db() as conn:
        counter = auth_mod.verify_totp(
            pending["totp_secret"], payload.code, pending["totp_last_counter"])

        if counter is not None:
            conn.execute("UPDATE app_user SET totp_last_counter = ? WHERE id = ?",
                         (counter, pending["id"]))
            audit.record(conn, "mfa.verify.success", request=request, actor=actor,
                         detail="Code de l'application d'authentification")
        elif auth_mod.consume_recovery_code(conn, pending["id"], payload.code):
            remaining = auth_mod.recovery_codes_remaining(conn, pending["id"])
            audit.record(conn, "mfa.recovery.used", request=request, actor=actor,
                         detail=f"{remaining} code(s) de récupération restant(s)")
        else:
            auth_mod.register_failure(lock_key, client_ip)
            audit.record_now("mfa.verify.failure", request=request, actor=actor,
                             outcome="failure", detail="Code invalide, expiré ou déjà utilisé")
            raise HTTPException(401, "Code invalide.")

        auth_mod.clear_failures(lock_key, client_ip)
        auth_mod.promote_session(conn, token)
        conn.execute("UPDATE app_user SET last_login_at = ? WHERE id = ?",
                     (now(), pending["id"]))
        remaining = auth_mod.recovery_codes_remaining(conn, pending["id"])

    return {"username": pending["username"], "is_admin": bool(pending["is_admin"]),
            "recovery_codes_remaining": remaining}


@app.post("/api/auth/mfa/cancel", status_code=204)
def mfa_cancel(request: Request, response: Response) -> None:
    """Abandon de la connexion à l'étape du second facteur."""
    token = request.cookies.get(auth_mod.SESSION_COOKIE)
    if token:
        with get_db() as conn:
            auth_mod.delete_session(conn, token)
    response.delete_cookie(auth_mod.SESSION_COOKIE)


@app.post("/api/auth/mfa/totp/init")
def mfa_totp_init(request: Request) -> dict[str, Any]:
    """Prépare un secret TOTP. Il reste en attente tant qu'un premier code
    n'a pas été vérifié : impossible de se verrouiller dehors en enregistrant
    un secret jamais scanné."""
    user = request.state.user
    if user["totp_enabled"]:
        raise HTTPException(409, "Le second facteur est déjà activé sur ce compte.")

    secret = auth_mod.generate_totp_secret()
    with get_db() as conn:
        conn.execute("UPDATE app_user SET totp_pending_secret = ? WHERE id = ?",
                     (secret, user["id"]))
    uri = auth_mod.totp_uri(secret, user["username"])
    return {
        "secret": auth_mod.format_secret_for_display(secret),
        "uri": uri,
        "qr_svg": auth_mod.totp_qr_svg(uri),
    }


@app.post("/api/auth/mfa/totp/activate")
def mfa_totp_activate(payload: MfaCodeIn, request: Request) -> dict[str, Any]:
    """Confirme l'enrôlement et délivre les codes de récupération."""
    user = request.state.user
    actor = {"id": user["id"], "username": user["username"]}

    with get_db() as conn:
        row = one(conn, "SELECT totp_pending_secret FROM app_user WHERE id = ?", (user["id"],))
        secret = row["totp_pending_secret"] if row else None
        if not secret:
            raise HTTPException(409, "Aucun enrôlement en cours. Recommencez la configuration.")

        counter = auth_mod.verify_totp(secret, payload.code)
        if counter is None:
            audit.record_now("mfa.verify.failure", request=request, actor=actor,
                             outcome="failure", detail="Code incorrect lors de l'enrôlement")
            raise HTTPException(400, "Code incorrect. Vérifiez l'heure de votre téléphone.")

        conn.execute(
            """UPDATE app_user SET totp_secret = ?, totp_pending_secret = NULL,
                                   totp_enabled = 1, totp_last_counter = ?, mfa_enabled_at = ?
               WHERE id = ?""",
            (secret, counter, now(), user["id"]))
        codes = auth_mod.generate_recovery_codes(conn, user["id"])
        # Les autres sessions du compte datent d'avant le durcissement : on
        # les révoque pour qu'elles repassent par le second facteur.
        revoked = auth_mod.delete_user_sessions(
            conn, user["id"], keep_token=request.cookies.get(auth_mod.SESSION_COOKIE))
        audit.record(conn, "mfa.enabled", request=request, actor=actor,
                     detail=f"Application d'authentification (TOTP) ; "
                            f"{len(codes)} codes de récupération émis ; "
                            f"{revoked} autre(s) session(s) révoquée(s)")
    return {"recovery_codes": codes}


@app.post("/api/auth/mfa/disable")
def mfa_disable(payload: PasswordConfirmIn, request: Request) -> dict[str, Any]:
    """Désactive le second facteur. Le mot de passe est redemandé : sans cela,
    une session volée suffirait à retirer la protection qu'elle contourne."""
    user = request.state.user
    actor = {"id": user["id"], "username": user["username"]}

    with get_db() as conn:
        if not auth_mod.verify_password(
                payload.password, user["password_salt"], user["password_hash"]):
            audit.record_now("mfa.disabled", request=request, actor=actor, outcome="failure",
                             detail="Mot de passe incorrect à la confirmation")
            raise HTTPException(401, "Mot de passe incorrect.")
        if not user["totp_enabled"]:
            raise HTTPException(409, "Le second facteur n'est pas activé.")
        auth_mod.disable_mfa(conn, user["id"])
        audit.record(conn, "mfa.disabled", request=request, actor=actor,
                     detail="Désactivé par l'utilisateur lui-même")
    return {"mfa_enabled": False}


@app.post("/api/auth/mfa/recovery/regenerate")
def mfa_regenerate_recovery(payload: PasswordConfirmIn, request: Request) -> dict[str, Any]:
    """Réémet un jeu complet de codes. Les précédents sont invalidés."""
    user = request.state.user
    actor = {"id": user["id"], "username": user["username"]}

    with get_db() as conn:
        if not auth_mod.verify_password(
                payload.password, user["password_salt"], user["password_hash"]):
            raise HTTPException(401, "Mot de passe incorrect.")
        if not user["totp_enabled"]:
            raise HTTPException(409, "Activez d'abord le second facteur.")
        codes = auth_mod.generate_recovery_codes(conn, user["id"])
        audit.record(conn, "mfa.recovery.regenerated", request=request, actor=actor,
                     detail=f"{len(codes)} nouveaux codes ; les précédents sont invalidés")
    return {"recovery_codes": codes}


@app.get("/api/users")
def list_users(request: Request) -> list[dict[str, Any]]:
    _require_admin(request)
    with get_db() as conn:
        return [
            _public_user(r) for r in rows(
                conn, "SELECT * FROM app_user ORDER BY username COLLATE NOCASE")
        ]


@app.post("/api/users", status_code=201)
def create_user(request: Request, payload: UserIn) -> dict[str, Any]:
    _require_admin(request)
    with get_db() as conn:
        if one(conn, "SELECT id FROM app_user WHERE username = ? COLLATE NOCASE",
               (payload.username.strip(),)):
            raise HTTPException(409, "Ce nom d'utilisateur existe déjà.")
        salt, hashed = auth_mod.hash_password(payload.password)
        cur = conn.execute(
            """INSERT INTO app_user (username, password_hash, password_salt, is_admin,
                                     active, created_at)
               VALUES (?, ?, ?, ?, 1, ?)""",
            (payload.username.strip(), hashed, salt, int(payload.is_admin), now()),
        )
        audit.record(conn, "user.created", request=request, actor=request.state.user,
                     target_type="user", target_id=cur.lastrowid,
                     target_label=payload.username.strip(),
                     detail="Administrateur" if payload.is_admin else "Membre")
        return _public_user(one(conn, "SELECT * FROM app_user WHERE id = ?", (cur.lastrowid,)))


@app.patch("/api/users/{user_id}")
def patch_user(request: Request, user_id: int, payload: UserPatch) -> dict[str, Any]:
    admin = _require_admin(request)
    with get_db() as conn:
        target = one(conn, "SELECT * FROM app_user WHERE id = ?", (user_id,))
        if not target:
            raise HTTPException(404, "Compte introuvable.")

        if user_id == admin["id"] and (payload.is_admin is False or payload.active is False):
            raise HTTPException(400, "Impossible de modifier vos propres droits d'administration "
                                     "ou de désactiver votre propre compte.")
        if payload.is_admin is False or payload.active is False:
            other_admins = scalar(
                conn, "SELECT COUNT(*) FROM app_user WHERE is_admin = 1 AND active = 1 AND id != ?",
                (user_id,))
            if not other_admins:
                raise HTTPException(400, "Impossible : il doit rester au moins un administrateur actif.")

        fields: list[str] = []
        params: list[Any] = []
        if payload.password:
            salt, hashed = auth_mod.hash_password(payload.password)
            fields += ["password_hash = ?", "password_salt = ?"]
            params += [hashed, salt]
        if payload.is_admin is not None:
            fields.append("is_admin = ?")
            params.append(int(payload.is_admin))
        if payload.active is not None:
            fields.append("active = ?")
            params.append(int(payload.active))

        if fields:
            params.append(user_id)
            conn.execute(f"UPDATE app_user SET {', '.join(fields)} WHERE id = ?", params)

            target_ref = {"target_type": "user", "target_id": user_id,
                          "target_label": target["username"]}
            if payload.password:
                # Un mot de passe changé par un tiers doit chasser les sessions
                # ouvertes : sinon l'ancien détenteur reste connecté.
                revoked = auth_mod.delete_user_sessions(conn, user_id)
                audit.record(conn, "user.password.changed", request=request,
                             actor=admin, **target_ref,
                             detail=f"Réinitialisé par un administrateur ; "
                                    f"{revoked} session(s) révoquée(s)")
            if payload.is_admin is not None and bool(payload.is_admin) != bool(target["is_admin"]):
                audit.record(conn, "user.role.changed", request=request, actor=admin, **target_ref,
                             detail="Promu administrateur" if payload.is_admin
                                    else "Droits d'administration retirés")
            if payload.active is not None and bool(payload.active) != bool(target["active"]):
                if payload.active:
                    audit.record(conn, "user.reactivated", request=request, actor=admin, **target_ref)
                else:
                    revoked = auth_mod.delete_user_sessions(conn, user_id)
                    audit.record(conn, "user.deactivated", request=request, actor=admin,
                                 **target_ref,
                                 detail=f"{revoked} session(s) révoquée(s)")
        return _public_user(one(conn, "SELECT * FROM app_user WHERE id = ?", (user_id,)))


@app.post("/api/users/{user_id}/mfa/reset")
def admin_reset_mfa(request: Request, user_id: int) -> dict[str, Any]:
    """Retire le second facteur d'un compte — le recours quand un collègue a
    perdu son téléphone et ses codes de récupération.

    Opération sensible : elle ramène le compte à un simple mot de passe, elle
    est donc journalisée en nommant l'administrateur qui l'a demandée.
    """
    admin = _require_admin(request)
    with get_db() as conn:
        target = one(conn, "SELECT * FROM app_user WHERE id = ?", (user_id,))
        if not target:
            raise HTTPException(404, "Compte introuvable.")
        if not target["totp_enabled"]:
            raise HTTPException(409, "Ce compte n'a pas de second facteur activé.")
        auth_mod.disable_mfa(conn, user_id)
        revoked = auth_mod.delete_user_sessions(conn, user_id)
        audit.record(conn, "mfa.reset.admin", request=request, actor=admin,
                     target_type="user", target_id=user_id, target_label=target["username"],
                     detail=f"Second facteur retiré ; {revoked} session(s) révoquée(s). "
                            f"Le compte n'est plus protégé que par son mot de passe.")
        return _public_user(one(conn, "SELECT * FROM app_user WHERE id = ?", (user_id,)))


@app.delete("/api/users/{user_id}", status_code=204)
def delete_user(request: Request, user_id: int) -> None:
    admin = _require_admin(request)
    if user_id == admin["id"]:
        raise HTTPException(400, "Impossible de supprimer votre propre compte.")
    with get_db() as conn:
        target = one(conn, "SELECT is_admin, username FROM app_user WHERE id = ?", (user_id,))
        if not target:
            raise HTTPException(404, "Compte introuvable.")
        if target["is_admin"]:
            other_admins = scalar(
                conn, "SELECT COUNT(*) FROM app_user WHERE is_admin = 1 AND active = 1 AND id != ?",
                (user_id,))
            if not other_admins:
                raise HTTPException(400, "Impossible : il doit rester au moins un administrateur.")
        conn.execute("DELETE FROM app_user WHERE id = ?", (user_id,))
        # Le nom est conservé dans la trace : le compte disparaît, pas son
        # historique d'actions.
        audit.record(conn, "user.deleted", request=request, actor=admin,
                     target_type="user", target_id=user_id, target_label=target["username"])


# ==========================================================================
# Journal d'audit — consultation réservée aux administrateurs
# ==========================================================================

def _audit_filters(
    event: str, category: str, outcome: str, actor: str, since: str, until: str, search_text: str,
) -> tuple[str, list[Any]]:
    where: list[str] = []
    params: list[Any] = []
    if event:
        where.append("event = ?")
        params.append(event)
    if category:
        where.append("event LIKE ?")
        params.append(f"{category}.%")
    if outcome:
        where.append("outcome = ?")
        params.append(outcome)
    if actor:
        where.append("actor_name LIKE ?")
        params.append(f"%{actor}%")
    if since:
        where.append("at >= ?")
        params.append(since)
    if until:
        # Borne inclusive sur la journée : l'utilisateur saisit une date, pas
        # un instant.
        params.append(f"{until}T23:59:59+00:00")
        where.append("at <= ?")
    if search_text:
        where.append("(target_label LIKE ? OR detail LIKE ? OR ip LIKE ?)")
        params += [f"%{search_text}%"] * 3
    return (f"WHERE {' AND '.join(where)}" if where else ""), params


@app.get("/api/audit")
def list_audit(
    request: Request,
    event: str = "",
    category: str = "",
    outcome: str = "",
    actor: str = "",
    since: str = "",
    until: str = "",
    q: str = "",
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    _require_admin(request)
    clause, params = _audit_filters(event, category, outcome, actor, since, until, q)

    with get_db() as conn:
        total = scalar(conn, f"SELECT COUNT(*) FROM audit_log {clause}", tuple(params)) or 0
        entries = rows(conn, f"""
            SELECT * FROM audit_log {clause}
            ORDER BY at DESC, id DESC LIMIT ? OFFSET ?""", tuple(params) + (limit, offset))
        for entry in entries:
            entry["event_label"] = audit.label(entry["event"])

        day_ago = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
        summary = {
            "total_entries": scalar(conn, "SELECT COUNT(*) FROM audit_log") or 0,
            "failed_logins_24h": scalar(
                conn, "SELECT COUNT(*) FROM audit_log WHERE event = 'auth.login.failure' AND at >= ?",
                (day_ago,)) or 0,
            "lockouts_24h": scalar(
                conn, "SELECT COUNT(*) FROM audit_log WHERE event = 'auth.login.locked' AND at >= ?",
                (day_ago,)) or 0,
            "mfa_failures_24h": scalar(
                conn, "SELECT COUNT(*) FROM audit_log WHERE event = 'mfa.verify.failure' AND at >= ?",
                (day_ago,)) or 0,
            "oldest": scalar(conn, "SELECT MIN(at) FROM audit_log"),
        }
        actors = [
            r["actor_name"] for r in rows(
                conn, "SELECT DISTINCT actor_name FROM audit_log "
                      "WHERE actor_name IS NOT NULL ORDER BY actor_name COLLATE NOCASE")
        ]

    return {
        "entries": entries,
        "total": total,
        "limit": limit,
        "offset": offset,
        "summary": summary,
        "actors": actors,
        "events": [{"code": code, "label": text} for code, text in audit.EVENTS.items()],
        "categories": [{"code": code, "label": text} for code, text in audit.CATEGORIES.items()],
        "retention_days": audit.RETENTION_DAYS,
    }


@app.get("/api/audit/export")
def export_audit(
    request: Request,
    event: str = "", category: str = "", outcome: str = "",
    actor: str = "", since: str = "", until: str = "", q: str = "",
) -> Response:
    """Export CSV du journal filtré — pièce à joindre à un dossier d'audit."""
    admin = _require_admin(request)
    clause, params = _audit_filters(event, category, outcome, actor, since, until, q)

    with get_db() as conn:
        entries = rows(conn, f"SELECT * FROM audit_log {clause} ORDER BY at DESC, id DESC",
                       tuple(params))
        audit.record(conn, "export.generated", request=request, actor=admin,
                     target_type="audit_log",
                     detail=f"Export CSV du journal d'audit : {len(entries)} entrée(s)")

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow(["Horodatage (UTC)", "Événement", "Code", "Résultat", "Acteur",
                     "Adresse IP", "Type de cible", "Cible", "Détail", "Navigateur"])
    for e in entries:
        writer.writerow([
            e["at"], audit.label(e["event"]), e["event"], e["outcome"],
            e["actor_name"] or "", e["ip"] or "", e["target_type"] or "",
            e["target_label"] or "", e["detail"] or "", e["user_agent"] or "",
        ])

    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    # BOM UTF-8 : sans lui, Excel sous Windows massacre les accents.
    return Response(
        content=("﻿" + buffer.getvalue()).encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="journal-audit_{stamp}.csv"'},
    )


# ==========================================================================
# Schémas d'entrée
# ==========================================================================

class ClientIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    country: str | None = None
    contact: str | None = None
    description: str | None = None
    status: str = "actif"


class KbIn(BaseModel):
    client_id: int | None = None
    question: str = Field(min_length=3)
    answer: str = Field(min_length=1)
    category: str = "Général"
    tags: str = ""
    status: Literal["validated", "draft", "obsolete"] = "validated"
    evidence: str | None = None
    source: str | None = None
    control_ids: list[int] = Field(default_factory=list)


class ConfigIn(BaseModel):
    client_id: int
    category: str = "Chiffrement"
    label: str = Field(min_length=1)
    value: str = Field(min_length=1)
    details: str | None = None
    scope: str | None = None
    status: str = "en place"


class AnswerQuery(BaseModel):
    client_id: int | None = None
    question: str = Field(min_length=3)
    top_k: int = 5


class QuestionPatch(BaseModel):
    final_answer: str | None = None
    status: Literal["pending", "auto", "validated", "na"] | None = None


class ManualQuestionnaire(BaseModel):
    client_id: int
    name: str = Field(min_length=1)
    text: str = Field(min_length=3)


# ==========================================================================
# Tableau de bord
# ==========================================================================

@app.get("/api/stats")
def stats() -> dict[str, Any]:
    with get_db() as conn:
        total_q = scalar(conn, "SELECT COUNT(*) FROM qq_question") or 0
        answered = scalar(
            conn,
            "SELECT COUNT(*) FROM qq_question "
            "WHERE COALESCE(NULLIF(TRIM(COALESCE(final_answer, suggested_answer)), ''), '') != ''",
        ) or 0
        return {
            "clients": scalar(conn, "SELECT COUNT(*) FROM client WHERE status='actif'") or 0,
            "kb_total": scalar(conn, "SELECT COUNT(*) FROM kb_entry") or 0,
            "kb_generic": scalar(conn, "SELECT COUNT(*) FROM kb_entry WHERE client_id IS NULL") or 0,
            "kb_validated": scalar(conn, "SELECT COUNT(*) FROM kb_entry WHERE status='validated'") or 0,
            "configs": scalar(conn, "SELECT COUNT(*) FROM config_item") or 0,
            "questionnaires_open": scalar(
                conn, "SELECT COUNT(*) FROM questionnaire WHERE status='en cours'") or 0,
            "questionnaires_total": scalar(conn, "SELECT COUNT(*) FROM questionnaire") or 0,
            "questions_total": total_q,
            "questions_answered": answered,
            "questions_validated": scalar(
                conn, "SELECT COUNT(*) FROM qq_question WHERE status='validated'") or 0,
            "coverage": round(answered / total_q, 4) if total_q else 0.0,
            "frameworks": scalar(conn, "SELECT COUNT(*) FROM framework") or 0,
            "controls": scalar(conn, "SELECT COUNT(*) FROM control") or 0,
            "recent_questionnaires": rows(conn, """
                SELECT q.id, q.name, q.status, q.file_type, q.updated_at,
                       c.name AS client_name, c.id AS client_id,
                       (SELECT COUNT(*) FROM qq_question x WHERE x.questionnaire_id = q.id) AS n_questions,
                       (SELECT COUNT(*) FROM qq_question x WHERE x.questionnaire_id = q.id
                          AND x.status IN ('validated','na')) AS n_done
                FROM questionnaire q JOIN client c ON c.id = q.client_id
                ORDER BY q.updated_at DESC LIMIT 6"""),
            "top_kb": rows(conn, """
                SELECT id, question, category, usage_count
                FROM kb_entry WHERE usage_count > 0
                ORDER BY usage_count DESC LIMIT 5"""),
            "by_category": rows(conn, """
                SELECT category, COUNT(*) AS n FROM kb_entry
                GROUP BY category ORDER BY n DESC"""),
        }


@app.get("/api/storage")
def storage() -> dict[str, Any]:
    """Volumétrie : ce qui est stocké, comment ça grossit, ce qu'il reste à saisir."""

    def dir_stats(path: Path) -> dict[str, Any]:
        files = [f for f in path.glob("**/*") if f.is_file()]
        return {"count": len(files), "bytes": sum(f.stat().st_size for f in files)}

    # La base SQLite s'accompagne de ses journaux -wal et -shm en mode WAL.
    db_bytes = sum(
        p.stat().st_size
        for p in (DB_PATH, DB_PATH.with_name(DB_PATH.name + "-wal"),
                  DB_PATH.with_name(DB_PATH.name + "-shm"))
        if p.exists()
    )
    uploads = dir_stats(UPLOAD_DIR)
    exports = dir_stats(EXPORT_DIR)

    # Douze derniers mois, trous compris : une série à trous se lit mal.
    today = date.today().replace(day=1)
    months: list[str] = []
    cursor = today
    for _ in range(12):
        months.append(cursor.isoformat()[:7])
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    months.reverse()

    with get_db() as conn:
        def monthly(table: str) -> dict[str, int]:
            return {
                row["m"]: row["n"]
                for row in conn.execute(
                    f"SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS n "
                    f"FROM {table} GROUP BY m")
            }

        kb_by_month = monthly("kb_entry")
        qq_by_month = monthly("questionnaire")

        counts = {
            "clients": scalar(conn, "SELECT COUNT(*) FROM client") or 0,
            "kb": scalar(conn, "SELECT COUNT(*) FROM kb_entry") or 0,
            "kb_generic": scalar(conn, "SELECT COUNT(*) FROM kb_entry WHERE client_id IS NULL") or 0,
            "configs": scalar(conn, "SELECT COUNT(*) FROM config_item") or 0,
            "questionnaires": scalar(conn, "SELECT COUNT(*) FROM questionnaire") or 0,
            "questions": scalar(conn, "SELECT COUNT(*) FROM qq_question") or 0,
            "control_links": scalar(conn, "SELECT COUNT(*) FROM kb_control") or 0,
        }
        counts["indexed"] = counts["kb"] + counts["configs"]

        avg_chars = scalar(
            conn, "SELECT AVG(LENGTH(question) + LENGTH(answer)) FROM kb_entry") or 0

        # Ce qu'il reste à alimenter, du plus actionnable au moins urgent.
        stale_before = (date.today() - timedelta(days=365)).isoformat()
        backlog = {
            # Réponses écrites à la main pendant une revue : elles ne sont pas
            # encore dans la base et seront donc réécrites au prochain client.
            "uncapitalised": scalar(conn, """
                SELECT COUNT(*) FROM qq_question
                WHERE status = 'validated' AND matched_kind IS NULL
                  AND TRIM(COALESCE(final_answer, '')) != ''""") or 0,
            # Propositions corrigées à la main : l'entrée d'origine a vieilli.
            "corrected": scalar(conn, """
                SELECT COUNT(*) FROM qq_question
                WHERE status = 'validated' AND matched_kind = 'kb'
                  AND TRIM(COALESCE(final_answer, '')) != ''
                  AND final_answer != COALESCE(suggested_answer, '')""") or 0,
            "drafts": scalar(
                conn, "SELECT COUNT(*) FROM kb_entry WHERE status = 'draft'") or 0,
            "stale": scalar(
                conn, "SELECT COUNT(*) FROM kb_entry WHERE status = 'validated' "
                      "AND COALESCE(reviewed_at, created_at) < ?", (stale_before,)) or 0,
            "clients_without_config": scalar(conn, """
                SELECT COUNT(*) FROM client c
                WHERE NOT EXISTS (SELECT 1 FROM config_item g WHERE g.client_id = c.id)""") or 0,
        }

        coverage = rows(conn, """
            SELECT f.code, f.name, COUNT(DISTINCT c.id) AS n_controls,
                   COUNT(DISTINCT kc.control_id) AS n_covered
            FROM framework f
            JOIN control c ON c.framework_id = f.id
            LEFT JOIN kb_control kc ON kc.control_id = c.id
            GROUP BY f.id ORDER BY f.sort_order""")

        per_client = rows(conn, """
            SELECT c.id, c.name,
              (SELECT COUNT(*) FROM kb_entry k WHERE k.client_id = c.id) AS n_kb,
              (SELECT COUNT(*) FROM config_item g WHERE g.client_id = c.id) AS n_configs,
              (SELECT COUNT(*) FROM qq_question q
                 JOIN questionnaire n ON n.id = q.questionnaire_id
                 WHERE n.client_id = c.id) AS n_questions
            FROM client c ORDER BY c.name""")

    return {
        "disk": {
            "database": {"bytes": db_bytes},
            "uploads": uploads,
            "exports": exports,
            "total": db_bytes + uploads["bytes"] + exports["bytes"],
            "path": str(DATA_DIR),
        },
        "counts": counts,
        "avg_entry_chars": round(avg_chars),
        "growth": [
            {"month": m, "kb": kb_by_month.get(m, 0), "questionnaires": qq_by_month.get(m, 0)}
            for m in months
        ],
        "backlog": backlog,
        "coverage": coverage,
        "per_client": per_client,
    }


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    """Vocabulaire de référence exposé au front (listes déroulantes, seuils)."""
    from .thesaurus import CATEGORIES

    return {
        "categories": ["Général", *sorted(CATEGORIES)],
        "config_categories": [
            "Chiffrement", "Identité & accès", "Réseau & infrastructure",
            "Sauvegarde & continuité", "Journalisation & supervision",
            "Poste de travail", "Cloud & hébergement", "Développement",
            "Sécurité physique", "Autre",
        ],
        "config_statuses": ["en place", "partiel", "planifié", "non applicable"],
        "thresholds": {"high": search.HIGH, "medium": search.MEDIUM, "low": search.LOW},
    }


# ==========================================================================
# Référentiels
# ==========================================================================

@app.get("/api/frameworks")
def list_frameworks() -> list[dict[str, Any]]:
    with get_db() as conn:
        return rows(conn, """
            SELECT f.*, COUNT(c.id) AS n_controls
            FROM framework f LEFT JOIN control c ON c.framework_id = f.id
            GROUP BY f.id ORDER BY f.sort_order""")


@app.get("/api/frameworks/{framework_id}/controls")
def framework_controls(framework_id: int) -> list[dict[str, Any]]:
    with get_db() as conn:
        return rows(conn, """
            SELECT c.*, (SELECT COUNT(*) FROM kb_control kc WHERE kc.control_id = c.id) AS n_kb
            FROM control c WHERE c.framework_id = ? ORDER BY c.sort_order""", (framework_id,))


@app.get("/api/controls")
def search_controls(q: str = "", limit: int = 40) -> list[dict[str, Any]]:
    with get_db() as conn:
        if not q.strip():
            return rows(conn, """
                SELECT c.id, c.ref, c.title, c.theme, f.code AS framework_code, f.accent
                FROM control c JOIN framework f ON f.id = c.framework_id
                ORDER BY f.sort_order, c.sort_order LIMIT ?""", (limit,))
        like = f"%{q.strip()}%"
        return rows(conn, """
            SELECT c.id, c.ref, c.title, c.theme, f.code AS framework_code, f.accent
            FROM control c JOIN framework f ON f.id = c.framework_id
            WHERE c.ref LIKE ? OR c.title LIKE ? OR c.description LIKE ? OR f.code LIKE ?
            ORDER BY f.sort_order, c.sort_order LIMIT ?""",
            (like, like, like, like, limit))


# ==========================================================================
# Clients
# ==========================================================================

@app.get("/api/clients")
def list_clients() -> list[dict[str, Any]]:
    with get_db() as conn:
        return rows(conn, """
            SELECT c.*,
              (SELECT COUNT(*) FROM kb_entry k WHERE k.client_id = c.id) AS n_kb,
              (SELECT COUNT(*) FROM config_item g WHERE g.client_id = c.id) AS n_configs,
              (SELECT COUNT(*) FROM questionnaire q WHERE q.client_id = c.id) AS n_questionnaires
            FROM client c ORDER BY c.name""")


@app.post("/api/clients", status_code=201)
def create_client(payload: ClientIn, request: Request) -> dict[str, Any]:
    with get_db() as conn:
        exists = one(conn, "SELECT id FROM client WHERE name = ?", (payload.name,))
        if exists:
            raise HTTPException(409, "Un client porte déjà ce nom.")
        ts = now()
        cur = conn.execute(
            """INSERT INTO client (name, country, contact, description, status,
                                   created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (payload.name, payload.country, payload.contact,
             payload.description, payload.status, ts, ts))
        audit.record(conn, "client.created", request=request, actor=request.state.user,
                     target_type="client", target_id=cur.lastrowid, target_label=payload.name)
        return one(conn, "SELECT * FROM client WHERE id = ?", (cur.lastrowid,))


@app.get("/api/clients/{client_id}")
def get_client(client_id: int) -> dict[str, Any]:
    with get_db() as conn:
        client = one(conn, "SELECT * FROM client WHERE id = ?", (client_id,))
        if not client:
            raise HTTPException(404, "Client introuvable.")
        client["n_kb"] = scalar(
            conn, "SELECT COUNT(*) FROM kb_entry WHERE client_id = ?", (client_id,))
        client["n_configs"] = scalar(
            conn, "SELECT COUNT(*) FROM config_item WHERE client_id = ?", (client_id,))
        client["n_questionnaires"] = scalar(
            conn, "SELECT COUNT(*) FROM questionnaire WHERE client_id = ?", (client_id,))
        # Couverture par référentiel : contrôles reliés à au moins une réponse
        # disponible pour ce client (spécifique ou générique).
        client["coverage"] = rows(conn, """
            SELECT f.code, f.name, f.accent, COUNT(DISTINCT c.id) AS n_controls,
                   COUNT(DISTINCT CASE WHEN k.id IS NOT NULL THEN c.id END) AS n_covered
            FROM framework f
            JOIN control c ON c.framework_id = f.id
            LEFT JOIN kb_control kc ON kc.control_id = c.id
            LEFT JOIN kb_entry k ON k.id = kc.kb_entry_id
                 AND k.status != 'obsolete'
                 AND (k.client_id IS NULL OR k.client_id = ?)
            GROUP BY f.id ORDER BY f.sort_order""", (client_id,))
        return client


@app.put("/api/clients/{client_id}")
def update_client(client_id: int, payload: ClientIn, request: Request) -> dict[str, Any]:
    with get_db() as conn:
        if not one(conn, "SELECT id FROM client WHERE id = ?", (client_id,)):
            raise HTTPException(404, "Client introuvable.")
        conn.execute(
            """UPDATE client SET name=?, country=?, contact=?, description=?,
                                 status=?, updated_at=? WHERE id=?""",
            (payload.name, payload.country, payload.contact,
             payload.description, payload.status, now(), client_id))
        audit.record(conn, "client.updated", request=request, actor=request.state.user,
                     target_type="client", target_id=client_id, target_label=payload.name)
        return one(conn, "SELECT * FROM client WHERE id = ?", (client_id,))


@app.delete("/api/clients/{client_id}", status_code=204)
def delete_client(client_id: int, request: Request) -> None:
    with get_db() as conn:
        target = one(conn, "SELECT name FROM client WHERE id = ?", (client_id,))
        if not target:
            raise HTTPException(404, "Client introuvable.")
        # Ce que la cascade va emporter : chiffré dans la trace, car le détail
        # ne sera plus reconstituable après coup.
        losses = {
            "réponses": scalar(conn, "SELECT COUNT(*) FROM kb_entry WHERE client_id = ?",
                               (client_id,)) or 0,
            "configurations": scalar(conn, "SELECT COUNT(*) FROM config_item WHERE client_id = ?",
                                     (client_id,)) or 0,
            "questionnaires": scalar(conn, "SELECT COUNT(*) FROM questionnaire WHERE client_id = ?",
                                     (client_id,)) or 0,
        }
        for row in conn.execute(
            "SELECT stored_path FROM questionnaire WHERE client_id = ?", (client_id,)
        ):
            _remove_file(row["stored_path"])
        conn.execute("DELETE FROM client WHERE id = ?", (client_id,))
        audit.record(conn, "client.deleted", request=request, actor=request.state.user,
                     target_type="client", target_id=client_id, target_label=target["name"],
                     detail="Suppression en cascade : "
                            + ", ".join(f"{n} {k}" for k, n in losses.items()))


# ==========================================================================
# Base de connaissance
# ==========================================================================

@app.get("/api/kb")
def list_kb(
    client_id: int | None = None,
    include_generic: bool = True,
    q: str = "",
    category: str = "",
    status: str = "",
    control_id: int | None = None,
    limit: int = 400,
) -> list[dict[str, Any]]:
    with get_db() as conn:
        where: list[str] = []
        params: list[Any] = []

        if client_id is not None:
            where.append("(e.client_id = ?" + (" OR e.client_id IS NULL)" if include_generic else ")"))
            params.append(client_id)
        elif not include_generic:
            where.append("e.client_id IS NOT NULL")

        if q.strip():
            like = f"%{q.strip()}%"
            where.append("(e.question LIKE ? OR e.answer LIKE ? OR e.tags LIKE ?)")
            params += [like, like, like]
        if category:
            where.append("e.category = ?")
            params.append(category)
        if status:
            where.append("e.status = ?")
            params.append(status)
        if control_id:
            where.append("EXISTS (SELECT 1 FROM kb_control kc WHERE kc.kb_entry_id = e.id "
                         "AND kc.control_id = ?)")
            params.append(control_id)

        clause = f"WHERE {' AND '.join(where)}" if where else ""
        entries = rows(conn, f"""
            SELECT e.*, cl.name AS client_name
            FROM kb_entry e LEFT JOIN client cl ON cl.id = e.client_id
            {clause}
            ORDER BY e.updated_at DESC LIMIT ?""", tuple(params) + (limit,))
        _attach_controls(conn, entries)
        return entries


@app.get("/api/kb/categories")
def kb_categories() -> list[dict[str, Any]]:
    with get_db() as conn:
        return rows(conn, "SELECT category, COUNT(*) AS n FROM kb_entry "
                          "GROUP BY category ORDER BY category")


def _kb_scope(conn, client_id: int | None) -> str:
    """Portée d'une entrée, pour la trace : générique ou nom du client."""
    if client_id is None:
        return "portée générique"
    row = one(conn, "SELECT name FROM client WHERE id = ?", (client_id,))
    return f"client {row['name']}" if row else f"client #{client_id}"


@app.post("/api/kb", status_code=201)
def create_kb(payload: KbIn, request: Request) -> dict[str, Any]:
    with get_db() as conn:
        ts = now()
        cur = conn.execute(
            """INSERT INTO kb_entry (client_id, question, answer, category, tags, status,
                                     evidence, source, created_at, updated_at, reviewed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (payload.client_id, payload.question.strip(), payload.answer.strip(),
             payload.category, payload.tags, payload.status, payload.evidence,
             payload.source, ts, ts, ts if payload.status == "validated" else None))
        _set_controls(conn, cur.lastrowid, payload.control_ids)
        # On journalise la question (identifie l'entrée) mais jamais la réponse :
        # c'est le contenu de conformité du client, il n'a rien à faire dupliqué
        # dans un journal consultable par tout administrateur.
        audit.record(conn, "kb.created", request=request, actor=request.state.user,
                     target_type="kb_entry", target_id=cur.lastrowid,
                     target_label=payload.question.strip(),
                     detail=f"{_kb_scope(conn, payload.client_id)} · {payload.category} · "
                            f"statut {payload.status}")
        return _kb_detail(conn, cur.lastrowid)


@app.put("/api/kb/{entry_id}")
def update_kb(entry_id: int, payload: KbIn, request: Request) -> dict[str, Any]:
    with get_db() as conn:
        current = one(conn, "SELECT * FROM kb_entry WHERE id = ?", (entry_id,))
        if not current:
            raise HTTPException(404, "Entrée introuvable.")
        reviewed = now() if payload.status == "validated" else current["reviewed_at"]
        conn.execute(
            """UPDATE kb_entry SET client_id=?, question=?, answer=?, category=?, tags=?,
                                   status=?, evidence=?, source=?, updated_at=?, reviewed_at=?
               WHERE id=?""",
            (payload.client_id, payload.question.strip(), payload.answer.strip(),
             payload.category, payload.tags, payload.status, payload.evidence,
             payload.source, now(), reviewed, entry_id))
        _set_controls(conn, entry_id, payload.control_ids)

        changes = []
        if current["answer"] != payload.answer.strip():
            changes.append("réponse modifiée")
        if current["status"] != payload.status:
            changes.append(f"statut {current['status']} → {payload.status}")
        if current["client_id"] != payload.client_id:
            changes.append(f"portée → {_kb_scope(conn, payload.client_id)}")
        audit.record(conn, "kb.updated", request=request, actor=request.state.user,
                     target_type="kb_entry", target_id=entry_id,
                     target_label=payload.question.strip(),
                     detail=" ; ".join(changes) or "métadonnées")
        return _kb_detail(conn, entry_id)


@app.delete("/api/kb/{entry_id}", status_code=204)
def delete_kb(entry_id: int, request: Request) -> None:
    with get_db() as conn:
        target = one(conn, "SELECT question, client_id FROM kb_entry WHERE id = ?", (entry_id,))
        if not target:
            raise HTTPException(404, "Entrée introuvable.")
        conn.execute("DELETE FROM kb_entry WHERE id = ?", (entry_id,))
        audit.record(conn, "kb.deleted", request=request, actor=request.state.user,
                     target_type="kb_entry", target_id=entry_id,
                     target_label=target["question"],
                     detail=_kb_scope(conn, target["client_id"]))


# ==========================================================================
# Configurations techniques
# ==========================================================================

@app.get("/api/configs")
def list_configs(client_id: int | None = None) -> list[dict[str, Any]]:
    with get_db() as conn:
        if client_id is None:
            return rows(conn, """
                SELECT g.*, c.name AS client_name FROM config_item g
                JOIN client c ON c.id = g.client_id
                ORDER BY c.name, g.category, g.label""")
        return rows(conn, "SELECT * FROM config_item WHERE client_id = ? "
                          "ORDER BY category, label", (client_id,))


@app.post("/api/configs", status_code=201)
def create_config(payload: ConfigIn, request: Request) -> dict[str, Any]:
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO config_item (client_id, category, label, value, details,
                                        scope, status, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (payload.client_id, payload.category, payload.label.strip(),
             payload.value.strip(), payload.details, payload.scope, payload.status, now()))
        audit.record(conn, "config.created", request=request, actor=request.state.user,
                     target_type="config_item", target_id=cur.lastrowid,
                     target_label=f"{payload.category} — {payload.label.strip()}",
                     detail=_kb_scope(conn, payload.client_id))
        return one(conn, "SELECT * FROM config_item WHERE id = ?", (cur.lastrowid,))


@app.put("/api/configs/{config_id}")
def update_config(config_id: int, payload: ConfigIn, request: Request) -> dict[str, Any]:
    with get_db() as conn:
        current = one(conn, "SELECT * FROM config_item WHERE id = ?", (config_id,))
        if not current:
            raise HTTPException(404, "Configuration introuvable.")
        conn.execute(
            """UPDATE config_item SET client_id=?, category=?, label=?, value=?, details=?,
                                      scope=?, status=?, updated_at=? WHERE id=?""",
            (payload.client_id, payload.category, payload.label.strip(),
             payload.value.strip(), payload.details, payload.scope, payload.status,
             now(), config_id))
        # La valeur d'une configuration technique (« AES-256-GCM », « TLS 1.3 »)
        # est un fait d'architecture, pas un secret : la tracer permet de savoir
        # depuis quand une réponse client affirme telle ou telle mesure.
        detail = (f"valeur « {current['value']} » → « {payload.value.strip()}»"
                  if current["value"] != payload.value.strip() else "métadonnées")
        audit.record(conn, "config.updated", request=request, actor=request.state.user,
                     target_type="config_item", target_id=config_id,
                     target_label=f"{payload.category} — {payload.label.strip()}",
                     detail=detail)
        return one(conn, "SELECT * FROM config_item WHERE id = ?", (config_id,))


@app.delete("/api/configs/{config_id}", status_code=204)
def delete_config(config_id: int, request: Request) -> None:
    with get_db() as conn:
        target = one(conn, "SELECT category, label FROM config_item WHERE id = ?", (config_id,))
        if not target:
            raise HTTPException(404, "Configuration introuvable.")
        conn.execute("DELETE FROM config_item WHERE id = ?", (config_id,))
        audit.record(conn, "config.deleted", request=request, actor=request.state.user,
                     target_type="config_item", target_id=config_id,
                     target_label=f"{target['category']} — {target['label']}")


# ==========================================================================
# Interrogation directe du moteur
# ==========================================================================

@app.post("/api/answer")
def answer_question(payload: AnswerQuery) -> dict[str, Any]:
    with get_db() as conn:
        index = search.build_index(conn, payload.client_id)
        matches = index.search(payload.question, payload.client_id, top_k=payload.top_k)
        text, confidence, best = search.compose_answer(matches)
        return {
            "answer": text,
            "confidence": round(confidence, 4),
            "band": band(confidence),
            "best": best.as_dict() if best else None,
            "candidates": [m.as_dict() for m in matches],
            "indexed_documents": index.n,
        }


# ==========================================================================
# Questionnaires
# ==========================================================================

@app.get("/api/questionnaires")
def list_questionnaires(client_id: int | None = None) -> list[dict[str, Any]]:
    with get_db() as conn:
        clause = "WHERE q.client_id = ?" if client_id is not None else ""
        params = (client_id,) if client_id is not None else ()
        return rows(conn, f"""
            SELECT q.*, c.name AS client_name,
              (SELECT COUNT(*) FROM qq_question x WHERE x.questionnaire_id = q.id) AS n_questions,
              (SELECT COUNT(*) FROM qq_question x WHERE x.questionnaire_id = q.id
                 AND x.status = 'validated') AS n_validated,
              (SELECT COUNT(*) FROM qq_question x WHERE x.questionnaire_id = q.id
                 AND x.status = 'na') AS n_na,
              (SELECT COUNT(*) FROM qq_question x WHERE x.questionnaire_id = q.id
                 AND TRIM(COALESCE(x.final_answer, x.suggested_answer, '')) != '') AS n_answered
            FROM questionnaire q JOIN client c ON c.id = q.client_id
            {clause} ORDER BY q.updated_at DESC""", params)


@app.post("/api/questionnaires/upload", status_code=201)
async def upload_questionnaire(
    request: Request,
    client_id: int = Form(...),
    name: str = Form(""),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    filename = file.filename or "questionnaire"
    file_type = parsers.detect_file_type(filename)
    if file_type not in ("xlsx", "docx", "pdf", "csv"):
        raise HTTPException(
            415, f"Format « {file_type} » non pris en charge. "
                 "Formats acceptés : Excel, Word, PDF, CSV.")

    stored = UPLOAD_DIR / f"{uuid.uuid4().hex}_{Path(filename).name}"
    with stored.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    try:
        result = parsers.parse(stored, filename)
    except Exception as exc:
        _remove_file(str(stored))
        raise HTTPException(422, f"Lecture impossible : {exc}") from exc

    with get_db() as conn:
        if not one(conn, "SELECT id FROM client WHERE id = ?", (client_id,)):
            _remove_file(str(stored))
            raise HTTPException(404, "Client introuvable.")
        label = name.strip() or Path(filename).stem
        qid = _insert_questionnaire(conn, client_id, label, filename, str(stored), result)
        audit.record(conn, "questionnaire.imported", request=request, actor=request.state.user,
                     target_type="questionnaire", target_id=qid, target_label=label,
                     detail=f"{_kb_scope(conn, client_id)} · fichier {filename} "
                            f"({file_type}) · {len(result.questions)} question(s) extraite(s)")
        payload = _questionnaire_detail(conn, qid)
        payload["warnings"] = result.warnings
        return payload


@app.post("/api/questionnaires/manual", status_code=201)
def create_manual_questionnaire(payload: ManualQuestionnaire, request: Request) -> dict[str, Any]:
    result = parsers.parse_text_block(payload.text)
    if not result.questions:
        raise HTTPException(422, "Aucune question exploitable dans le texte fourni.")
    with get_db() as conn:
        if not one(conn, "SELECT id FROM client WHERE id = ?", (payload.client_id,)):
            raise HTTPException(404, "Client introuvable.")
        qid = _insert_questionnaire(
            conn, payload.client_id, payload.name.strip(), None, None, result)
        audit.record(conn, "questionnaire.imported", request=request, actor=request.state.user,
                     target_type="questionnaire", target_id=qid,
                     target_label=payload.name.strip(),
                     detail=f"{_kb_scope(conn, payload.client_id)} · saisie manuelle · "
                            f"{len(result.questions)} question(s)")
        return _questionnaire_detail(conn, qid)


@app.get("/api/questionnaires/{questionnaire_id}")
def get_questionnaire(questionnaire_id: int) -> dict[str, Any]:
    with get_db() as conn:
        return _questionnaire_detail(conn, questionnaire_id)


@app.delete("/api/questionnaires/{questionnaire_id}", status_code=204)
def delete_questionnaire(questionnaire_id: int, request: Request) -> None:
    with get_db() as conn:
        row = one(conn, "SELECT stored_path, name FROM questionnaire WHERE id = ?",
                  (questionnaire_id,))
        if not row:
            raise HTTPException(404, "Questionnaire introuvable.")
        n_questions = scalar(
            conn, "SELECT COUNT(*) FROM qq_question WHERE questionnaire_id = ?",
            (questionnaire_id,)) or 0
        _remove_file(row["stored_path"])
        conn.execute("DELETE FROM questionnaire WHERE id = ?", (questionnaire_id,))
        audit.record(conn, "questionnaire.deleted", request=request, actor=request.state.user,
                     target_type="questionnaire", target_id=questionnaire_id,
                     target_label=row["name"],
                     detail=f"{n_questions} question(s) et le fichier d'origine supprimés")


@app.post("/api/questionnaires/{questionnaire_id}/autoanswer")
def autoanswer(questionnaire_id: int, force: bool = False) -> dict[str, Any]:
    """Passe le moteur sur les questions non encore validées."""
    with get_db() as conn:
        questionnaire = one(conn, "SELECT * FROM questionnaire WHERE id = ?",
                            (questionnaire_id,))
        if not questionnaire:
            raise HTTPException(404, "Questionnaire introuvable.")

        client_id = questionnaire["client_id"]
        index = search.build_index(conn, client_id)

        statuses = ("pending", "auto") if force else ("pending",)
        placeholders = ",".join("?" * len(statuses))
        targets = rows(conn, f"""
            SELECT id, text FROM qq_question
            WHERE questionnaire_id = ? AND status IN ({placeholders})
            ORDER BY idx""", (questionnaire_id, *statuses))

        counts = {"haute": 0, "moyenne": 0, "faible": 0, "aucune": 0}
        for target in targets:
            matches = index.search(target["text"], client_id, top_k=5)
            text, confidence, best = search.compose_answer(matches)
            level = band(confidence) if text else "aucune"
            counts[level] += 1
            conn.execute(
                """UPDATE qq_question
                   SET suggested_answer=?, confidence=?, matched_kind=?, matched_id=?,
                       candidates_json=?, status=?
                   WHERE id=?""",
                (text or None, confidence,
                 best.document.kind if best else None,
                 best.document.id if best else None,
                 json.dumps([m.as_dict() for m in matches], ensure_ascii=False),
                 "auto" if text else "pending", target["id"]))

        conn.execute("UPDATE questionnaire SET updated_at=? WHERE id=?",
                     (now(), questionnaire_id))
        detail = _questionnaire_detail(conn, questionnaire_id)
        detail["run"] = {"processed": len(targets), "by_band": counts,
                         "indexed_documents": index.n}
        return detail


@app.patch("/api/questions/{question_id}")
def patch_question(question_id: int, payload: QuestionPatch) -> dict[str, Any]:
    with get_db() as conn:
        current = one(conn, "SELECT * FROM qq_question WHERE id = ?", (question_id,))
        if not current:
            raise HTTPException(404, "Question introuvable.")

        final_answer = current["final_answer"]
        if payload.final_answer is not None:
            final_answer = payload.final_answer.strip() or None
        status = payload.status or current["status"]

        # Valider sans réponse explicite revient à entériner la proposition.
        if status == "validated" and not final_answer:
            final_answer = current["suggested_answer"]
            if not final_answer:
                raise HTTPException(400, "Impossible de valider une question sans réponse.")

        conn.execute(
            "UPDATE qq_question SET final_answer=?, status=? WHERE id=?",
            (final_answer, status, question_id))

        # Compteur de réutilisation : mesure la valeur réelle de la base.
        if status == "validated" and current["status"] != "validated" \
                and current["matched_kind"] == "kb" and current["matched_id"]:
            conn.execute(
                "UPDATE kb_entry SET usage_count = usage_count + 1 WHERE id = ?",
                (current["matched_id"],))

        conn.execute("UPDATE questionnaire SET updated_at=? WHERE id=?",
                     (now(), current["questionnaire_id"]))
        return one(conn, "SELECT * FROM qq_question WHERE id = ?", (question_id,))


@app.post("/api/questions/{question_id}/rematch")
def rematch_question(
    question_id: int,
    q: str = Body("", embed=True),
) -> dict[str, Any]:
    """Relance une recherche, éventuellement avec une reformulation manuelle."""
    with get_db() as conn:
        question = one(conn, """
            SELECT x.*, qn.client_id FROM qq_question x
            JOIN questionnaire qn ON qn.id = x.questionnaire_id
            WHERE x.id = ?""", (question_id,))
        if not question:
            raise HTTPException(404, "Question introuvable.")

        index = search.build_index(conn, question["client_id"])
        matches = index.search(q.strip() or question["text"], question["client_id"], top_k=8)
        return {"candidates": [m.as_dict() for m in matches]}


@app.post("/api/questions/{question_id}/apply")
def apply_candidate(
    question_id: int,
    kind: str = Body(...),
    source_id: int = Body(...),
) -> dict[str, Any]:
    """Applique manuellement un candidat proposé par le moteur."""
    with get_db() as conn:
        question = one(conn, """
            SELECT x.*, qn.client_id FROM qq_question x
            JOIN questionnaire qn ON qn.id = x.questionnaire_id
            WHERE x.id = ?""", (question_id,))
        if not question:
            raise HTTPException(404, "Question introuvable.")

        if kind == "kb":
            row = one(conn, "SELECT answer FROM kb_entry WHERE id = ?", (source_id,))
            text = row["answer"] if row else None
        else:
            row = one(conn, "SELECT * FROM config_item WHERE id = ?", (source_id,))
            text = None
            if row:
                text = f"{row['label']} : {row['value']}"
                if row["details"]:
                    text += f"\n{row['details']}"
        if not text:
            raise HTTPException(404, "Source introuvable.")

        conn.execute(
            """UPDATE qq_question SET final_answer=?, matched_kind=?, matched_id=?,
                                      status=CASE WHEN status='pending' THEN 'auto' ELSE status END
               WHERE id=?""", (text, kind, source_id, question_id))
        return one(conn, "SELECT * FROM qq_question WHERE id = ?", (question_id,))


@app.post("/api/questionnaires/{questionnaire_id}/validate-high")
def validate_high_confidence(
    questionnaire_id: int,
    threshold: float = Query(search.HIGH, ge=0.0, le=1.0),
) -> dict[str, Any]:
    """Valide en masse les propositions dont la confiance dépasse le seuil."""
    with get_db() as conn:
        targets = rows(conn, """
            SELECT id, suggested_answer, matched_kind, matched_id FROM qq_question
            WHERE questionnaire_id = ? AND status = 'auto' AND confidence >= ?
              AND TRIM(COALESCE(suggested_answer, '')) != ''""",
            (questionnaire_id, threshold))
        for target in targets:
            conn.execute(
                "UPDATE qq_question SET final_answer=COALESCE(final_answer, ?), "
                "status='validated' WHERE id=?",
                (target["suggested_answer"], target["id"]))
            if target["matched_kind"] == "kb" and target["matched_id"]:
                conn.execute(
                    "UPDATE kb_entry SET usage_count = usage_count + 1 WHERE id = ?",
                    (target["matched_id"],))
        conn.execute("UPDATE questionnaire SET updated_at=? WHERE id=?",
                     (now(), questionnaire_id))
        detail = _questionnaire_detail(conn, questionnaire_id)
        detail["validated"] = len(targets)
        return detail


@app.get("/api/questionnaires/{questionnaire_id}/export")
def export_questionnaire(
    questionnaire_id: int,
    request: Request,
    mode: Literal["original", "report"] = "report",
) -> FileResponse:
    with get_db() as conn:
        questionnaire = one(conn, """
            SELECT q.*, c.name AS client_name FROM questionnaire q
            JOIN client c ON c.id = q.client_id WHERE q.id = ?""", (questionnaire_id,))
        if not questionnaire:
            raise HTTPException(404, "Questionnaire introuvable.")
        questions = rows(conn, "SELECT * FROM qq_question WHERE questionnaire_id = ? "
                               "ORDER BY idx", (questionnaire_id,))

    try:
        if mode == "original":
            if questionnaire["file_type"] != "xlsx" or not questionnaire["stored_path"]:
                raise HTTPException(
                    400, "La réinjection dans le fichier d'origine n'est possible que "
                         "pour les questionnaires Excel. Utilisez l'export rapport.")
            target = export_mod.export_original(questionnaire, questions)
        else:
            target = export_mod.export_report(
                questionnaire, questions, questionnaire["client_name"])
    except HTTPException:
        raise
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc

    # Un export fait sortir des réponses de conformité de l'outil : c'est
    # l'événement le plus important à tracer, avec qui l'a demandé et quand.
    with get_db() as conn:
        answered = sum(
            1 for q in questions if (q["final_answer"] or q["suggested_answer"] or "").strip())
        audit.record(conn, "export.generated", request=request, actor=request.state.user,
                     target_type="questionnaire", target_id=questionnaire_id,
                     target_label=questionnaire["name"],
                     detail=f"{_kb_scope(conn, questionnaire['client_id'])} · "
                            f"mode {'fichier client complété' if mode == 'original' else 'rapport'} · "
                            f"{answered}/{len(questions)} réponse(s) · fichier {target.name}")

    return FileResponse(
        target,
        filename=target.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


# ==========================================================================
# Helpers internes
# ==========================================================================

def _remove_file(path: str | None) -> None:
    if not path:
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def _attach_controls(conn, entries: list[dict[str, Any]]) -> None:
    if not entries:
        return
    ids = [e["id"] for e in entries]
    placeholders = ",".join("?" * len(ids))
    mapping: dict[int, list[dict[str, Any]]] = {i: [] for i in ids}
    for row in conn.execute(f"""
        SELECT kc.kb_entry_id, c.id, c.ref, c.title, f.code AS framework_code, f.accent
        FROM kb_control kc
        JOIN control c ON c.id = kc.control_id
        JOIN framework f ON f.id = c.framework_id
        WHERE kc.kb_entry_id IN ({placeholders})
        ORDER BY f.sort_order, c.sort_order""", ids):
        mapping[row["kb_entry_id"]].append({
            "id": row["id"], "ref": row["ref"], "title": row["title"],
            "framework_code": row["framework_code"], "accent": row["accent"],
        })
    for entry in entries:
        entry["controls"] = mapping.get(entry["id"], [])


def _set_controls(conn, entry_id: int, control_ids: list[int]) -> None:
    conn.execute("DELETE FROM kb_control WHERE kb_entry_id = ?", (entry_id,))
    for control_id in dict.fromkeys(control_ids):
        conn.execute(
            "INSERT OR IGNORE INTO kb_control (kb_entry_id, control_id) VALUES (?, ?)",
            (entry_id, control_id))


def _kb_detail(conn, entry_id: int) -> dict[str, Any]:
    entry = one(conn, """
        SELECT e.*, cl.name AS client_name FROM kb_entry e
        LEFT JOIN client cl ON cl.id = e.client_id WHERE e.id = ?""", (entry_id,))
    if not entry:
        raise HTTPException(404, "Entrée introuvable.")
    _attach_controls(conn, [entry])
    return entry


def _insert_questionnaire(conn, client_id: int, name: str, filename: str | None,
                          stored_path: str | None, result: parsers.ParseResult) -> int:
    ts = now()
    cur = conn.execute(
        """INSERT INTO questionnaire (client_id, name, original_filename, stored_path,
                                      file_type, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'en cours', ?, ?)""",
        (client_id, name, filename, stored_path, result.file_type, ts, ts))
    qid = cur.lastrowid
    for question in result.questions:
        conn.execute(
            """INSERT INTO qq_question (questionnaire_id, idx, ref, section, text,
                                        locator_json)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (qid, question.idx, question.ref, question.section, question.text,
             json.dumps(question.locator, ensure_ascii=False) if question.locator else None))
    return qid


def _questionnaire_detail(conn, questionnaire_id: int) -> dict[str, Any]:
    questionnaire = one(conn, """
        SELECT q.*, c.name AS client_name FROM questionnaire q
        JOIN client c ON c.id = q.client_id WHERE q.id = ?""", (questionnaire_id,))
    if not questionnaire:
        raise HTTPException(404, "Questionnaire introuvable.")

    questions = rows(conn, "SELECT * FROM qq_question WHERE questionnaire_id = ? "
                           "ORDER BY idx", (questionnaire_id,))
    for question in questions:
        question["candidates"] = json.loads(question.pop("candidates_json") or "[]")
        question["band"] = band(question["confidence"] or 0)
        question.pop("locator_json", None)

    total = len(questions)
    questionnaire["questions"] = questions
    questionnaire["summary"] = {
        "total": total,
        "answered": sum(1 for q in questions
                        if (q["final_answer"] or q["suggested_answer"] or "").strip()),
        "validated": sum(1 for q in questions if q["status"] == "validated"),
        "na": sum(1 for q in questions if q["status"] == "na"),
        "pending": sum(1 for q in questions if q["status"] == "pending"),
        "high": sum(1 for q in questions if (q["confidence"] or 0) >= search.HIGH),
        "medium": sum(1 for q in questions
                      if MEDIUM <= (q["confidence"] or 0) < search.HIGH),
        "can_export_original": questionnaire["file_type"] == "xlsx"
                               and bool(questionnaire["stored_path"]),
    }
    return questionnaire


# ==========================================================================
# SPA
#
# Mise en cache : l'application est servie depuis le poste ou un serveur du
# réseau local, où le coût d'un rechargement est négligeable. En revanche, un
# fichier JavaScript périmé gardé par le navigateur produit des bugs
# déroutants — une interface qui affiche un état que le serveur a déjà
# corrigé. On impose donc une revalidation systématique : le navigateur
# redemande le fichier, le serveur répond 304 s'il n'a pas changé (donc sans
# transfert), et sert la nouvelle version dès qu'elle change.
# ==========================================================================

_NO_CACHE = {"Cache-Control": "no-cache, must-revalidate"}


class RevalidatingStaticFiles(StaticFiles):
    """StaticFiles qui interdit au navigateur de réutiliser un fichier sans
    d'abord demander au serveur s'il a changé.

    Sans cet en-tête, le navigateur applique une durée de fraîcheur heuristique
    et peut réutiliser un module JavaScript périmé pendant des heures. Le
    symptôme est déroutant : l'interface affiche un état que le serveur a déjà
    corrigé. Ici le coût d'une revalidation est nul — tout est servi en local.
    """

    def file_response(self, *args: Any, **kwargs: Any) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers.update(_NO_CACHE)
        return response


# Empreinte des ressources front, dérivée de leur date de modification. Elle
# est injectée dans les URL des pages HTML : quand un fichier change, l'URL
# change, et le navigateur ne peut pas servir une version périmée.
_ASSET_REF = re.compile(r'(?P<attr>(?:src|href)=")(?P<url>/static/[^"?]+\.(?:js|css))"')


def _asset_version() -> str:
    latest = 0.0
    for path in WEB_DIR.rglob("*"):
        if path.suffix in (".js", ".css") and path.is_file():
            latest = max(latest, path.stat().st_mtime)
    return str(int(latest))


def _render_page(filename: str) -> HTMLResponse:
    html = (WEB_DIR / filename).read_text(encoding="utf-8")
    version = _asset_version()
    html = _ASSET_REF.sub(
        lambda m: f'{m.group("attr")}{m.group("url")}?v={version}"', html)
    return HTMLResponse(html, headers=_NO_CACHE)


@app.get("/")
def index() -> HTMLResponse:
    return _render_page("index.html")


@app.get("/login")
@app.get("/setup")
def login_page() -> HTMLResponse:
    return _render_page("login.html")


@app.exception_handler(404)
async def spa_fallback(request, exc):  # noqa: ANN001
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": getattr(exc, "detail", "Not found")}, status_code=404)
    return _render_page("index.html")


app.mount("/static", RevalidatingStaticFiles(directory=WEB_DIR), name="static")

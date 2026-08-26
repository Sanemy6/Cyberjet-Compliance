import { useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { MfaDialogs, type MfaAction } from '@/components/Mfa';
import { PageMeta } from '@/components/layout/Shell';
import { useSession } from '@/lib/session';
import { fmtDate, plural } from '@/lib/format';

/**
 * Sécurité du compte : état du second facteur et explication des méthodes.
 *
 * Les dialogues eux-mêmes vivent dans `Mfa.tsx` — cette page et le panneau de
 * réglages y conduisent tous les deux.
 */
export function SecurityPage() {
  const { status, refresh } = useSession();
  const [action, setAction] = useState<MfaAction>(null);

  if (!status) return null;

  const enabled = status.mfaEnabled;
  const remaining = status.recoveryCodesRemaining;
  const lowCodes = enabled && remaining <= 2;

  return (
    <>
      <PageMeta crumb={[{ label: 'Sécurité du compte' }]} />

      <div className="page-head">
        <div>
          <p className="eyebrow"><Icon name="lock" />Mon compte</p>
          <h1>Sécurité du compte</h1>
          <p className="sub">
            Connecté en tant que <b>{status.fullName || status.username}</b>
            {status.isAdmin && ' · administrateur'}.
          </p>
        </div>
      </div>

      <div className="grid side">
        <div className="flex col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h2>Vérification en deux étapes</h2>
              {enabled
                ? <span className="badge ok"><Icon name="shieldCheck" />Activée</span>
                : <span className="badge warn"><Icon name="alert" />Non activée</span>}
            </div>

            <div className="card-body">
              {enabled ? (
                <>
                  <p className="muted">
                    Une application d’authentification est associée à ce compte
                    {/* Pas de repli sur la date du jour : afficher une date fabriquée
                        serait pire que ne rien afficher, sur un écran de sécurité. */}
                    {status.mfaEnabledAt && <> depuis le <b>{fmtDate(status.mfaEnabledAt)}</b></>}.
                    {' '}Un code vous est demandé à chaque nouvelle connexion.
                  </p>
                  <div className="flex wrap mt-2" style={{ gap: 8 }}>
                    <span className={`badge ${remaining <= 2 ? 'danger' : 'ok'}`}>
                      <Icon name="key" />{remaining} {plural(remaining, 'code')} de
                      récupération {plural(remaining, 'restant')}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted">
                    Votre compte n’est protégé que par son mot de passe. La vérification en
                    deux étapes ajoute un code temporaire généré par votre téléphone : un mot
                    de passe volé ne suffit alors plus à entrer.
                  </p>
                  <p className="muted small mt-2">
                    Particulièrement recommandé ici : cette application contient les
                    configurations de sécurité de vos clients.
                  </p>
                </>
              )}
            </div>

            <div className="card-foot" style={{ justifyContent: 'flex-start' }}>
              {enabled ? (
                <>
                  <button className="btn" onClick={() => setAction('regenerate')}>
                    <Icon name="refresh" />Régénérer les codes de récupération
                  </button>
                  <button className="btn danger" onClick={() => setAction('disable')}>
                    <Icon name="slash" />Désactiver
                  </button>
                </>
              ) : (
                <button className="btn primary" onClick={() => setAction('enroll')}>
                  <Icon name="lock" />Activer la vérification en deux étapes
                </button>
              )}
            </div>
          </div>

          {lowCodes && (
            <div className="callout danger">
              <Icon name="alert" />
              <div>
                <p><b>
                  Il ne vous reste que {remaining} {plural(remaining, 'code')} de récupération.
                </b></p>
                <p className="muted small mt-1">
                  Sans code valide et sans accès à votre téléphone, seul un administrateur
                  pourra rétablir votre accès. Régénérez-en un jeu complet dès maintenant.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h2>À propos des méthodes</h2></div>
          <div className="card-body flex col" style={{ gap: 14 }}>
            <Method icon="shieldCheck" available title="Application d’authentification"
                    text="Google Authenticator, Microsoft Authenticator, Authy, 1Password, Bitwarden… Le code change toutes les 30 secondes et se calcule hors ligne : aucun SMS, aucun réseau requis." />
            <Method icon="key" available title="Codes de récupération"
                    text="Dix codes à usage unique, à conserver hors de l’ordinateur (coffre-fort de mots de passe ou impression rangée). C’est votre seule porte de sortie si vous perdez votre téléphone." />
            <Method icon="user" available={false} title="Clé d’accès (passkey, biométrie)"
                    text="Indisponible tant que l’application est servie en HTTP : le navigateur n’autorise les clés d’accès que sur une connexion sécurisée. Placer un certificat TLS devant l’application débloquerait cette méthode." />
          </div>
        </div>
      </div>

      <MfaDialogs action={action} onClose={() => setAction(null)}
                  onDone={() => { void refresh(); }} />
    </>
  );
}

function Method({ icon, title, text, available }: {
  icon: IconName; title: string; text: string; available: boolean;
}) {
  return (
    <div className="flex" style={{ alignItems: 'flex-start', gap: 11, opacity: available ? 1 : .62 }}>
      <span className="stat-ico" style={{ position: 'static', flex: 'none' }}>
        <Icon name={icon} />
      </span>
      <div>
        <div className="row-title" style={{ fontSize: '.88rem' }}>
          {title}
          {!available && (
            <span className="badge outline" style={{ marginLeft: 6 }}>Indisponible</span>
          )}
        </div>
        <p className="muted" style={{ fontSize: '.79rem', marginTop: 2 }}>{text}</p>
      </div>
    </div>
  );
}

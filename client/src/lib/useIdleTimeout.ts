import { useCallback, useEffect, useRef, useState } from 'react';

/** Sans un geste pendant ce délai, on cesse de considérer que quelqu'un
 *  regarde l'écran. Assez long pour couvrir la lecture d'une page, assez
 *  court pour que le compteur du serveur ait le temps d'arriver à échéance. */
const IDLE_AFTER_MS = 60_000;

/**
 * Déconnexion après une période sans activité.
 *
 * Le serveur reste seul juge : il ferme la session dès qu'aucune requête
 * authentifiée ne lui parvient pendant le délai configuré. Ce hook ne fait
 * qu'accompagner cette décision côté écran — prévenir avant l'échéance, puis
 * déconnecter proprement plutôt que de laisser la personne découvrir la
 * coupure en cliquant sur un bouton qui répond 401.
 *
 * L'activité se mesure sur des gestes réels — souris, clavier, tactile,
 * défilement — et non sur le trafic réseau. C'est la distinction qui fait
 * fonctionner l'ensemble : l'application sonde `/api/presence` toutes les
 * 30 secondes tant qu'un onglet est ouvert, et chacun de ces appels repousse
 * l'échéance côté serveur. Sans un signal d'activité venant de la personne
 * elle-même, un poste laissé allumé resterait connecté indéfiniment.
 *
 * Une exception, et elle compte : **une fois l'avertissement affiché, les
 * gestes cessent de repousser l'échéance**. Seuls ses deux boutons tranchent.
 * Sans cette règle, la souris qui passe au-dessus de la boîte la fait
 * disparaître avant qu'on ait pu lire la question — et frôler un écran n'est
 * pas la même chose que décider d'y rester.
 *
 * @param timeoutMinutes  Délai d'inactivité, tel que le serveur l'annonce.
 *                        Zéro ou moins désactive le mécanisme.
 * @param warnSeconds     Combien de temps avant l'échéance prévenir.
 * @param onExpire        Appelé à l'échéance. Doit fermer la session.
 */
export function useIdleTimeout({
  timeoutMinutes,
  enabled,
  warnSeconds = 120,
  onExpire,
}: {
  timeoutMinutes: number;
  enabled: boolean;
  warnSeconds?: number;
  onExpire: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [idle, setIdle] = useState(false);

  const lastActivity = useRef(Date.now());

  // Lu par l'écouteur de gestes, qui est abonné une fois pour toutes : une ref
  // lui donne la valeur courante sans le forcer à se réabonner à chaque
  // seconde du compte à rebours.
  const warningShown = useRef(false);
  // L'échéance est relue à chaque tick sans redémarrer l'intervalle : passer
  // onExpire en dépendance d'effet le recréerait à chaque rendu du parent.
  const expire = useRef(onExpire);
  expire.current = onExpire;

  const active = enabled && timeoutMinutes > 0;

  /** Repousse l'échéance. C'est la seule façon de refermer l'avertissement :
   *  le bouton « Rester connecté » passe par ici. */
  const markActive = useCallback(() => {
    lastActivity.current = Date.now();
    warningShown.current = false;
    setSecondsLeft(null);
    setIdle(false);
  }, []);

  // --- Gestes de la personne devant l'écran ---
  useEffect(() => {
    if (!active) return;

    // `pointermove` couvre souris, stylet et tactile d'un seul écouteur.
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

    const onActivity = () => {
      // Une fois l'avertissement affiché, les gestes ne le referment plus :
      // seuls ses deux boutons tranchent. Sinon la souris qui passe au-dessus
      // suffirait à le faire disparaître avant qu'on ait pu répondre — et
      // frôler un écran n'est pas dire « je reste ».
      if (warningShown.current) return;

      lastActivity.current = Date.now();
      // setIdle sur chaque mouvement de souris provoquerait un rendu par
      // événement ; on ne repasse à « actif » que si on en venait.
      setIdle(current => (current ? false : current));
    };

    for (const name of events) {
      window.addEventListener(name, onActivity, { passive: true });
    }
    return () => {
      for (const name of events) window.removeEventListener(name, onActivity);
    };
  }, [active]);

  // --- Horloge ---
  useEffect(() => {
    if (!active) {
      warningShown.current = false;
      setSecondsLeft(null);
      setIdle(false);
      return;
    }

    const limitMs = timeoutMinutes * 60_000;

    const tick = () => {
      const idleMs = Date.now() - lastActivity.current;
      const remainingMs = limitMs - idleMs;

      if (remainingMs <= 0) {
        warningShown.current = false;
        setSecondsLeft(null);
        expire.current();
        return;
      }

      // Au-delà d'une minute sans un geste, on considère que personne ne
      // regarde et on laisse le compteur du serveur courir — voir
      // `usePresence({ paused })`, sans quoi le sondage de présence
      // repousserait l'échéance à l'infini.
      setIdle(idleMs >= IDLE_AFTER_MS);

      // Un compte à rebours qui ne s'affiche pas n'a pas à provoquer de rendu :
      // on ne pose l'état que dans la fenêtre d'avertissement.
      const warning = remainingMs <= warnSeconds * 1000;
      warningShown.current = warning;
      setSecondsLeft(warning ? Math.ceil(remainingMs / 1000) : null);
    };

    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [active, timeoutMinutes, warnSeconds]);

  return { secondsLeft, idle, markActive };
}

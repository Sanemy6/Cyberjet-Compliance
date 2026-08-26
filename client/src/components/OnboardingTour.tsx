import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

interface TourStep {
  target: string;
  icon: IconName;
  title: string;
  text: string;
  /** Route à visiter avant de chercher la cible — seule l'étape sur le bouton
   *  du tableau de bord en a besoin, ce bouton n'existant que là. */
  to?: string;
  placement: 'right' | 'bottom' | 'left';
}

const STEPS: TourStep[] = [
  {
    target: 'nav', icon: 'home', placement: 'right',
    title: 'Vos dossiers, à portée de clic',
    text: 'Clients, questionnaires, base de connaissance et référentiels : '
        + 'tout ce que vous traitez au quotidien part d’ici.',
  },
  {
    target: 'upload', icon: 'upload', placement: 'bottom', to: '/',
    title: 'Traiter un questionnaire',
    text: 'Déposez le fichier reçu d’un client — Excel, Word ou PDF. Chaque '
        + 'question est confrontée à votre base de réponses automatiquement.',
  },
  {
    target: 'assistant', icon: 'wand', placement: 'right',
    title: 'Poser une question directement',
    text: 'Besoin d’une réponse sans passer par un fichier entier ? '
        + 'L’assistant interroge votre patrimoine de réponses en un instant.',
  },
  {
    target: 'search', icon: 'search', placement: 'right',
    title: 'Tout trouver sans quitter le clavier',
    text: 'Ctrl K depuis n’importe où : une page, un client par son nom, '
        + 'un réglage. La recherche connaît déjà vos dossiers.',
  },
  {
    target: 'account', icon: 'settings', placement: 'left',
    title: 'Votre compte',
    text: 'Thème, second facteur, sessions ouvertes : tout ce qui vous concerne '
        + 'vous-même se règle depuis ce menu, à tout moment.',
  },
];

const MARGIN = 14;
// Durée du fondu avant/après un déplacement — la carte et le halo se
// masquent, se repositionnent pendant qu'ils sont invisibles, puis
// réapparaissent. Sans ce temps mort, le contenu change de texte en plein
// glissement et donne une impression de saut plutôt que de mouvement.
const FADE_MS = 140;

/**
 * Visite guidée à la première connexion.
 *
 * Superposée à l'interface réelle plutôt qu'un slideshow séparé : la personne
 * voit tout de suite les vrais boutons qu'elle utilisera, pas une maquette qui
 * ne lui ressemblera plus une fois dans l'application. Chaque étape cible un
 * élément via `data-tour="…"` posé sur le composant concerné (Shell,
 * Dashboard) — jamais un sélecteur de texte ou de position, qui casserait au
 * premier changement de libellé.
 *
 * Transition entre étapes en trois temps (fondu → déplacement → fondu) plutôt
 * qu'un glissement continu : la carte peut passer de la barre latérale au
 * coin opposé de l'écran, et un contenu qui change de texte à mi-glissement
 * sur une aussi grande distance se lit comme un saut, pas un mouvement.
 */
export function OnboardingTour({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // 'leaving' : le contenu actuel s'estompe. 'entering' : le nouvel index est
  // posé mais on attend encore la position fraîchement mesurée avant de
  // redevenir visible — sans ce palier, la carte réapparaîtrait une frame à
  // l'ancienne position avant que la mesure ne rattrape le nouvel index.
  const [phase, setPhase] = useState<'idle' | 'leaving' | 'entering'>('idle');
  const step = STEPS[index];

  const locate = useCallback(() => {
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    setRect(el ? el.getBoundingClientRect() : null);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setPhase(current => (current === 'entering' ? 'idle' : current));
  }, [step.target]);

  // La cible d'une étape peut vivre sur une autre page (le bouton d'upload
  // n'existe que sur le tableau de bord) : on y navigue avant de la chercher,
  // et on laisse le routeur peindre la page suivante avant de mesurer.
  useLayoutEffect(() => {
    if (step.to) navigate(step.to);
    const frame = requestAnimationFrame(locate);
    return () => cancelAnimationFrame(frame);
  }, [step.to, step.target, navigate, locate]);

  useEffect(() => {
    window.addEventListener('resize', locate);
    window.addEventListener('scroll', locate, true);
    return () => {
      window.removeEventListener('resize', locate);
      window.removeEventListener('scroll', locate, true);
    };
  }, [locate]);

  /** Change d'étape en trois temps : on estompe (leaving), on pose le nouvel
   *  index et on attend sa position réelle (entering), puis on redevient
   *  visible (idle, posé par locate() une fois la mesure faite) — c'est ce
   *  décalage qui empêche le texte ou la position de sembler sauter d'un
   *  bout de l'écran à l'autre. */
  const goTo = useCallback((next: number) => {
    if (next < 0 || next >= STEPS.length || phase !== 'idle') return;
    setPhase('leaving');
    window.setTimeout(() => {
      setIndex(next);
      setPhase('entering');
    }, FADE_MS);
  }, [phase]);

  const last = index === STEPS.length - 1;
  const next = () => (last ? onDone() : goTo(index + 1));
  const prev = () => goTo(index - 1);

  // Masquée pendant tout le trajet, pas seulement la sortie : c'est ce qui
  // laisse le temps à la nouvelle position d'être mesurée avant que la carte
  // ne redevienne visible au bon endroit.
  const hidden = phase !== 'idle';

  return createPortal(
    <div className="tour-layer" role="dialog" aria-modal="true" aria-label="Visite guidée"
         onKeyDown={event => {
           if (event.key === 'Escape') onDone();
           if (event.key === 'ArrowRight' || event.key === 'Enter') next();
           if (event.key === 'ArrowLeft') prev();
         }}>
      {/* Quatre bandeaux plutôt qu'un fond uni percé d'un trou SVG : le
          halo autour de la cible reste net à n'importe quelle taille
          d'écran, sans calcul de masque. */}
      {rect && <TourMask rect={rect} fading={hidden} wide={step.target === 'nav'} />}
      {!rect && <div className="tour-scrim" />}

      {rect ? (
        <TourCard step={step} rect={rect} index={index} total={STEPS.length}
                  fading={hidden}
                  onNext={next} onPrev={prev} onSkip={onDone} />
      ) : (
        // La cible n'est pas montée (menu réduit sur mobile, par exemple) :
        // la carte se recentre plutôt que de s'accrocher à un point inconnu.
        <div className={`tour-card tour-card--centered${hidden ? ' tour-fade-out' : ''}`}>
          <TourCardBody step={step} index={index} total={STEPS.length}
                        onNext={next} onPrev={prev} onSkip={onDone} />
        </div>
      )}
    </div>,
    document.body);
}

function TourMask({ rect, fading, wide }: { rect: DOMRect; fading: boolean; wide: boolean }) {
  const pad = 8;
  const top = Math.max(rect.top - pad, 0);
  const left = Math.max(rect.left - pad, 0);
  const right = rect.right + pad;
  const bottom = rect.bottom + pad;
  const ringClass = `tour-ring${wide ? ' tour-ring--wide' : ''}${fading ? ' tour-fade-out' : ''}`;

  return (
    <>
      <div className="tour-scrim" style={{ top: 0, left: 0, right: 0, height: top }} />
      <div className="tour-scrim" style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <div className="tour-scrim" style={{ top, left: 0, width: left, height: bottom - top }} />
      <div className="tour-scrim" style={{ top, left: right, right: 0, height: bottom - top }} />
      <div className={ringClass} style={{ top: top - 3, left: left - 3,
                                           width: right - left + 6, height: bottom - top + 6 }} />
    </>
  );
}

function TourCard({ step, rect, index, total, fading, onNext, onPrev, onSkip }: {
  step: TourStep; rect: DOMRect; index: number; total: number; fading: boolean;
  onNext: () => void; onPrev: () => void; onSkip: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});
  // Position précédente de la carte, pour donner à l'arrivée un vrai sens de
  // trajet : elle glisse depuis la direction d'où elle vient plutôt que de
  // simplement s'éclaircir sur place, ce qui se lirait comme un flash plutôt
  // que comme un déplacement.
  const previous = useRef<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const { width: cw, height: ch } = card.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;

    let top: number, left: number;
    switch (step.placement) {
      case 'right':
        top = Math.min(Math.max(rect.top, MARGIN), vh - ch - MARGIN);
        left = Math.min(rect.right + MARGIN + 8, vw - cw - MARGIN);
        break;
      case 'left':
        top = Math.min(Math.max(rect.top, MARGIN), vh - ch - MARGIN);
        left = Math.max(rect.left - cw - MARGIN - 8, MARGIN);
        break;
      default: // bottom
        top = Math.min(rect.bottom + MARGIN + 8, vh - ch - MARGIN);
        left = Math.min(Math.max(rect.left, MARGIN), vw - cw - MARGIN);
    }

    const from = previous.current;
    // Le vecteur est borné : sur un très grand écart (barre latérale → coin
    // opposé), un glissement à l'échelle réelle serait aussi brusque que
    // l'ancien saut. Un tiers de la distance, plafonné, suffit à suggérer le
    // trajet sans le rejouer en entier.
    const dx = from ? Math.max(-56, Math.min(56, (from.left - left) / 3)) : 0;
    const dy = from ? Math.max(-56, Math.min(56, (from.top - top) / 3)) : 0;
    previous.current = { top, left };

    setStyle({ top, left, '--tour-dx': `${dx}px`, '--tour-dy': `${dy}px` } as React.CSSProperties);
  }, [rect, step.placement]);

  return (
    <div className={`tour-card tour-card--${step.placement}${fading ? ' tour-fade-out' : ''}`}
         ref={cardRef} style={style}>
      <TourCardBody step={step} index={index} total={total}
                    onNext={onNext} onPrev={onPrev} onSkip={onSkip} />
    </div>
  );
}

function TourCardBody({ step, index, total, onNext, onPrev, onSkip }: {
  step: TourStep; index: number; total: number;
  onNext: () => void; onPrev: () => void; onSkip: () => void;
}) {
  const last = index === total - 1;
  return (
    <>
      <div className="tour-head">
        <span className="tour-icon"><Icon name={step.icon} /></span>
        <button className="icon-btn sm" type="button" aria-label="Passer la visite" onClick={onSkip}>
          <Icon name="x" />
        </button>
      </div>
      <h3>{step.title}</h3>
      <p>{step.text}</p>
      <div className="tour-foot">
        <div className="tour-dots" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`tour-dot${i === index ? ' on' : ''}`} />
          ))}
        </div>
        <div className="tour-actions">
          {index > 0 && (
            <button className="btn ghost sm" type="button" onClick={onPrev}>Précédent</button>
          )}
          <button className="btn primary sm" type="button" onClick={onNext}>
            {last ? 'Terminer' : 'Suivant'}
          </button>
        </div>
      </div>
    </>
  );
}

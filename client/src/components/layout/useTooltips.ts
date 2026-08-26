import { useEffect } from 'react';
import { usePrefs } from '@/lib/prefs';

/**
 * Info-bulles de la coquille, posées sur `<body>` en position fixe.
 *
 * Un simple attribut `title` ne conviendrait pas : il apparaît après une seconde
 * d'attente, hors de tout style, et au mauvais endroit sur la barre latérale
 * réduite. Une délégation d'événement unique reste par ailleurs moins coûteuse
 * qu'un composant monté sur chaque icône.
 *
 * Règle de fond : dans la barre latérale déployée, l'étiquette est déjà lisible
 * à côté de l'icône — la répéter en bulle serait du bruit.
 */
export function useTooltips() {
  const { prefs } = usePrefs();
  const collapsed = prefs.sidebar === 'collapsed';

  useEffect(() => {
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    document.body.appendChild(tip);

    let timer = 0;
    const isDrawerMode = () => window.matchMedia('(max-width: 900px)').matches;

    const hide = () => {
      window.clearTimeout(timer);
      tip.classList.remove('show');
      tip.hidden = true;
    };

    const show = (target: HTMLElement) => {
      const text = target.dataset.tip;
      if (!text || isDrawerMode()) return;

      const sidebar = document.querySelector('.sidebar');
      const inSidebar = sidebar?.contains(target) ?? false;
      // Un élément sans étiquette dans aucun des deux états — le chevron de
      // réduction — s'exempte de la règle, sinon il ne s'expliquerait jamais.
      const always = target.hasAttribute('data-tip-always');
      if (inSidebar && !always && !collapsed) return;

      tip.textContent = text;
      tip.hidden = false;
      tip.classList.remove('below');

      const anchor = target.getBoundingClientRect();
      const box = tip.getBoundingClientRect();

      if (inSidebar) {
        // Dégagement suffisant pour que la pointe de la bulle ne chevauche pas
        // le bord de la barre latérale.
        tip.style.left = `${anchor.right + 16}px`;
        tip.style.top = `${anchor.top + anchor.height / 2 - box.height / 2}px`;
      } else {
        tip.classList.add('below');
        const left = anchor.left + anchor.width / 2 - box.width / 2;
        tip.style.left = `${Math.min(Math.max(8, left), window.innerWidth - box.width - 8)}px`;
        tip.style.top = `${anchor.bottom + 9}px`;
      }

      timer = window.setTimeout(() => tip.classList.add('show'), 60);
    };

    const onPointerOver = (event: Event) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-tip]');
      if (target) show(target); else hide();
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('focusin', onPointerOver);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    return () => {
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('focusin', onPointerOver);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('focusout', hide);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.clearTimeout(timer);
      tip.remove();
    };
  }, [collapsed]);
}

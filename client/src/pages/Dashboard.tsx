import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { keys, useDashboardLayout } from '@/api/queries';
import type { DashboardWidgetKey, DashboardWidgetSetting, DashboardWidgetSize, Stats } from '@/api/types';
import { Icon, type IconName } from '@/components/Icon';
import { BusyButton, EmptyState, ErrorState, Loader, fileLabel } from '@/components/Ui';
import { ClientForm } from '@/components/forms/ClientForm';
import { useToast } from '@/components/Toast';
import { PageMeta } from '@/components/layout/Shell';
import { useSession } from '@/lib/session';
import { fmtNum, fmtPct, fmtRelative, plural, truncate } from '@/lib/format';

/**
 * Tableau de bord — vue d'ensemble du patrimoine et des dossiers en cours.
 *
 * Choix de représentation, et ce qu'ils écartent :
 *   — Le taux de réponse automatique est UN ratio : chiffre directeur + jauge,
 *     pas un anneau. Un anneau pour deux parts n'est qu'un camembert à deux
 *     tranches, plus difficile à lire qu'une barre.
 *   — L'état des questions est un tout découpé en parts : barre composée
 *     horizontale, légende chiffrée. Aucune valeur n'est écrite dans un
 *     segment : elle y serait rognée.
 *   — La répartition par domaine est une magnitude : barres d'une seule teinte.
 *     La longueur porte déjà la valeur ; la recolorer serait redondant.
 *   — Aucune évolution n'est affichée : la base ne conserve pas d'historique
 *     daté des réponses, et inventer une flèche « +12 % » serait un mensonge.
 *
 * Chaque bloc ci-dessous — jauge de couverture, chiffres clés, listes — est un
 * widget indépendant, identifié par une clé stable (voir WIDGET_META). Un
 * administrateur bascule la page elle-même en mode édition (bouton
 * « Personnaliser ») et glisse les widgets directement sur la grille — pas de
 * panneau séparé : ce qu'on configure est ce qu'on regarde, avec les mêmes
 * proportions. Ce choix est commun à toute l'organisation, pas une préférence
 * de compte. La grille (12 colonnes, `dense`) place chaque widget d'après sa
 * taille déclarée, jamais de coordonnées à maintenir à la main — le
 * glisser-déposer ne fait que réordonner la liste des clés visibles, le
 * placement réel est le travail du moteur CSS Grid. Sans agencement
 * enregistré, tous les widgets s'affichent dans l'ordre déclaré dans
 * WIDGET_META — c'est le filet qui évite un tableau de bord vide au tout
 * premier démarrage.
 */
export function DashboardPage() {
  const { status } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DashboardWidgetKey[] | null>(null);
  const [sizes, setSizes] = useState<Partial<Record<DashboardWidgetKey, DashboardWidgetSize>>>({});
  const [dragKey, setDragKey] = useState<DashboardWidgetKey | null>(null);
  const [overKey, setOverKey] = useState<DashboardWidgetKey | 'library' | null>(null);
  // Position écran du widget saisi, en position fixed — indépendante de la
  // grille CSS. C'est ce qui donne l'effet « flotte par-dessus » demandé :
  // tant qu'on tient le widget, son rectangle suit la souris au pixel près,
  // peu importe combien de fois l'ordre des autres widgets change pendant ce
  // temps. Avec un simple transform posé sur la case de grille elle-même
  // (l'essai précédent), le widget saisi restait soumis à son propre
  // recalcul de grid-column/grid-row à chaque swap — il « sautait » avec le
  // reste au lieu de sembler flotter en continu au-dessus.
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const flipRectsRef = useRef<Map<string, DOMRect> | null>(null);

  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: keys.stats,
    queryFn: () => api.get<Stats>('/api/stats'),
  });
  const { data: layout } = useDashboardLayout();

  const firstName = (status?.fullName || status?.username || '').split(/[\s._-]+/)[0];
  const isAdmin = status?.isAdmin ?? false;

  // Filet de sécurité : tant que l'agencement n'a pas fini de charger, ou si
  // un widget venait à manquer de la réponse serveur, tout s'affiche plutôt
  // que de faire disparaître une section sans raison visible.
  const savedVisible: DashboardWidgetKey[] = layout?.length
    ? layout.filter(w => w.visible).map(w => w.key)
    : WIDGET_KEYS;

  // En édition, l'ordre affiché est le brouillon local — rien n'est envoyé au
  // serveur avant « Enregistrer » : les autres comptes ne doivent pas voir un
  // agencement à moitié construit pendant qu'on le compose. Les masqués sont
  // dérivés du catalogue complet, pas de la réponse serveur : c'est ce qui
  // garantit qu'un widget retiré de la grille apparaît toujours quelque
  // part — dans la grille, ou sinon dans la bibliothèque, jamais nulle part.
  const visibleOrder = editing && draft ? draft : savedVisible;
  const hiddenOrder = editing && draft
    ? WIDGET_KEYS.filter(k => !draft.includes(k))
    : [];

  // Même principe que ci-dessus, pour la taille : en dehors de l'édition,
  // c'est celle enregistrée en base (savedSizes) qui doit s'afficher, pas la
  // taille par défaut du catalogue — sans quoi la page « telle qu'elle sera
  // vue » et la page « telle qu'on la personnalise » ne montrent pas le même
  // agencement, ce qui s'est déjà produit par cet oubli.
  const savedSizes: Partial<Record<DashboardWidgetKey, DashboardWidgetSize>> = Object.fromEntries(
    (layout ?? []).filter(w => w.size).map(w => [w.key, w.size as DashboardWidgetSize]),
  );
  const effectiveSizes = editing ? sizes : savedSizes;

  const startEditing = () => {
    setDraft(savedVisible);
    setSizes(Object.fromEntries(
      (layout ?? []).filter(w => w.size).map(w => [w.key, w.size as DashboardWidgetSize]),
    ));
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraft(null);
    setSizes({});
  };

  const resize = (key: DashboardWidgetKey, size: DashboardWidgetSize) => {
    setSizes(current => ({ ...current, [key]: size }));
  };

  // Capture la position actuelle de chaque widget de la grille juste avant
  // de changer l'ordre — c'est le « First » du FLIP joué par le
  // useLayoutEffect ci-dessous : lui seul peut comparer un avant et un après
  // pour savoir de combien chaque widget doit glisser, CSS Grid ne
  // transitionne jamais nativement un changement de grid-column/row.
  const captureFlipRects = () => {
    if (!gridRef.current) return;
    const rects = new Map<string, DOMRect>();
    for (const el of gridRef.current.querySelectorAll<HTMLElement>('[data-widget-key]')) {
      rects.set(el.dataset.widgetKey!, el.getBoundingClientRect());
    }
    flipRectsRef.current = rects;
  };

  // Réordonne le brouillon immédiatement : la souris peut survoler une
  // nouvelle cible plusieurs fois par seconde pendant un glisser,
  // l'utilisateur doit sentir la décision être prise sans délai. C'est
  // l'animation qui rattrape ensuite le mouvement (voir useLayoutEffect
  // FLIP plus bas), jamais l'inverse — retarder le calcul de position pour
  // le lisser aurait réintroduit la latence qu'on cherche justement à ôter.
  const moveTo = (key: DashboardWidgetKey, target: DashboardWidgetKey | 'library') => {
    captureFlipRects();
    setDraft(current => {
      if (!current) return current;
      const without = current.filter(k => k !== key);
      if (target === 'library') return without;
      if (!without.includes(target)) return [...without, key]; // venait de la bibliothèque
      const at = without.indexOf(target);
      return [...without.slice(0, at), key, ...without.slice(at)];
    });
  };

  const addFromLibrary = (key: DashboardWidgetKey) => {
    captureFlipRects();
    setDraft(current => (current && !current.includes(key) ? [...current, key] : current));
  };

  // Le « Last, Invert, Play » du FLIP : après chaque réorganisation, chaque
  // widget non saisi (le saisi reste caché à sa place, invisible — voir
  // .dash-w.dragging — son vrai rendu flotte séparément et suit déjà la
  // souris, il n'a pas besoin de ce traitement) part instantanément de sa
  // position précédente — appliquée en transform, donc sans repeindre la
  // grille — puis une frame plus tard on retire ce décalage avec une
  // transition CSS active : le navigateur anime le retour, ce qui donne
  // l'impression que le widget glisse jusqu'à sa nouvelle place plutôt que
  // d'y sauter.
  useLayoutEffect(() => {
    const before = flipRectsRef.current;
    if (!before || !gridRef.current) return;
    flipRectsRef.current = null;

    const widgets = gridRef.current.querySelectorAll<HTMLElement>('[data-widget-key]');
    const toAnimate: HTMLElement[] = [];

    for (const el of widgets) {
      const key = el.dataset.widgetKey!;
      if (key === dragKey) continue; // suit déjà le pointeur, pas le FLIP
      const from = before.get(key);
      if (!from) continue; // widget qui vient d'apparaître (venait de la bibliothèque)
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (!dx && !dy) continue;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      toAnimate.push(el);
    }

    if (!toAnimate.length) return;
    requestAnimationFrame(() => {
      for (const el of toAnimate) {
        el.style.transition = 'transform .18s ease-out';
        el.style.transform = '';
        // Style inline retiré une fois l'animation jouée, pour que la règle
        // CSS de .dash-w (transition: transform var(--dur), ...) reprenne
        // la main plutôt que de laisser une valeur figée par-dessus elle.
        el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
      }
    });
  });

  // Trouve la cible sous le pointeur : un widget de la grille (data-widget-
  // key), ou la zone bibliothèque (data-drop-library) qui sert à la fois de
  // case de dépôt pour masquer et de conteneur des widgets non affichés.
  const dropTargetAt = (x: number, y: number): DashboardWidgetKey | 'library' | null => {
    const el = document.elementFromPoint(x, y)
      ?.closest<HTMLElement>('[data-widget-key], [data-drop-library]');
    if (!el) return null;
    if (el.dataset.dropLibrary !== undefined) return 'library';
    return (el.dataset.widgetKey as DashboardWidgetKey | undefined) ?? null;
  };

  // Glisser piloté au pointeur plutôt que le Drag & Drop HTML5 natif : le
  // natif impose son propre curseur système pendant tout le geste (un poing
  // fermé posé en CSS ne s'affiche jamais par-dessus), et sa capture d'image
  // fantôme ajoute un temps de réaction perceptible. Ici, le curseur reste
  // sous notre contrôle en continu et le repositionnement est un simple
  // setState — aussi réactif que la souris elle-même. `key` vient soit d'un
  // widget déjà sur la grille (fromLibrary: false), soit de la bibliothèque
  // des widgets masqués (fromLibrary: true) — même mécanique de suivi et de
  // détection de cible dans les deux cas, seul le geste de lâcher diffère.
  const beginDrag = (key: DashboardWidgetKey, fromLibrary: boolean) => (event: ReactPointerEvent) => {
    if (event.button !== 0) return; // clic gauche seulement
    event.preventDefault();
    setDragKey(key);

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    // Rectangle écran de départ : origine du survol flottant. Pour un widget
    // déjà dans la grille, c'est sa propre boîte (currentTarget). Pour un
    // item de bibliothèque, qui n'a pas la même taille qu'un widget de
    // grille, on prend quand même sa boîte réelle — il se redimensionnera
    // visuellement une fois relâché sur la grille, comme n'importe quel
    // widget qui change de taille.
    const startRect = event.currentTarget.getBoundingClientRect();
    const grabX = event.clientX - startRect.left;
    const grabY = event.clientY - startRect.top;
    setDragRect({ left: startRect.left, top: startRect.top, width: startRect.width, height: startRect.height });

    // Cible actuellement « engagée » (celle dont le swap est programmé ou
    // déjà joué) et minuteur associé. Sans ce délai, le widget saisi
    // basculait la grille dès l'instant où le curseur touchait un voisin —
    // on ne voyait jamais le survol par-dessus, seulement le résultat. En
    // laissant un court instant avant de jouer réellement moveTo, le widget
    // saisi a le temps de passer visuellement par-dessus (il flotte en
    // position fixed, voir le rendu de DashboardPage) avant que les autres
    // ne se poussent pour lui faire de la place — l'effet demandé. Annulé
    // si la souris quitte la cible avant l'échéance : un simple passage
    // rapide ne doit pas déclencher un swap, seul un temps d'arrêt réel sur
    // une case en décide un.
    let settleKey: DashboardWidgetKey | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const SETTLE_MS = 220;

    const onMove = (moveEvent: PointerEvent) => {
      setDragRect(current => current && { ...current, left: moveEvent.clientX - grabX, top: moveEvent.clientY - grabY });
      const target = dropTargetAt(moveEvent.clientX, moveEvent.clientY);
      setOverKey(target);

      const targetsWidget = target && target !== 'library' && target !== key;
      if (!targetsWidget) {
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
        settleKey = null;
        return;
      }
      if (target === settleKey) return; // déjà programmé pour cette cible
      if (settleTimer) clearTimeout(settleTimer);
      settleKey = target;
      settleTimer = setTimeout(() => {
        if (fromLibrary) addFromLibrary(key);
        moveTo(key, target);
        settleTimer = null;
      }, SETTLE_MS);
    };

    const onUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (settleTimer) clearTimeout(settleTimer);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const target = dropTargetAt(upEvent.clientX, upEvent.clientY);
      // Un swap programmé mais pas encore joué doit tout de même aboutir au
      // lâcher : l'utilisateur a bien visé cette case, le minuteur n'existe
      // que pour habiller le geste, pas pour l'ignorer si on lâche vite.
      if (target && target !== 'library' && target !== key) {
        if (fromLibrary) addFromLibrary(key);
        moveTo(key, target);
      } else if (target === 'library' && !fromLibrary) {
        moveTo(key, 'library');
      }
      setDragKey(null);
      setDragRect(null);
      setOverKey(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const widgets: DashboardWidgetSetting[] = [
        ...draft.map(key => ({ key, visible: true, size: sizes[key] ?? null })),
        ...WIDGET_KEYS.filter(k => !draft.includes(k)).map(key => ({ key, visible: false, size: sizes[key] ?? null })),
      ];
      await api.put('/api/settings/dashboard-layout', { widgets });
      await queryClient.invalidateQueries({ queryKey: keys.dashboardLayout });
      toast('Agencement enregistré', 'Visible par toute l’organisation dès maintenant.', 'ok');
      setEditing(false);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  const actions = (
    <>
      {isAdmin && !editing && (
        <button className="btn ghost" type="button" onClick={startEditing}
                title="Réorganiser les widgets affichés">
          <Icon name="layoutGrid" /><span className="nowrap">Personnaliser</span>
        </button>
      )}
      <Link className="btn" to="/assistant">
        <Icon name="search" /><span className="nowrap">Poser une question</span>
      </Link>
      <Link className="btn primary" to="/questionnaires" data-tour="upload">
        <Icon name="upload" /><span className="nowrap">Traiter un questionnaire</span>
      </Link>
    </>
  );

  if (error) {
    return (
      <>
        <PageMeta crumb={[{ label: 'Tableau de bord' }]} />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </>
    );
  }

  if (isLoading || !stats) {
    return <><PageMeta crumb={[{ label: 'Tableau de bord' }]} /><Loader /></>;
  }

  // Base entièrement vide : on montre la mise en route, pas des zéros alignés.
  if (!stats.clients && !stats.kbTotal) {
    return (
      <>
        <PageMeta crumb={[{ label: 'Tableau de bord' }]} />
        <Welcome firstName={firstName} onCreateClient={() => setCreating(true)} />
        {creating && (
          <ClientForm onClose={() => setCreating(false)}
                      onSaved={client => navigate(`/clients/${client.id}`)} />
        )}
      </>
    );
  }

  const today = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date());
  const hour = new Date().getHours();
  const hello = hour < 6 || hour >= 18 ? 'Bonsoir' : 'Bonjour';

  const dirty = editing && draft
    && (JSON.stringify(draft) !== JSON.stringify(savedVisible)
      || JSON.stringify(sizes) !== JSON.stringify(savedSizes));

  return (
    <>
      <PageMeta crumb={[{ label: 'Tableau de bord' }]} actions={actions} />

      <div className="page-head">
        <div>
          <p className="eyebrow"><Icon name="gauge" />{today}</p>
          <h1>{hello}{firstName && `, ${firstName}`}</h1>
          <p className="sub">
            Vue d’ensemble de votre patrimoine de réponses et des questionnaires en cours
            de traitement.
          </p>
        </div>
      </div>

      {editing && (
        <div className="dash-edit-bar">
          <Icon name="layoutGrid" />
          <p>
            Glissez un widget vers un autre emplacement, ou vers le haut de l’écran pour le
            masquer. Visible par toute l’organisation une fois enregistré.
          </p>
          <div className="actions">
            <button className="btn ghost sm" type="button" onClick={cancelEditing}>Annuler</button>
            <BusyButton className="btn primary sm" disabled={!dirty} onClick={save}>
              <Icon name="check" /> Enregistrer pour tout le monde
            </BusyButton>
          </div>
        </div>
      )}

      {/* Zone de suppression façon « glisser vers le haut » (Android en
          multitâche) : toute la largeur de l'écran devient la cible dès
          qu'un widget est saisi, plutôt qu'une petite case à viser
          précisément en plein geste — data-drop-library est posé sur la
          zone entière, pas sur la pilule visible, qui n'en est que la
          représentation. N'existe dans le DOM que pendant un drag actif.
          « Masquer » plutôt que « supprimer » : le widget reste dans le
          catalogue, réapparaît dans la bibliothèque plus bas, rien n'est
          perdu avant le clic sur « Enregistrer ». */}
      {editing && dragKey && (
        <div className="dash-trash-zone" data-drop-library>
          <div className={`dash-trash-pill${overKey === 'library' ? ' over' : ''}`}>
            <span className="dash-trash-icon"><Icon name="trash" /></span>
            <span>Relâchez pour masquer</span>
          </div>
        </div>
      )}

      <div className={`dash-grid${editing ? ' dash-edit' : ''}`} ref={gridRef}>
        {visibleOrder.map(key => (
          <DashboardWidget key={key} widgetKey={key} stats={stats} editing={editing}
                            size={effectiveSizes[key] ?? WIDGET_META[key].defaultSize}
                            dragging={dragKey === key} over={overKey === key}
                            onPointerDown={beginDrag(key, false)}
                            onRemove={() => moveTo(key, 'library')}
                            onResize={size => resize(key, size)} />
        ))}

        {/* Emplacement libre, en pointillés : la cible pour un widget qu'on
            fait venir de la bibliothèque sans viser un widget précis à
            échanger. Pleine largeur et hors du calcul dense (dash-w--full,
            pas dash-w--sm) : une case de taille normale entrerait dans le
            même recasage automatique que les widgets et déciderait à leur
            place où ils atterrissent, ce qui rendait le tableau de bord
            visiblement différent entre lecture et édition — précisément le
            bug signalé. En pleine largeur elle ne fait jamais concurrence à
            une case libre ailleurs dans la grille : dense la pousse
            mécaniquement en tout dernier, sans toucher au reste. */}
        {editing && (
          <div className={`dash-w dash-w--full dash-slot${overKey === 'library' ? ' over' : ''}`}
               data-drop-library>
            <span className="flex" style={{ gap: 6 }}>
              <Icon name="plus" /><span className="dim small">Déposer ici</span>
            </span>
          </div>
        )}
      </div>

      {editing && hiddenOrder.length > 0 && (
        <div className="dash-library" data-drop-library>
          <h3>Widgets masqués — glissez-les dans la grille pour les afficher</h3>
          <div className="dash-library-grid">
            {hiddenOrder.map(key => {
              const meta = WIDGET_META[key];
              return (
                <div key={key} className={`dash-library-item${dragKey === key ? ' dragging' : ''}`}
                     onPointerDown={beginDrag(key, true)}
                     onDoubleClick={() => addFromLibrary(key)}
                     title="Glisser vers la grille, ou double-cliquer pour l’ajouter en fin de page">
                  <Icon name={meta.icon} />{meta.label}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Le widget saisi, flottant : en position fixed, calé sur dragRect
          (écran, pas grille), donc jamais affecté par les recalculs de
          grid-column/grid-row des autres widgets pendant le geste — c'est ce
          qui le fait glisser en continu par-dessus le reste plutôt que de
          sembler sauter à chaque case traversée. Le widget resté dans la
          grille (ci-dessus) sert de placeholder muet à sa place normale, le
          temps du geste, pour ne pas rompre l'agencement dense. */}
      {dragKey && dragRect && (
        <div className="dash-w dash-w-float"
             style={{ left: dragRect.left, top: dragRect.top, width: dragRect.width, height: dragRect.height }}>
          <WidgetContent widgetKey={dragKey} stats={stats} />
        </div>
      )}

      {saving && <Loader />}
    </>
  );
}

/** Catalogue des widgets — icône, libellé et taille de grille (12 colonnes).
 *  Doit correspondre exactement au catalogue tenu côté serveur
 *  (AppSettingsService.DashboardWidgetKeys) : le serveur refuse un
 *  agencement qui n'y correspond pas trait pour trait. */
const WIDGET_META: Record<DashboardWidgetKey, {
  icon: IconName; label: string; defaultSize: DashboardWidgetSize; tall: boolean;
}> = {
  'coverage': { icon: 'gauge', label: 'Taux de réponse automatique', defaultSize: 'lg', tall: true },
  'kpi-clients': { icon: 'users', label: 'Clients actifs', defaultSize: 'sm', tall: false },
  'kpi-kb': { icon: 'book', label: 'Réponses en base', defaultSize: 'sm', tall: false },
  'kpi-questionnaires': { icon: 'fileText', label: 'Questionnaires ouverts', defaultSize: 'sm', tall: false },
  'kpi-frameworks': { icon: 'shieldCheck', label: 'Référentiels couverts', defaultSize: 'sm', tall: false },
  'next-step': { icon: 'wand', label: 'Prochaine étape', defaultSize: 'full', tall: false },
  'recent-questionnaires': { icon: 'clock', label: 'Questionnaires récents', defaultSize: 'lg', tall: true },
  'by-category': { icon: 'layoutGrid', label: 'Répartition par domaine', defaultSize: 'sm', tall: true },
  'top-kb': { icon: 'sparkle', label: 'Réponses les plus réutilisées', defaultSize: 'sm', tall: true },
};

/** Libellés du menu de taille, dans l'ordre où ils apparaissent. */
const SIZE_LABELS: Record<DashboardWidgetSize, string> = {
  sm: 'Petit', md: 'Moyen', lg: 'Large', full: 'Pleine largeur',
};
const SIZE_ORDER: DashboardWidgetSize[] = ['sm', 'md', 'lg', 'full'];

/** Catalogue complet, dans l'ordre par défaut — dérivé de WIDGET_META plutôt
 *  que redéclaré à part, pour qu'il ne puisse jamais diverger de lui. Sert de
 *  filet tant qu'aucun agencement n'a été enregistré, et de référence pour
 *  déterminer quels widgets sont masqués en mode édition. */
const WIDGET_KEYS = Object.keys(WIDGET_META) as DashboardWidgetKey[];

/** Colonnes occupées sur la grille à douze, par taille — sert à dimensionner
 *  le cadre de l'aperçu du menu de choix, pas seulement à documenter la
 *  valeur. */
const SIZE_SPAN: Record<DashboardWidgetSize, number> = { sm: 4, md: 6, lg: 8, full: 12 };

/** Aperçu du menu de taille : le vrai contenu du widget, réduit à l'échelle
 *  dans un cadre dont la largeur reflète la proportion choisie — pas une
 *  reconstruction abstraite (barres, icônes) qui pourrait diverger du rendu
 *  réel, mais WidgetContent lui-même, rétréci par transform. */
function SizePreview({ widgetKey, stats, size }: {
  widgetKey: DashboardWidgetKey; stats: Stats; size: DashboardWidgetSize;
}) {
  const scale = SIZE_SPAN[size] / 12;
  return (
    <span className="dash-size-preview" aria-hidden="true" style={{ width: `${scale * 100}%` }}>
      <span className="dash-size-preview-frame">
        <WidgetContent widgetKey={widgetKey} stats={stats} />
      </span>
    </span>
  );
}

/** Enveloppe de grille commune à tout widget affiché : taille, poignée de
 *  glisser-déposer et bouton de retrait en mode édition. Le contenu réel
 *  vient de WIDGET_CONTENT, séparé de cette mécanique de placement. */
function DashboardWidget({ widgetKey, stats, editing, size, dragging, over,
  onPointerDown, onRemove, onResize }: {
  widgetKey: DashboardWidgetKey; stats: Stats; editing: boolean; size: DashboardWidgetSize;
  dragging: boolean; over: boolean;
  onPointerDown: (event: ReactPointerEvent) => void;
  onRemove: () => void; onResize: (size: DashboardWidgetSize) => void;
}) {
  const meta = WIDGET_META[widgetKey];
  const [sizeMenu, setSizeMenu] = useState(false);
  // Le survol s'annonce par un contour, jamais par une couche superposée :
  // un calque au-dessus du contenu masquerait justement ce qu'on est en
  // train de regarder pour décider où déposer. Le widget saisi (dragging)
  // reste ici comme simple emplacement réservé dans la grille — son vrai
  // rendu flotte séparément en position fixed (voir DashboardPage), donc pas
  // de contenu affiché deux fois à l'écran pendant le geste.
  const className = `dash-w dash-w--${size}${meta.tall ? ' dash-w--tall' : ''}`
    + `${dragging ? ' dragging' : ''}${over ? ' drop-target' : ''}${sizeMenu ? ' dash-w--menu-open' : ''}`;

  return (
    <div className={className}
         data-widget-key={editing ? widgetKey : undefined}
         onPointerDown={editing ? onPointerDown : undefined}>
      {editing && (
        <div className="dash-w-controls" onPointerDown={event => event.stopPropagation()}>
          <div className="dash-w-size">
            <button className="icon-btn" type="button" aria-label={`Choisir la taille de « ${meta.label} »`}
                    aria-expanded={sizeMenu} title="Taille"
                    onClick={() => setSizeMenu(open => !open)}>
              <Icon name="layoutGrid" />
            </button>
            {sizeMenu && (
              <div className="dash-w-size-menu" onMouseLeave={() => setSizeMenu(false)}>
                {SIZE_ORDER.map(option => (
                  <button key={option} type="button"
                          className={option === size ? 'active' : ''}
                          onClick={() => { onResize(option); setSizeMenu(false); }}>
                    <SizePreview widgetKey={widgetKey} stats={stats} size={option} />
                    <span className="dash-size-preview-label">{SIZE_LABELS[option]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="icon-btn" type="button" aria-label={`Masquer « ${meta.label} »`}
                  onClick={onRemove} title="Masquer">
            <Icon name="x" />
          </button>
        </div>
      )}
      <WidgetContent widgetKey={widgetKey} stats={stats} />
    </div>
  );
}

/** Contenu réel de chaque widget — inchangé depuis l'agencement fixe
 *  d'origine, seulement extrait pour être adressable par clé. */
function WidgetContent({ widgetKey, stats }: { widgetKey: DashboardWidgetKey; stats: Stats }) {
  switch (widgetKey) {
    case 'coverage':
      return <CoveragePanel stats={stats} />;

    case 'kpi-clients':
      return <Stat label="Clients actifs" value={fmtNum(stats.clients)} icon="users"
                   hint={`${fmtNum(stats.configs)} ${plural(stats.configs, 'configuration')} ${plural(stats.configs, 'technique')}`} />;

    case 'kpi-kb':
      return <Stat label="Réponses en base" value={fmtNum(stats.kbTotal)} icon="book"
                   hint={`${fmtNum(stats.kbGeneric)} génériques · ${fmtNum(stats.kbValidated)} validées`} />;

    case 'kpi-questionnaires':
      return <Stat label="Questionnaires ouverts" value={fmtNum(stats.questionnairesOpen)} icon="fileText"
                   hint={`${fmtNum(stats.questionnairesTotal)} au total`} />;

    case 'kpi-frameworks':
      return <Stat label="Référentiels couverts" value={fmtNum(stats.frameworks)} icon="shieldCheck"
                   hint={`${fmtNum(stats.controls)} contrôles répertoriés`} />;

    case 'next-step':
      return <NextStep stats={stats} />;

    case 'recent-questionnaires':
      return (
        <div className="card" style={{ height: '100%' }}>
          <div className="card-head">
            <h2>Questionnaires récents</h2>
            <Link className="btn sm ghost" to="/questionnaires">
              Tout voir <Icon name="chevronRight" />
            </Link>
          </div>
          {stats.recentQuestionnaires.length ? (
            <div className="rows">
              {stats.recentQuestionnaires.map(row => {
                const progress = row.nQuestions ? row.nDone / row.nQuestions : 0;
                return (
                  <Link className="row-item" key={row.id} to={`/questionnaires/${row.id}`}
                        style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="row-main">
                      <div className="row-title">{row.name}</div>
                      <div className="row-sub flex wrap" style={{ gap: 7 }}>
                        <span>{row.clientName}</span>
                        <span className="dim">·</span>
                        <span className="badge outline">{fileLabel(row.fileType)}</span>
                        <span className="dim">·</span>
                        <span className="dim">{fmtRelative(row.updatedAt)}</span>
                      </div>
                      <div className="meter-row mt-1">
                        <div className={`progress ${progress >= 1 ? 'ok' : ''}`}>
                          <span style={{ width: `${Math.round(progress * 100)}%` }} />
                        </div>
                        <span className="meter-val">{row.nDone}/{row.nQuestions}</span>
                      </div>
                    </div>
                    <Icon name="chevronRight" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState icon="inbox" title="Aucun questionnaire"
                        text="Téléversez un questionnaire client pour lancer le traitement automatique."
                        action={<Link className="btn primary" to="/questionnaires">
                          Téléverser un questionnaire
                        </Link>} />
          )}
        </div>
      );

    case 'by-category':
      return (
        <div className="card" style={{ height: '100%' }}>
          <div className="card-head">
            <h2>Répartition par domaine</h2>
            <span className="badge outline">
              {fmtNum(stats.byCategory.length)} {plural(stats.byCategory.length, 'domaine')}
            </span>
          </div>
          <div className="card-body">
            {stats.byCategory.length
              ? <BarList items={stats.byCategory} />
              : <p className="dim small">La base de connaissance est vide.</p>}
          </div>
        </div>
      );

    case 'top-kb':
      return (
        <div className="card" style={{ height: '100%' }}>
          <div className="card-head"><h2>Réponses les plus réutilisées</h2></div>
          <div className="card-body">
            {stats.topKb.length ? (
              <div className="flex col" style={{ gap: 12 }}>
                {stats.topKb.map(entry => (
                  <div className="flex" key={entry.id} style={{ alignItems: 'flex-start', gap: 11 }}>
                    <span className="badge accent nowrap" title="Réutilisations validées">
                      {entry.usageCount}×
                    </span>
                    <div className="grow">
                      <div className="small">{truncate(entry.question, 88)}</div>
                      <div className="dim" style={{ fontSize: '.75rem' }}>{entry.category}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="dim small">
                Les compteurs se remplissent au fil des questionnaires validés.
              </p>
            )}
          </div>
        </div>
      );
  }
}

// --------------------------------------------------------------------------
// Bloc de tête : le ratio directeur, puis le tout en parts
// --------------------------------------------------------------------------

function CoveragePanel({ stats }: { stats: Stats }) {
  const validationRate = stats.questionsTotal
    ? stats.questionsValidated / stats.questionsTotal : 0;

  // La sévérité n'a de sens qu'une fois des questions traitées : sans donnée,
  // une piste rouge pleine largeur ferait passer « rien à mesurer » pour
  // « tout va mal ».
  const tone = !stats.questionsTotal ? ''
    : stats.coverage >= 0.7 ? 'ok'
    : stats.coverage >= 0.4 ? 'warn' : 'danger';

  return (
    <div className="hero-panel">
      <p className="label">Taux de réponse automatique</p>
      <div className="flex" style={{ alignItems: 'baseline', gap: 14, margin: '8px 0 16px', flexWrap: 'wrap' }}>
        <span className="hero-figure">{fmtPct(stats.coverage)}</span>
        <span className="muted small" style={{ maxWidth: '34ch' }}>
          {stats.questionsTotal
            ? `${fmtNum(stats.questionsAnswered)} ${plural(stats.questionsAnswered, 'question')} `
              + `sur ${fmtNum(stats.questionsTotal)} ont reçu une proposition issue de la base`
            : 'Aucune question traitée pour l’instant'}
        </span>
      </div>

      <div className={`progress lg ${tone}`} role="img"
           aria-label={`Couverture ${fmtPct(stats.coverage)}`}>
        <span style={{ width: `${Math.round(stats.coverage * 100)}%` }} />
      </div>

      {stats.questionsTotal ? (
        <>
          <div className="flex between mt-2 small muted" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span>
              {fmtNum(stats.questionsValidated)} {plural(stats.questionsValidated, 'réponse')}
              {' '}{plural(stats.questionsValidated, 'validée')} ({fmtPct(validationRate)})
            </span>
            <span>
              {fmtNum(stats.controls)} contrôles sur {fmtNum(stats.frameworks)} référentiels
            </span>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', margin: '18px 0 15px' }} />

          <p className="label">État des {fmtNum(stats.questionsTotal)} questions traitées</p>
          <StackBar stats={stats} />
        </>
      ) : (
        <div className="callout accent mt-3">
          <Icon name="upload" />
          <div>
            <p><b>Le taux se calculera au premier questionnaire traité.</b></p>
            <p className="muted small mt-1">
              Téléversez un fichier Excel, Word ou PDF : le moteur propose une réponse
              pour chaque question qu’il reconnaît dans votre base.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Barre composée : validées / proposées / sans réponse. Les parts nulles ne
 *  sont pas rendues — un segment de largeur zéro dessinerait quand même son
 *  minimum et laisserait croire à une part résiduelle. */
function StackBar({ stats }: { stats: Stats }) {
  const validated = stats.questionsValidated;
  const proposed = Math.max(0, stats.questionsAnswered - stats.questionsValidated);
  const pending = Math.max(0, stats.questionsTotal - stats.questionsAnswered);
  const total = validated + proposed + pending || 1;

  const parts = [
    { key: 'sv-validated', label: 'Validées', n: validated,
      hint: 'Relues et confirmées par une personne' },
    { key: 'sv-proposed', label: 'Proposées', n: proposed,
      hint: 'Réponse suggérée par le moteur, en attente de relecture' },
    { key: 'sv-empty', label: 'Sans proposition', n: pending,
      hint: 'Aucune correspondance trouvée dans la base' },
  ];

  return (
    <>
      <div className="stack-bar" role="img"
           aria-label={parts.filter(p => p.n > 0).map(p => `${p.label} : ${p.n}`).join(', ')}>
        {parts.filter(part => part.n > 0).map(part => (
          <span key={part.key} className={part.key}
                style={{ width: `${(part.n / total) * 100}%` }}
                title={`${part.label} : ${fmtNum(part.n)}`} />
        ))}
      </div>
      <div className="viz-legend mt-2">
        {parts.map(part => (
          <span className="vl-item" key={part.key} title={part.hint}>
            <span className={`vl-swatch ${part.key}`} />
            {part.label}
            <span className="vl-val">{fmtNum(part.n)}</span>
          </span>
        ))}
      </div>
    </>
  );
}

function Stat({ label, value, icon, hint }: {
  label: string; value: string; icon: IconName; hint: string;
}) {
  return (
    <div className="stat">
      <span className="stat-ico"><Icon name={icon} /></span>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      <span className="hint">{hint}</span>
    </div>
  );
}

/** Barres de magnitude : une seule teinte, la longueur porte la valeur. Au-delà
 *  de huit domaines, la queue est annoncée plutôt que coupée en silence. */
function BarList({ items }: { items: { category: string; n: number }[] }) {
  const max = Math.max(...items.map(item => item.n), 1);
  const shown = items.slice(0, 8);
  const rest = items.length - shown.length;

  return (
    <>
      <div className="bar-list">
        {shown.map(item => (
          <div className="bar-row" key={item.category}>
            <span className="bar-label" title={item.category}>{item.category}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.max(3, (item.n / max) * 100)}%` }} />
            </span>
            <span className="bar-value">{fmtNum(item.n)}</span>
          </div>
        ))}
      </div>
      {rest > 0 && (
        <p className="dim small mt-2">
          {fmtNum(rest)} {plural(rest, 'autre')} {plural(rest, 'domaine')}
          {' '}{plural(rest, 'non affiché', 'non affichés')} — <Link to="/kb">voir la base complète</Link>.
        </p>
      )}
    </>
  );
}

// --------------------------------------------------------------------------
// Prochaine étape — déduite de l'état réel, jamais affichée à vide
// --------------------------------------------------------------------------

function NextStep({ stats }: { stats: Stats }) {
  let step: { icon: IconName; title: string; text: string; to: string; cta: string } | null = null;

  if (!stats.kbTotal) {
    step = {
      icon: 'book',
      title: 'Alimentez la base de connaissance',
      text: 'Sans réponse de référence, le moteur n’a rien à proposer. Commencez par '
          + 'les questions qui reviennent dans tous les questionnaires.',
      to: '/kb', cta: 'Ajouter des réponses',
    };
  } else if (!stats.questionnairesTotal) {
    step = {
      icon: 'upload',
      title: 'Traitez un premier questionnaire',
      text: `Votre base compte ${fmtNum(stats.kbTotal)} réponses : elle est prête à être `
          + 'confrontée à un questionnaire client.',
      to: '/questionnaires', cta: 'Téléverser un questionnaire',
    };
  } else if (stats.questionnairesOpen) {
    const pending = Math.max(0, stats.questionsTotal - stats.questionsValidated);
    step = {
      icon: 'wand',
      title: `${fmtNum(stats.questionnairesOpen)} ${plural(stats.questionnairesOpen, 'questionnaire')} `
           + 'en cours de traitement',
      text: pending
        ? `${fmtNum(pending)} ${plural(pending, 'question')} ${pending > 1 ? 'attendent' : 'attend'} `
          + 'encore une validation.'
        : 'Toutes les questions ont été traitées : il reste à exporter les réponses.',
      to: '/questionnaires', cta: 'Reprendre le traitement',
    };
  }

  if (!step) return null;

  return (
    <div className="card hoverable mb-2">
      <div className="card-body flex" style={{ alignItems: 'center', gap: 15, flexWrap: 'wrap' }}>
        <span className="stat-ico" style={{ position: 'static', flex: 'none', width: 38, height: 38 }}>
          <Icon name={step.icon} />
        </span>
        <div className="grow" style={{ minWidth: 240 }}>
          <div className="row-title">{step.title}</div>
          <p className="muted small" style={{ marginTop: 2 }}>{step.text}</p>
        </div>
        <Link className="btn primary" to={step.to}>{step.cta}</Link>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Premier démarrage
// --------------------------------------------------------------------------

function Welcome({ firstName, onCreateClient }: {
  firstName: string;
  onCreateClient: () => void;
}) {
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow"><Icon name="sparkle" />Première mise en route</p>
          <h1>Bienvenue{firstName && `, ${firstName}`}</h1>
          <p className="sub">
            Cette application centralise vos réponses de conformité et les réutilise
            automatiquement pour répondre aux questionnaires sécurité de vos clients.
          </p>
        </div>
      </div>

      <div className="card mb-2">
        <div className="card-body">
          <h2 className="mb-2">Trois étapes pour démarrer</h2>
          <div className="grid cols-3">
            <Step n={1} icon="users" title="Créez un client"
                  text="Un dossier par compagnie ou organisme : périmètre, contexte, référentiels applicables." />
            <Step n={2} icon="book" title="Alimentez sa base"
                  text="Réponses de référence et configurations techniques (chiffrement, accès, sauvegardes…)." />
            <Step n={3} icon="wand" title="Téléversez un questionnaire"
                  text="Excel, Word ou PDF : le moteur propose une réponse pour chaque question reconnue." />
          </div>
        </div>
        <div className="card-foot" style={{ justifyContent: 'flex-start' }}>
          <button className="btn primary" onClick={onCreateClient}>
            <Icon name="plus" />Créer mon premier client
          </button>
          <Link className="btn" to="/frameworks">
            <Icon name="shieldCheck" />Parcourir les référentiels
          </Link>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-body flex" style={{ alignItems: 'flex-start', gap: 13 }}>
            <Icon name="lock" />
            <div>
              <h3>Le moteur tourne sans appel réseau</h3>
              <p className="muted small mt-1">
                Le rapprochement fonctionne entièrement hors ligne : normalisation bilingue,
                thésaurus cybersécurité, BM25 et similarité par trigrammes. Aucun service
                tiers, aucune clé d’API. Les données des clients sont cloisonnées : une
                réponse rattachée à un client n’est jamais proposée pour un autre.
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body flex" style={{ alignItems: 'flex-start', gap: 13 }}>
            <Icon name="command" />
            <div>
              <h3>Deux raccourcis à connaître</h3>
              <p className="muted small mt-1">
                <b>Ctrl + K</b> ouvre la recherche rapide : toutes les pages et les gestes
                courants au clavier. L’avatar en haut à droite regroupe votre fiche, la
                vérification en deux étapes et l’apparence de l’interface.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Step({ n, icon, title, text }: {
  n: number; icon: IconName; title: string; text: string;
}) {
  return (
    <div className="flex" style={{ alignItems: 'flex-start', gap: 12 }}>
      <span className="stat-ico" style={{ position: 'static', flex: 'none' }}>
        <Icon name={icon} />
      </span>
      <div>
        <div className="row-title">{n}. {title}</div>
        <p className="muted small mt-1">{text}</p>
      </div>
    </div>
  );
}

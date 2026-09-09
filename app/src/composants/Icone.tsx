/**
 * Icone.tsx — le SEUL jeu d'icônes de l'app (ADR-0051, v7) : SVG au trait, 24 × 24, tracés en
 * dur (aucune dépendance, aucun fichier à charger). Remplace les caractères typographiques et les
 * emoji dépareillés de la v6 (◐ ▦ ▤ 💬 ⚙). Une icône est décorative par défaut (`aria-hidden`) :
 * le libellé accessible vient du bouton ou du lien qui la porte.
 */

export type NomIcone =
  | 'aujourdhui' | 'agenda' | 'documents' | 'assistant' | 'reglages'
  | 'plus' | 'chevron' | 'retour' | 'fermer' | 'menu' | 'rafraichir'
  | 'fichier' | 'dossier' | 'mail' | 'alerte' | 'externe' | 'horloge'
  | 'recherche' | 'envoyer' | 'coche' | 'deplacer' | 'cadenas' | 'etincelle';

// Chaque tracé tient en une chaîne `d` : les cercles sont des arcs, les points des segments
// courts (voir « menu », qui reçoit un trait plus épais pour former des points ronds).
const TRACES: Record<NomIcone, string> = {
  aujourdhui: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z M8 12l3 3 5-6',
  agenda: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M3 10h18 M8 3v4 M16 3v4',
  documents: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  assistant: 'M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-4.5A8 8 0 1 1 21 12z',
  reglages: 'M12 9a3 3 0 1 1 0 6a3 3 0 1 1 0-6 M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  retour: 'M19 12H5M11 18l-6-6 6-6',
  fermer: 'M6 6l12 12M18 6 6 18',
  menu: 'M5 12h.01M12 12h.01M19 12h.01',
  rafraichir: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  fichier: 'M6 2h8l4 4v16H6z M14 2v4h4',
  dossier: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  mail: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M3 7l9 6 9-6',
  alerte: 'M12 3l10 18H2z M12 10v4M12 17v1',
  externe: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  horloge: 'M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18 M12 7v5l3 2',
  recherche: 'M11 4a7 7 0 1 1 0 14a7 7 0 1 1 0-14 M16.5 16.5 21 21',
  envoyer: 'M4 12l16-8-6 16-2-7z',
  coche: 'M4 12l5 5L20 7',
  deplacer: 'M5 9l-3 3 3 3M19 9l3 3-3 3M9 5l3-3 3 3M9 19l3 3 3-3M2 12h20M12 2v20',
  cadenas: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z M8 11V7a4 4 0 0 1 8 0v4',
  etincelle: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z',
};

export function Icone({ nom, className, titre }: { nom: NomIcone; className?: string; titre?: string }) {
  return (
    <svg
      className={'icone' + (className ? ` ${className}` : '')}
      viewBox="0 0 24 24"
      aria-hidden={titre ? undefined : true}
      role={titre ? 'img' : undefined}
      strokeWidth={nom === 'menu' ? 3.2 : undefined}
    >
      {titre && <title>{titre}</title>}
      <path d={TRACES[nom]} />
    </svg>
  );
}

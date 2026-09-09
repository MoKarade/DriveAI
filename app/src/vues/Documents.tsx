/**
 * Documents.tsx — section Documents v7 (C28-82 PR2) : UN écran, l'explorateur avec sa recherche
 * unique. Les sous-onglets « Drive / Recherche DriveAI » de la v3 (#21) et leurs filtres d'Index
 * ont disparu (décision Marc 2026-09-09 : « quelques boutons simples, moins de déchets ») ; la
 * question IA vit dans le champ de recherche (bouton « IA »). La « Réorg IA » est dans l'Assistant
 * (C28-30, ADR-0026).
 */

import { Explorateur } from './Explorateur';
import { Langue } from '../i18n';

export function Documents({ langue }: { langue: Langue }) {
  return <Explorateur langue={langue} />;
}

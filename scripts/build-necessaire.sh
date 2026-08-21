#!/usr/bin/env bash
# scripts/build-necessaire.sh — ce commit change-t-il ce que le site SERT ?
#
# ⚠️ CONVENTION VERCEL, ET ELLE EST CONTRE-INTUITIVE : sortir avec 0 IGNORE le build,
# sortir avec 1 le LANCE. Codée à l'envers, cette logique n'empêcherait pas un déploiement
# de trop — elle les empêcherait TOUS, en silence, et la production se figerait sur un
# commit ancien pendant qu'on croit livrer. C'est vérifié dans la documentation avant
# d'écrire ce fichier, pas supposé.
#
# POURQUOI IL EXISTE
# Le 2026-08-05, douze commits en deux heures ont produit douze déploiements de production,
# jusqu'à épuiser le quota du compte — et plusieurs ne touchaient QUE des `.md` et des
# tests, c'est-à-dire rien de ce que le site sert. Un quota est une ressource partagée
# entre les six projets de Marc : le gaspiller ici, c'est bloquer les autres.
#
# CE QU'IL NE FAIT JAMAIS : sauter un build par erreur. Toute incertitude — historique
# tronqué, commande qui échoue, diff illisible — se résout en LANÇANT le build. Un build de
# trop coûte une minute ; un build sauté à tort fige la production sans rien dire, et c'est
# exactement la panne qu'on ne diagnostique pas (« CI verte, site à jour » — sauf que non).

set -uo pipefail

# Deux arguments FACULTATIFS : la plage à examiner. Sans eux, `HEAD^..HEAD`, c'est-à-dire ce
# que Vercel fournit. Avec eux, on peut rejouer le script sur n'importe quel commit de
# l'historique SANS le sortir — ce qui est la seule façon honnête de le vérifier avant de
# l'activer. La première tentative de vérification, à coups de `git checkout`, a sali l'arbre
# de travail et failli faire committer des fichiers venus d'anciens commits.
BASE="${1:-}"
TETE="${2:-HEAD}"

lancer() { echo "build : $1"; exit 1; }
ignorer() { echo "build ignoré : $1"; exit 0; }

# Sans parent, on ne peut pas comparer. Le clone de Vercel est superficiel : ce cas est
# normal, pas une anomalie — et il se résout en construisant.
if [ -z "$BASE" ]; then
  git rev-parse --verify "${TETE}^" >/dev/null 2>&1 || lancer "pas d'historique pour comparer"
  BASE="${TETE}^"
fi

FICHIERS=$(git diff --name-only "$BASE" "$TETE") || lancer "diff illisible"
[ -n "$FICHIERS" ] || lancer "aucun fichier lisible dans le diff"

# Ce qui ne peut PAS changer ce que le site sert. Tout le reste construit — y compris ce
# qu'on n'a pas prévu, ce qui est le point : la liste des exemptions est FERMÉE, la liste
# de ce qui construit est ouverte.
while IFS= read -r f; do
  case "$f" in
    *.md) ;;
    docs/*) ;;
    # `test/` ET `tests/` : le parc écrit les deux (DriveAI au singulier, Hubperso et JobAI
    # au pluriel). Constaté en rejouant ce script sur les douze derniers commits de DriveAI —
    # sans le singulier, tout commit du moteur continuait de construire POUR SES TESTS, et la
    # propagation aurait été à moitié inutile sans que rien ne le signale.
    test/*) ;;
    tests/*) ;;
    .github/*) ;;
    # PROPRE À DRIVEAI : `src/*.gs` est le MOTEUR Apps Script. Il ne fait pas partie du build
    # Vercel — il part par `deploy.yml` (clasp), et rien dans `app/` ni `api/` ne l'importe :
    # le broker parle à la web app en HTTP, pas par le code. Un commit qui ne touche que le
    # moteur n'a donc rien à redéployer ici.
    #
    # ⚠️ Ça ne dispense PAS de vérifier le déploiement du moteur : `deploy.yml` reste ce qui
    # le met en ligne, et c'est LUI qu'on regarde après un merge de `.gs`.
    src/*.gs) ;;
    *) lancer "$f" ;;
  esac
done <<< "$FICHIERS"

ignorer "documentation et tests uniquement"

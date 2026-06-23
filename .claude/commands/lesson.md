---
description: Consigne une leçon dans docs/LESSONS.md (+ règle durable dans CLAUDE.md)
argument-hint: "<la leçon apprise>"
---

Consigne la leçon suivante : **$ARGUMENTS**

1. Ajoute une entrée datée (date du jour) à la fin de `docs/LESSONS.md`, au format :

   ```
   ## AAAA-MM-JJ — <titre court>
   **Contexte.** <ce qu'on faisait>
   **Leçon.** $ARGUMENTS
   **Règle durable ?** oui/non
   ```

2. Décide si c'est une **règle durable** (elle change la façon de coder à l'avenir :
   convention, piège de quota, format de prompt, garde-fou). Si **oui**, ajoute une puce
   concise à la section « 7. Leçons apprises (règles durables) » de `CLAUDE.md`.
   Si **non**, laisse-la seulement dans `LESSONS.md`.

3. Garde `CLAUDE.md` court : reformule la règle en une phrase actionnable, ne copie pas tout le
   contexte.

Si `$ARGUMENTS` est vide, propose toi-même 1 à 3 leçons tirées de la session courante et
demande lesquelles consigner.

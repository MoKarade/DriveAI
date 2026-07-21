'use strict';
/**
 * VERROU DE SURFACE — ADR-0012 (audit sécurité, exigence bloquante n°1).
 * Le scope `gmail.modify` PERMET la mise à la corbeille (purge définitive à 30 j = perte de fait)
 * et la destruction des ~60 libellés de Marc. Ce test est LE verrou : il interdit dans `src/`
 * tout motif de corbeille/Spam/suppression Gmail — il tourne dans la CI REQUISE qui gate `main`.
 * Écritures Gmail AUTORISÉES (les seules) : poser un libellé EXISTANT (`addToThread`) et
 * archiver (`moveToArchive`, réversible). Retirer un libellé de Marc est AUSSI interdit
 * (revue ronde 2) : le tri ne « détrique » jamais — seul Marc retire un libellé.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

// Scan RÉCURSIF (revue ronde 2) : un futur sous-dossier de src/ ne doit pas échapper au verrou.
function fichiersSource_(dossier) {
  const resultat = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) resultat.push(...fichiersSource_(chemin));
    else if (entree.name.endsWith('.gs') || entree.name.endsWith('.json')) resultat.push(chemin);
  }
  return resultat;
}

// Motifs INTERDITS (audit ADR-0012) : corbeille (toutes variantes GmailApp), Spam, destruction
// de libellés, retrait de libellés, suppression en masse, chemins REST Gmail dangereux, libellés
// système destructeurs. Revue flotte : le service avancé (`Gmail.Users.Threads.trash`, minuscule)
// et l'API REST Gmail contournaient les motifs initiaux → les DEUX canaux sont interdits EN BLOC
// (le moteur ne parle à Gmail que par GmailApp), et les motifs GmailApp sont insensibles à la casse.
const INTERDITS = [
  { motif: /ToTrash/i, raison: 'corbeille Gmail (toutes variantes moveTo/moveThreads…)' },
  { motif: /ToSpam/i, raison: 'marquage Spam (toutes variantes)' },
  { motif: /deleteLabel/i, raison: 'destruction d\'un libellé de Marc' },
  { motif: /createLabel/i, raison: 'création de libellé (le moteur PROPOSE, Marc crée)' },
  { motif: /removeFromThread|removeLabel/i, raison: 'retrait d\'un libellé de Marc (seul Marc retire)' },
  { motif: /batchDelete/i, raison: 'suppression en masse' },
  { motif: /Gmail\.Users/, raison: 'service avancé Gmail interdit en bloc (contournait les motifs GmailApp)' },
  { motif: /gmail\/v1|googleapis\.com\/gmail/i, raison: 'API REST Gmail interdite en bloc (aucun usage légitime)' },
  { motif: /addLabelIds[^\n]*['"](TRASH|SPAM)['"]/, raison: 'libellé système TRASH/SPAM' },
];

test('surface Gmail : les motifs interdits ATTRAPENT les contournements démontrés par la revue', () => {
  const malveillants = [
    "Gmail.Users.Threads.trash('me', fil.getId());",           // service avancé, minuscule
    "GmailApp.getMessageById(id).moveToTrash();",
    "fil.moveToSpam();",
    "UrlFetchApp.fetch('https://gmail.googleapis.com/gmail/v1/users/me/threads/X/trash');",
    "UrlFetchApp.fetch('https://www.googleapis.com/gmail/v1/users/me/messages/batchDelete');",
    "payload: JSON.stringify({ addLabelIds: ['TRASH'] })",
    "GmailApp.createLabel('X');",
    "GmailApp.getUserLabelByName('X').deleteLabel();",
    "libelle.removeFromThread(fil);",                          // retrait de libellé (ronde 2)
    "fil.removeLabel(libelle);",
  ];
  for (const ligne of malveillants) {
    assert.ok(INTERDITS.some(({ motif }) => motif.test(ligne)), 'motif non attrapé : ' + ligne);
  }
});

test('surface Gmail : AUCUN motif de corbeille/Spam/suppression/retrait de libellé dans src/ (récursif)', () => {
  const violations = [];
  for (const chemin of fichiersSource_(SRC)) {
    const contenu = fs.readFileSync(chemin, 'utf-8');
    const lignes = contenu.split('\n');
    for (let i = 0; i < lignes.length; i++) {
      for (const { motif, raison } of INTERDITS) {
        if (motif.test(lignes[i])) {
          violations.push(`${path.relative(SRC, chemin)}:${i + 1} (${raison}) → ${lignes[i].trim()}`);
        }
      }
    }
  }
  assert.deepStrictEqual(violations, [], 'écritures Gmail interdites détectées :\n' + violations.join('\n'));
});

test('surface Gmail : le manifeste ne demande JAMAIS plus que gmail.modify', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf-8'));
  const gmailScopes = manifest.oauthScopes.filter((s) => s.includes('gmail') || s.includes('mail.google'));
  for (const s of gmailScopes) {
    assert.ok(
      s.endsWith('gmail.readonly') || s.endsWith('gmail.modify'),
      `scope Gmail inattendu (plus large que modify ?) : ${s}`
    );
  }
});

test('surface Gmail : AUCUN service avancé dans le manifeste (Gmail.Users contournerait le verrou)', () => {
  // `dependencies.enabledAdvancedServices` donnerait accès à `Gmail.Users.*` (trash, delete,
  // labels.delete) par un canal que les motifs GmailApp ne voient pas. Le projet n'utilise AUCUN
  // service avancé (leçon : REST via UrlFetchApp pour Drive) — le manifeste doit rester sans
  // `dependencies` du tout.
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf-8'));
  assert.ok(!('dependencies' in manifest),
    'le manifeste déclare des services avancés — interdit (contournement du verrou de surface)');
});

test('tripwire constitution : le scope Gmail effectif et CLAUDE.md ne divergent JAMAIS', () => {
  // Le commit qui passe le scope à `gmail.modify` doit ÊTRE CELUI qui rend la constitution
  // effective (CLAUDE.md §2.3) : tant que l'annotation « PAS ENCORE EFFECTIVE » est présente,
  // le manifeste doit rester en lecture seule — et réciproquement, passer le scope sans mettre
  // à jour la constitution casse la CI. (Leçon : les documents vivants ne dérivent jamais.)
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf-8'));
  const claudeMd = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf-8');
  const scopeModify = manifest.oauthScopes.some((s) => s.endsWith('gmail.modify'));
  if (scopeModify) {
    assert.ok(!claudeMd.includes('PAS ENCORE EFFECTIVE'),
      'scope gmail.modify actif mais CLAUDE.md dit encore « PAS ENCORE EFFECTIVE » — mettre la constitution à jour dans le MÊME commit');
    assert.ok(claudeMd.includes('gmail.modify'),
      'scope gmail.modify actif mais CLAUDE.md ne le documente pas');
  } else {
    assert.ok(claudeMd.includes('lecture seule'),
      'scope gmail.readonly actif mais CLAUDE.md ne documente plus la lecture seule');
  }
});

/* ---------- Surface DRIVE sans suppression (ADR-0014 : le moteur reste ABSOLU) ---------- */

test('surface Drive : AUCUNE suppression/corbeille dans le moteur (l\'exception ADR-0014 vit dans l\'APP seule)', () => {
  // L'ADR-0014 ouvre une exception ÉTROITE côté app (corbeille d'un dossier vide validé).
  // Le moteur, lui, garde une surface .gs SANS AUCUN chemin de suppression — c'est la moitié
  // « moteur inchangé » de la promesse de CLAUDE.md §2.2, rendue testable ici.
  const MOTIFS_DRIVE_INTERDITS = [
    [/setTrashed/, 'mise à la corbeille DriveApp'],
    [/emptyTrash/, 'vidage de corbeille'],
    [/files\.delete|Files\.remove/, 'suppression définitive Drive'],
    [/\/trash\b/, 'endpoint corbeille REST'],
    [/method\s*:\s*['"`]delete['"`]/i, 'DELETE REST (Drive/Sheets)'],
    [/trashed['"`]?\s*:\s*true/, 'corbeille par PATCH REST'],
    // Revue sécurité C28-26 : le seul type de mutation Drive DANGEREUSE que les tripwires ne
    // voyaient pas — la FUITE par partage. Aucun usage légitime dans le moteur, jamais.
    [/setSharing\(/, 'modification du partage DriveApp'],
    [/addEditor\(|addViewer\(/, 'ajout d\'un éditeur/lecteur (fuite par partage)'],
  ];
  // UNIQUE exception préexistante, whitelistée NOMMÉMENT : Ocr.gs supprime SON fichier
  // TEMPORAIRE de conversion (artefact créé par le moteur la seconde d'avant, jamais un
  // fichier de Marc). Bornée à UNE occurrence — une deuxième casserait ce test.
  const violations = [];
  let deleteOcr = 0;
  for (const chemin of fichiersSource_(SRC)) {
    const nomFichier = path.relative(SRC, chemin);
    const lignes = fs.readFileSync(chemin, 'utf-8').split('\n');
    lignes.forEach((ligne, i) => {
      for (const [motif, raison] of MOTIFS_DRIVE_INTERDITS) {
        if (!motif.test(ligne)) continue;
        if (nomFichier === 'Ocr.gs' && raison === 'DELETE REST (Drive/Sheets)') {
          deleteOcr++;
          continue;
        }
        violations.push(`${nomFichier}:${i + 1} (${raison}) → ${ligne.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(violations, [],
    `suppression Drive dans le MOTEUR (interdit — ADR-0014 n'autorise que l'app) :\n${violations.join('\n')}`);
  assert.ok(deleteOcr <= 1,
    `Ocr.gs porte ${deleteOcr} DELETE — seul le nettoyage du fichier temporaire d'OCR est admis (1 max)`);
});

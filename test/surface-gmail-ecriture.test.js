'use strict';
/**
 * VERROU DE SURFACE — ADR-0012 (audit sécurité, exigence bloquante n°1).
 * Le scope `gmail.modify` PERMET la mise à la corbeille (purge définitive à 30 j = perte de fait)
 * et la destruction des ~60 libellés de Marc. Ce test est LE verrou : il interdit dans `src/`
 * tout motif de corbeille/Spam/suppression Gmail — il tourne dans la CI REQUISE qui gate `main`.
 * Écritures Gmail AUTORISÉES (les seules) : poser un libellé EXISTANT (`addToThread`) et
 * archiver (`moveToArchive`, réversible).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const FICHIERS = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs') || f.endsWith('.json'));

// Motifs INTERDITS (audit ADR-0012) : corbeille (toutes variantes GmailApp), Spam, destruction
// de libellés, suppression en masse, chemins REST Gmail dangereux, libellés système destructeurs.
// Revue flotte : le service avancé (`Gmail.Users.Threads.trash`, minuscule) et l'API REST Gmail
// contournaient les motifs initiaux → les DEUX canaux sont interdits EN BLOC (le moteur ne parle
// à Gmail que par GmailApp), et les motifs GmailApp sont insensibles à la casse.
const INTERDITS = [
  { motif: /ToTrash/i, raison: 'corbeille Gmail (toutes variantes moveTo/moveThreads…)' },
  { motif: /ToSpam/i, raison: 'marquage Spam (toutes variantes)' },
  { motif: /deleteLabel/i, raison: 'destruction d\'un libellé de Marc' },
  { motif: /createLabel/i, raison: 'création de libellé (le moteur PROPOSE, Marc crée)' },
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
  ];
  for (const ligne of malveillants) {
    assert.ok(INTERDITS.some(({ motif }) => motif.test(ligne)), 'motif non attrapé : ' + ligne);
  }
});

test('surface Gmail : AUCUN motif de corbeille/Spam/suppression/création de libellé dans src/', () => {
  const violations = [];
  for (const f of FICHIERS) {
    const contenu = fs.readFileSync(path.join(SRC, f), 'utf-8');
    const lignes = contenu.split('\n');
    for (let i = 0; i < lignes.length; i++) {
      for (const { motif, raison } of INTERDITS) {
        if (motif.test(lignes[i])) violations.push(`${f}:${i + 1} (${raison}) → ${lignes[i].trim()}`);
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

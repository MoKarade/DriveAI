'use strict';
/**
 * TRIPWIRE ADR-0033 — le flux vivant DÉLÈGUE son sous-chemin à la MÊME fonction pure que le Reset
 * (`cheminCibleReset_`), sur le nom FINAL. Ce test verrouille la convergence : pour tout document que
 * le Reset sait router (non-null), la sortie du flux (`planRoutageV2_`) est IDENTIQUE au chemin
 * thématique du Reset. Si quelqu'un modifie un côté sans l'autre (retire la délégation, change une
 * table), ce test casse — c'est la fin structurelle du « déplacer en boucle » flux↔reset.
 *
 * La convergence flux↔CONSOLIDATION est verrouillée séparément dans `consolidation.test.js` (les 3
 * consommateurs — flux, conso, reset — passent par la même règle).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs', 'Router.gs']);
const meta = (nom) => ({ nomFichier: nom, taille: 100000, extraitOcr: 'texte lisible du document '.repeat(4), emetteur: '' });

// Échantillon stratifié par domaine — des documents que le Reset route dans son arbre thématique.
const CAS = [
  { classif: { domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins' }, date: '2026-03-15', ext: '.pdf' },
  { classif: { domaine: '02 · Finances', type_doc: 'Facture', emetteur: 'Cleverbridge' }, date: '2026-01-10', ext: '.pdf' },
  { classif: { domaine: '05 · Carrière', type_doc: 'Paie', emetteur: 'Robovic' }, date: '2026-06-01', ext: '.pdf' },
  { classif: { domaine: '05 · Carrière', type_doc: 'Lettre de motivation', emetteur: 'Airbus' }, date: '2026-06-30', ext: '.docx' },
  { classif: { domaine: '01 · Administratif & identité', type_doc: 'Attestation', emetteur: 'CNAM' }, date: '2022-03-04', ext: '.pdf' },
  { classif: { estDocumentIdentite: true, sousDossierType: 'Permis de conduire', titulaire: 'Marc Richard' }, date: '2023-02-01', ext: '.pdf' },
];

test('TRIPWIRE flux vivant ↔ Reset (ADR-0033) : sous-chemin IDENTIQUE pour tout doc que le Reset route', () => {
  let couverts = 0;
  for (const cas of CAS) {
    const classif = Object.assign({ date_doc: cas.date }, cas.classif);
    const plan = ctx.planRoutageV2_(classif, meta('f' + cas.ext), cas.date, cas.ext, {});
    assert.strictEqual(plan.type, 'classé', JSON.stringify(plan));
    const rel = ctx.cheminCibleReset_(plan.domaine, plan.nom);
    if (rel) {
      couverts++;
      assert.strictEqual(plan.sousDossier, rel,
        'divergence flux↔reset pour ' + plan.nom + ' : flux="' + plan.sousDossier + '" vs reset="' + rel + '"');
      assert.strictEqual(plan.dossierIdCible, '', 'chemin thématique → jamais un ID d\'entité (le chemin EST la structure)');
    }
  }
  assert.ok(couverts >= 4, 'au moins 4 cas doivent réellement passer par le Reset (sinon le tripwire ne prouve rien) — couverts=' + couverts);
});

test('REPLI (jamais de limbo) : un doc que le Reset NE route PAS retombe sur le classement historique', () => {
  // Un devoir 06 sans motif Reset → le Reset rend null, mais le flux CLASSE quand même (repli à plat).
  const plan = ctx.planRoutageV2_(
    { domaine: '06 · Études & diplômes', type_doc: 'Devoir', descripteur: 'TP Python', date_doc: '2026-06-30' },
    meta('TP.docx'), '2026-06-30', '.docx', {});
  assert.strictEqual(ctx.cheminCibleReset_('06 · Études & diplômes', plan.nom), null, 'le Reset ne route pas ce doc');
  assert.strictEqual(plan.type, 'classé', 'le flux le classe quand même (repli) — jamais laissé sans dossier');
  assert.ok(!/inconnu/i.test(plan.nom), 'et jamais « Inconnu » dans le nom : ' + plan.nom);
});

/* ---------- Forward des années (ADR-0033, revue structure-keeper) : le flux AVANCE dans le temps ---------- */

test('resetBucketAnnee_ : une année POSTÉRIEURE aux buckets figés rend son propre segment (jamais Archives)', () => {
  const noeud = { '2026': {}, '2025': {}, '2024': {}, '2023': {}, '2022': {}, '2021': {}, Archives: {} };
  assert.strictEqual(ctx.resetBucketAnnee_('2026', noeud), '2026', 'année listée → elle-même');
  assert.strictEqual(ctx.resetBucketAnnee_('2027', noeud), '2027', 'FORWARD : 2027+ crée son dossier (pas Archives)');
  assert.strictEqual(ctx.resetBucketAnnee_('2031', noeud), '2031');
  assert.strictEqual(ctx.resetBucketAnnee_('2018', noeud), 'Archives', 'PASSÉ hors fenêtre → Archives (borné)');
  assert.strictEqual(ctx.resetBucketAnnee_('', noeud), 'Archives', 'année absente → Archives');
});

test('bout-en-bout : un relevé 2027 (flux vivant délégué) va dans Relevés/2027, plus jamais Archives (anti-régression 2027)', () => {
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '2027-06_Relevé_Desjardins.pdf'), 'Relevés/2027');
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '2027-01-10_Facture_Cleverbridge.pdf'), 'Reçus & factures/2027');
});

/* ---------- Invariance d'assainissement (revue code-reviewer) : flux(segment brut) == conso(champ_) ---------- */

function cheminsPossiblesReset_(structure) {
  const out = [];
  const walk = (noeud, prefix) => {
    const enfants = Object.keys(noeud || {});
    if (!enfants.length) { if (prefix) out.push(prefix); return; }
    for (const e of enfants) walk(noeud[e], prefix ? prefix + '/' + e : e);
  };
  for (const dom of Object.keys(structure || {})) {
    for (const e of Object.keys(structure[dom] || {})) walk(structure[dom][e], e);
  }
  return out;
}

test('INVARIANCE : toute sortie de STRUCTURE_CIBLE_RESET est invariante par champ_ et sans segment vide', () => {
  // Le flux/reset gardent les segments BRUTS ; la conso applique champ_ (ConsolidationExec.gs:163).
  // Aujourd'hui tous les chemins de la table sont invariants — ce test le VERROUILLE : le jour où
  // quelqu'un ajoute un dossier contenant un caractère interdit (_ / \ : * ? etc.), la conso le
  // renommerait alors que flux+Reset garderaient le brut → « Déplacer » en boucle silencieux.
  const chemins = cheminsPossiblesReset_(ctx.STRUCTURE_CIBLE_RESET);
  assert.ok(chemins.length >= 40, 'la table doit produire de nombreux chemins : ' + chemins.length);
  for (const ch of chemins) {
    for (const seg of ch.split('/')) {
      assert.ok(seg.length > 0, 'segment vide dans : ' + ch);
      assert.strictEqual(ctx.champ_(seg), seg, 'segment non invariant par champ_ (flux brut ≠ conso assainie) : « ' + seg + ' » dans ' + ch);
    }
  }
});

/* ---------- Couverture REPLI du tripwire flux↔conso (revue code-reviewer) ---------- */

test('REPLI flux↔conso : un doc que le Reset NE route pas converge encore (branche historique)', () => {
  // Le tripwire consolidation ne couvre plus que la branche DÉLÉGUÉE (ses 4 cas y passent). Ici on
  // exerce la branche REPLI (Reset null) : flux et conso doivent rendre le MÊME sous-chemin.
  const validees = {};
  const classif = { domaine: '06 · Études & diplômes', type_doc: 'Devoir', descripteur: 'TP Python', date_doc: '2026-06-30' };
  const plan = ctx.planRoutageV2_(classif, meta('2026-06-30_Devoir_TP Python.docx'), '2026-06-30', '.docx', validees);
  assert.strictEqual(ctx.cheminCibleReset_(plan.domaine, plan.nom), null, 'branche repli (le Reset ne route pas)');
  const conso = ctx.cheminCibleConsolidation_(plan.domaine, plan.nom, validees);
  assert.strictEqual(conso.nom, plan.sousDossier, 'repli : flux↔conso convergent (« ' + plan.sousDossier + ' » vs « ' + conso.nom + ' »)');
  assert.strictEqual(conso.id, plan.dossierIdCible || '', 'repli : les IDs convergent aussi');
});

/* ---------- Point 4 (revue structure-keeper) : le flux délégué re-pointe le référentiel d'entité ---------- */

test('deciderRoutageV2_ : entité-table au Dossier ID PÉRIMÉ → re-pointée vers le nœud thématique, UNE fois par run', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs', 'Router.gs']);
  const cle = c.cleCanoniqueEntite_('05 · Carrière', 'Robovic');
  const repoints = [];
  // Mock RÉALISTE (revue code-reviewer, leçon §7) : la VRAIE `entitesValideesParCle_` RECONSTRUIT une
  // carte neuve à CHAQUE appel depuis `_entitesCache` — que `repointerEntites_` (écriture Sheet) ne met
  // PAS à jour en cours de run. Donc le `dossierId` reste périmé côté cache d'un doc à l'autre : un mock
  // à objet PARTAGÉ masquerait ce comportement (et « prouverait » une dédup inexistante). On reconstruit.
  c.entitesValideesParCle_ = () => { const v = {}; v[cle] = { nom: 'Robovic', dossierId: 'ANCIEN_ID' }; return v; };
  c.idDomaine_ = () => 'DOM_05';
  c.DriveApp = { getFolderById: () => ({ getId: () => 'DOM_05' }) };
  c.sousDossier_ = (parent, name) => ({ getId: () => 'F_' + name }); // Employeurs → Robovic ⇒ F_Robovic
  c.repointerEntites_ = (src, dst) => { repoints.push([src, dst]); };
  c.garantirNomUnique_ = (n) => n;
  c.nomsDansDossier_ = () => [];

  // ⚠️ FIGURANT CHANGÉ (ADR-0058) : ce test prouve le RE-POINTAGE d'une entité au Dossier ID
  // périmé, pas le sort des paies — lesquelles quittent désormais `05` par construction, ce qui
  // aurait fait « passer » le test en lui faisant prouver autre chose.
  // `Document professionnel` et non `Attestation d'emploi` : il faut un type qui résolve à la MÊME
  // PROFONDEUR que l'ancienne paie (`Employeurs/Robovic`). L'attestation gagne un sous-dossier
  // thématique (`/Attestations & lettres`), donc le dossier FINAL n'est plus celui de l'entité et le
  // re-pointage ne se déclenche pas — le test serait tombé pour une raison sans rapport avec ce
  // qu'il vérifie. Un figurant se remplace à conditions ÉGALES, sinon on déplace le sujet.
  const doc = (date) => c.deciderRoutageV2_(
    { domaine: '05 · Carrière', type_doc: 'Document professionnel', emetteur: 'Robovic', date_doc: date },
    { nomFichier: 'doc.pdf', taille: 1000, extraitOcr: 'texte lisible '.repeat(5), emetteur: 'Robovic' },
    new Date(date + 'T00:00:00Z'), '.pdf');

  const r = doc('2026-06-01');
  assert.strictEqual(r.chemin, '05 · Carrière/Employeurs/Robovic', 'doc placé dans le nœud thématique');
  assert.deepStrictEqual(repoints, [['ANCIEN_ID', 'F_Robovic']], 'référentiel re-pointé de l\'ancien ID vers le dossier thématique');

  // DÉDUP RUN-SCOPE : un 2ᵉ doc de la MÊME entité (carte reconstruite → dossierId TOUJOURS périmé côté
  // cache) ne relit PLUS l'onglet Entités — le set `_repointesRun` mémorise l'ancien ID. C'est le VRAI
  // mécanisme de dédup (pas la mutation morte de la carte reconstruite).
  doc('2026-07-01');
  assert.strictEqual(repoints.length, 1, 'aucun 2ᵉ re-pointage dans le même run (dédup run-scope réelle)');
});

test('sousDossier_ : un dossier à la CORBEILLE n\'est JAMAIS une cible de classement (§1.2)', () => {
  // Relevé en revue C28-93 : `getFoldersByName` rend AUSSI les dossiers corbeillés. Sans filtre, un
  // dossier mis à la corbeille par Marc (ADR-0014, au clic) redevenait la cible du classement : les
  // documents y étaient déposés, puis purgés AVEC lui à 30 jours — une SUPPRESSION AUTOMATIQUE, le
  // garde-fou §1.2 non négociable. Défaut pré-existant, rendu ATTEIGNABLE par ce lot, qui débloque
  // le bouton « tout corbeiller ». Mutation : revenir à `it.hasNext() ? it.next() : create` ⇒ tombe.
  const dossier = (id, corbeille) => ({ getId: () => id, isTrashed: () => corbeille });
  const iterateur = (items) => { let i = 0; return { hasNext: () => i < items.length, next: () => items[i++] }; };
  const parent = (items) => {
    const cree = [];
    return {
      cree,
      getFoldersByName: () => iterateur(items),
      createFolder: (nom) => { cree.push(nom); return dossier('CREE:' + nom, false); },
    };
  };

  // 1) Un SEUL homonyme, corbeillé : on en RECRÉE un plutôt que de déposer dans la corbeille.
  const p1 = parent([dossier('MORT', true)]);
  assert.strictEqual(ctx.sousDossier_(p1, 'Robovic').getId(), 'CREE:Robovic');
  assert.strictEqual(p1.cree.length, 1);

  // 2) Un corbeillé PUIS un vivant : c'est le vivant qui est rendu, et rien n'est créé.
  const p2 = parent([dossier('MORT', true), dossier('VIVANT', false)]);
  assert.strictEqual(ctx.sousDossier_(p2, 'Robovic').getId(), 'VIVANT');
  assert.strictEqual(p2.cree.length, 0, 'un dossier vivant existe : surtout pas de doublon');

  // 3) Cas nominal inchangé : premier homonyme vivant ⇒ rendu tel quel.
  const p3 = parent([dossier('VIVANT', false)]);
  assert.strictEqual(ctx.sousDossier_(p3, 'Robovic').getId(), 'VIVANT');
  assert.strictEqual(p3.cree.length, 0);
});

test('dossierVivantOuNull_ : un ID MÉMORISÉ ne ressuscite jamais un dossier corbeillé (§1.2)', () => {
  // 3ᵉ revue : le correctif de `sousDossier_` gardait la FEUILLE de la chaîne, pas ses RACINES.
  // `dossierDomaineAuto_` et `dossierRacineParNom_` rendaient l'ID mémorisé en Script Property sans
  // vérifier la corbeille. Scénario mesuré par l'auditeur : Marc corbeille `_Doublons` depuis Drive
  // (la garde de NOM qui le protège vit dans l'APP, pas dans Drive) ; `DriveAI_DOUBLONS_ID` pointe
  // toujours dessus, `routageDoublon_` continue d'y envoyer chaque doublon, et 30 jours plus tard
  // Drive purge le dossier AVEC son contenu — §1.1(c) « un doublon, MÊME SENSIBLE, jamais effacé ».
  // Mutation : rendre `DriveApp.getFolderById(id)` sans le test ⇒ ce test tombe.
  const dossiers = { VIVANT: false, MORT: true };
  ctx.DriveApp = {
    getFolderById: (id) => {
      if (!(id in dossiers)) throw new Error('File not found');
      return { getId: () => id, isTrashed: () => dossiers[id] };
    },
  };
  assert.strictEqual(ctx.dossierVivantOuNull_('VIVANT').getId(), 'VIVANT');
  assert.strictEqual(ctx.dossierVivantOuNull_('MORT'), null, 'corbeillé ⇒ on n\'y dépose plus rien');
  assert.strictEqual(ctx.dossierVivantOuNull_('INCONNU'), null, 'ID mort ⇒ recréation par nom');
  assert.strictEqual(ctx.dossierVivantOuNull_(''), null);
  assert.strictEqual(ctx.dossierVivantOuNull_(null), null);
});

test('dossierRacineParNom_ / dossierDomaineAuto_ APPELLENT la garde (câblage, pas la fonction seule)', () => {
  // Leçon de la 3ᵉ revue, appliquée AU CORRECTIF LUI-MÊME : une fonction bien testée qui n'est pas
  // APPELÉE ne protège rien. `dossierVivantOuNull_` a son test ; ce test-ci vérifie que les deux
  // résolveurs de RACINE passent par elle, sur les DEUX voies (ID mémorisé, puis nom).
  // Mutation : remettre `try { return DriveApp.getFolderById(id); } catch {}` ⇒ ce test tombe.
  const props = {};
  const cree = [];
  const dossier = (id, corbeille) => ({
    getId: () => id,
    isTrashed: () => corbeille,
    getParents: () => ({ hasNext: () => true, next: () => racine }),
  });
  const racine = {
    getId: () => 'RACINE',
    getParents: () => ({ hasNext: () => false }),
    getFoldersByName: (nom) => {
      let i = 0;
      const items = nom === '_Doublons' ? [dossier('DOUBLONS_MORT', true)] : [];
      return { hasNext: () => i < items.length, next: () => items[i++] };
    },
    createFolder: (nom) => { cree.push(nom); return dossier('NEUF:' + nom, false); },
  };
  ctx.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
  }) };
  ctx.DriveApp = {
    getRootFolder: () => racine,
    getFolderById: (id) => {
      if (id === 'DOUBLONS_MORT') return dossier('DOUBLONS_MORT', true);
      if (id === 'ANCRE') return dossier('ANCRE', false);
      throw new Error('File not found: ' + id);
    },
  };
  ctx.CONFIG = Object.assign({}, ctx.CONFIG, {
    DOSSIERS: Object.assign({}, ctx.CONFIG.DOSSIERS, { A_TRIER: 'ANCRE' }),
    DOMAINES: Object.assign({}, ctx.CONFIG.DOMAINES, { [ctx.CONFIG.DOMAINE_DEFAUT]: 'ANCRE' }),
  });

  // Voie ID : la Property pointe sur un dossier CORBEILLÉ — c'est le scénario « Marc corbeille
  // `_Doublons` depuis Drive » — on ne le rend pas, on en recrée un.
  props.DriveAI_DOUBLONS_ID = 'DOUBLONS_MORT';
  const d = ctx.dossierRacineParNom_('_Doublons', 'DriveAI_DOUBLONS_ID');
  assert.strictEqual(d.getId(), 'NEUF:_Doublons', 'jamais le dossier corbeillé');
  assert.strictEqual(props.DriveAI_DOUBLONS_ID, 'NEUF:_Doublons', 'et la Property est re-pointée');

  // Voie NOM (aucune Property) : l'homonyme corbeillé est ignoré lui aussi.
  cree.length = 0;
  const dom = ctx.dossierDomaineAuto_('_Doublons');
  assert.strictEqual(dom.getId(), 'NEUF:_Doublons');
  assert.strictEqual(cree.length, 1, 'un dossier neuf, pas la corbeille');

  // Contre-épreuve : un ID mémorisé VIVANT est rendu tel quel, rien n'est créé.
  props.DriveAI_DOUBLONS_ID = 'ANCRE';
  cree.length = 0;
  assert.strictEqual(ctx.dossierRacineParNom_('_Doublons', 'DriveAI_DOUBLONS_ID').getId(), 'ANCRE');
  assert.strictEqual(cree.length, 0);
});

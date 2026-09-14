/**
 * Reorg.tsx — vue « Réorg IA » (chantier #21, C21-05) : le plan avant/après proposé par le
 * moteur (onglet Réorg), validé/écarté ICI par Marc. L'app n'exécute RIEN : elle écrit des
 * statuts (cellules F) et dépose des demandes (append) — le moteur propose (C21-04) puis
 * applique les actions VALIDÉES par déplacements seuls (C21-06). Aucune ligne supprimée.
 */

import { useEffect, useState } from 'react';
import { lirePlage, ecrireCellule, ecrireColonnePlage, ajouterLigne, estConnecte } from '../google';
import { corbeillerDossierVide, corbeillerLot, type BilanLot } from '../corbeille';
import {
  LigneReorg,
  interpreterReorg,
  derniereDemandeReorg,
  actionsDuPlan,
  actionsProposeesChat,
  actionsRefuseesReorg,
  lignesVideCandidat,
  plagesContigues,
} from '../etat';
import { Icone } from '../composants/Icone';
import { Langue, t } from '../i18n';

const TYPES: Record<string, string> = { deplacer: '→', fusionner: '⇒', creer: '+', renommer: '✎', 'deplacer-fichier': '↳' };

/** Traduit les codes de refus du verdict corbeille (ADR-0014) en message lisible. */
function messageCorbeille(e: unknown, langue: Langue): string {
  const brut = String(e);
  if (brut.includes('non-vide')) return t('corbeilleNonVide', langue);
  if (brut.includes('zone-protegee')) return t('corbeilleProtege', langue);
  if (brut.includes('racine-systeme') || brut.includes('dossier-structurel') || brut.includes('pas-un-dossier')) {
    return t('corbeilleStructurel', langue);
  }
  // Motif NEUF de C28-93 : sans cette ligne, Marc lisait la chaîne technique brute au clic unitaire
  // (§9 : « améliorer un message d'erreur POUR L'HUMAIN est un changement de CONTRAT dès que du code
  // lit ce message » — ici l'inverse : un motif ajouté sans inventorier ses AFFICHEURS).
  if (brut.includes('ascendance-illisible')) return t('corbeilleAscendance', langue);
  return brut;
}

function libelleType(type: string, langue: Langue): string {
  if (type === 'deplacer') return t('reorgDeplacer', langue);
  if (type === 'fusionner') return t('reorgFusionner', langue);
  if (type === 'creer') return t('reorgCreer', langue);
  if (type === 'renommer') return t('reorgRenommer', langue);
  if (type === 'deplacer-fichier') return t('reorgDeplacerFichier', langue);
  return type;
}

export function ReorgVue({ langue }: { langue: Langue }) {
  const [lignes, setLignes] = useState<LigneReorg[]>([]);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [version, setVersion] = useState(0); // recharge après écriture

  useEffect(() => {
    (async () => {
      try {
        setCharge(false);
        // Onglet créé par le moteur au premier tick après déploiement — ABSENT (400) = vide.
        // Toute autre erreur (réseau, 429) REMONTE : un faux « aucune demande » inviterait à
        // empiler des demandes dupliquées.
        // Fenêtre OUVERTE `A2:H` (jamais une borne de tête) : l'onglet Réorg croît (demandes + plans +
        // chat) ; `ligneSheet = i + 2` reste valide car on lit depuis la ligne 2 (revue de fond 2026-07-31).
        const brut = await lirePlage('Réorg', 'A2:H').catch((e) => {
          if (String(e).includes('Google API 400')) return [] as string[][];
          throw e;
        });
        setLignes(interpreterReorg(brut));
        setCharge(true);
      } catch (e) {
        setErreur(String(e));
      }
    })();
    // L'Assistant remonte ce composant (changement de `key`) après une proposition du chat, en ayant
    // invalidé le cache de l'onglet Réorg juste avant → cette relecture repart du frais.
  }, [version]);

  async function demanderAnalyse(portee: string) {
    setEnCours(true);
    setErreur('');
    try {
      await ajouterLigne('Réorg', [
        `demande-${Date.now()}`, 'demande', '', '', '', 'analyse demandée', portee, new Date().toISOString(),
      ]);
      setVersion((v) => v + 1);
    } catch (e) {
      setErreur(String(e));
    } finally {
      setEnCours(false);
    }
  }

  async function poserStatut(l: LigneReorg, statut: 'validé' | 'écarté') {
    setErreur('');
    try {
      await ecrireCellule('Réorg', `F${l.ligneSheet}`, statut);
      setLignes((xs) => xs.map((x) => (x.ligneSheet === l.ligneSheet ? { ...x, statut } : x)));
    } catch (e) {
      setErreur(String(e));
    }
  }

  async function poserStatutEnMasse(cibles: LigneReorg[], statut: 'validé' | 'écarté') {
    if (cibles.length === 0 || enCours) return;
    setEnCours(true);
    setErreur('');
    try {
      // Plages CONTIGUËS de la colonne Statut — jamais une ligne non ciblée touchée.
      for (const plage of plagesContigues(cibles.map((c) => c.ligneSheet))) {
        await ecrireColonnePlage('Réorg', 'F', plage.debut,
          Array.from({ length: plage.fin - plage.debut + 1 }, () => statut));
      }
    } catch (e) {
      setErreur(String(e));
    } finally {
      setEnCours(false);
      setVersion((v) => v + 1); // resynchronise avec la Sheet même sur échec partiel du lot
    }
  }

  const [erreurCorbeille, setErreurCorbeille] = useState('');
  const [avancement, setAvancement] = useState<{ fait: number; total: number } | null>(null);
  // Le bilan d'un lot RÉUSSI n'est pas une erreur : il a sa propre ligne, en neutre (revue C28-93).
  const [bilanCorbeille, setBilanCorbeille] = useState('');

  /** ADR-0014 : corbeille d'un dossier VIDE — re-vérifié en direct au clic, jamais automatique. */
  async function corbeiller(l: LigneReorg) {
    // Un `return` MUET est ce qui rend une panne indiagnosticable : si l'app se croit occupée,
    // elle le DIT (C28-110). Le bouton est déjà `disabled` dans ce cas — mais la garde existe
    // aussi pour les chemins où il ne l'est pas (clavier, double-clic, re-rendu en vol).
    if (enCours) { setErreurCorbeille(t('actionEnCours', langue)); return; }
    setEnCours(true);
    setErreurCorbeille('');
    try {
      await corbeillerDossierVide(l.id);
      await ecrireCellule('Réorg', `F${l.ligneSheet}`, 'corbeillé');
      setLignes((xs) => xs.map((x) => (x.ligneSheet === l.ligneSheet ? { ...x, statut: 'corbeillé' } : x)));
    } catch (e) {
      setErreurCorbeille(messageCorbeille(e, langue));
    } finally {
      setEnCours(false);
    }
  }

  /**
   * ADR-0025 (axe 1) : corbeille EN LOT — un seul geste pour N dossiers vidés par le rangement. Chaque
   * dossier passe par la MÊME re-vérif LIVE (`corbeillerDossierVide` → `verdictCorbeille`) qu'au clic
   * unitaire ; SÉQUENTIEL (jamais de rafale d'appels Drive). Un refus ne stoppe PLUS le lot : il
   * classe SA ligne et les suivantes continuent (C28-93 — le contraire rendait la liste inutilisable
   * en entier). Le lot ne s'écourte que sur une session morte ou `CORBEILLE_MAX_PANNES` pannes
   * d'affilée, et il le DIT alors dans le bilan. Le moteur ne corbeille toujours rien : tout part de
   * ce clic.
   */
  async function toutCorbeiller(vides: LigneReorg[]) {
    if (enCours) { setErreurCorbeille(t('actionEnCours', langue)); return; }
    if (vides.length === 0) { setErreurCorbeille(t('corbeilleRienASupprimer', langue)); return; }
    setEnCours(true);
    setErreurCorbeille('');
    setBilanCorbeille('');
    setAvancement({ fait: 0, total: vides.length });
    // La boucle vit dans `corbeille.ts` (testée) : un refus classe SA ligne et le lot continue.
    // `corbeillerLot` n'attrape que ce qui vient de ses I/O injectées ; une exception de `stop()`
    // laisserait sinon tous les boutons désactivés jusqu'au rechargement (revue C28-93).
    let bilan: BilanLot;
    try {
      bilan = await corbeillerLot(vides, {
        corbeiller: (id) => corbeillerDossierVide(id),
        ecrire: (ligneSheet, statut) => ecrireCellule('Réorg', `F${ligneSheet}`, statut),
        surLigne: (ligneSheet, statut) =>
          setLignes((xs) => xs.map((x) => (x.ligneSheet === ligneSheet ? { ...x, statut } : x))),
        avancement: (fait, total) => setAvancement({ fait, total }),
        stop: () => !estConnecte(), // session morte : inutile d'enchaîner 100 échecs de fetch
      });
    } catch (e) {
      setAvancement(null);
      setEnCours(false);
      setErreurCorbeille(messageCorbeille(e, langue));
      return;
    }
    setAvancement(null);
    setEnCours(false);
    setBilanCorbeille(t('corbeilleBilan', langue)
      .replace('{n}', String(bilan.corbeilles))
      .replace('{c}', String(bilan.classes))
      .replace('{r}', String(bilan.aReessayer))
      .replace('{s}', String(bilan.sheetKo)));
    // Un lot écourté ne se lit pas comme un lot complet : la cause ET le nombre de lignes jamais
    // tentées sont dits, sinon Marc croit la liste traitée (revue C28-93).
    if (bilan.interrompu) {
      setErreurCorbeille(t(bilan.interrompu === 'session' ? 'corbeilleCoupeeSession' : 'corbeilleCoupeePannes', langue)
        .replace('{x}', String(bilan.nonTentees)));
    }
  }

  if (erreur && !charge) return <p className="erreur">{t('erreur', langue)} : {erreur}</p>;
  if (!charge) return null; // rien à montrer tant que l'onglet n'est pas lu — le fil du chat, lui, s'affiche

  const demande = derniereDemandeReorg(lignes);
  const actions = demande ? actionsDuPlan(lignes, demande.cle) : [];
  const proposees = actions.filter((a) => a.statut === 'proposé');
  const videsCandidats = lignesVideCandidat(lignes);
  const chatProposees = actionsProposeesChat(lignes);
  // Une seule liste de propositions dans le fil (chat + plan) ; ce qui est décidé n'apparaît plus
  // (Marc, 09/09 : « tout ce qui est fini à la poubelle » — plus d'historique à l'écran).
  const toutes = [...chatProposees, ...proposees];
  // …sauf ce que le moteur a REFUSÉ ou RATÉ après validation : ça reste visible, une ligne, jusqu'à « OK ».
  const refus = actionsRefuseesReorg(lignes, demande?.cle ?? null);
  const analyseEnCours = demande?.statut === 'analyse demandée';

  return (
    <div className="propositions">
      {erreur && <p className="erreur">{t('erreur', langue)} : {erreur}</p>}
      {toutes.length > 0 && (
        <div className="prop-tete">
          <b>{t('propositionsTitre', langue)}</b>
          <span className="pastille douce">{toutes.length}</span>
          <span className="sp" />
          {toutes.length >= 2 && (
            <>
              <button className="bouton-ligne principal" onClick={() => poserStatutEnMasse(toutes, 'validé')} disabled={enCours}>
                ✓ {t('toutValider', langue)}
              </button>
              <button className="bouton-ligne" onClick={() => poserStatutEnMasse(toutes, 'écarté')} disabled={enCours}>
                {t('toutEcarter', langue)}
              </button>
            </>
          )}
        </div>
      )}
      {toutes.map((a) => (
        <div key={a.cle} className="prop-carte">
          <b>{TYPES[a.type] ?? '·'} {libelleType(a.type, langue)}</b>
          <div className="prop-chemin">
            {a.cheminActuel && <>{a.cheminActuel} <span className="fleche">→</span> </>}{a.cheminPropose}
          </div>
          {a.detail && <small>{a.detail}</small>}
          <div className="prop-actions">
            <button className="bouton-ligne principal" disabled={enCours} onClick={() => poserStatut(a, 'validé')}>✓ {t('valider', langue)}</button>
            <button className="bouton-ligne" disabled={enCours} onClick={() => poserStatut(a, 'écarté')}>{t('ecarter', langue)}</button>
          </div>
        </div>
      ))}

      {refus.length > 0 && (
        <div className="prop-carte refus">
          {refus.map((a) => (
            <div key={a.cle} className="prop-refus">
              <span className="pastille crit">{t(a.statut.startsWith('échec') ? 'reorgEchec' : 'reorgRefuse', langue)}</span>
              <span className="prop-chemin">
                {a.cheminActuel && <>{a.cheminActuel} <span className="fleche">→</span> </>}{a.cheminPropose}
                {a.detail && <small> · {a.detail}</small>}
              </span>
              <button className="bouton-ligne" disabled={enCours} onClick={() => poserStatut(a, 'écarté')}>{t('compris', langue)}</button>
            </div>
          ))}
        </div>
      )}

      {/* L'explication du PLAN ne s'affiche que sous des cartes du plan (jamais sous des propositions chat seules). */}
      {demande && demande.statut === 'proposé' && demande.detail && proposees.length > 0 && (
        <p className="variante ia-explication">✨ {demande.detail}</p>
      )}
      {demande && demande.statut === 'proposé' && actions.length === 0 && (
        <p className="variante">✓ {t('reorgRien', langue)}</p>
      )}
      {demande && demande.statut === 'échec' && <p className="erreur">{demande.detail}</p>}

      {videsCandidats.length > 0 && (
        <div className="prop-carte vides">
          <b>{t('dossiersVides', langue)}</b>
          {videsCandidats.map((l) => (
            <div key={l.cle} className="prop-vide">
              <span className="prop-chemin">{l.cheminActuel}</span>
              <button className="bouton-ligne" disabled={enCours} title={t('corbeilleNote', langue)} onClick={() => corbeiller(l)}>
                🗑 {t('corbeiller', langue)}
              </button>
            </div>
          ))}
          {/* ⚠️ LE COMPTE RENDU VIT ICI, EN BAS ET COLLANT (C28-110). Il était rendu EN TÊTE de
              cette carte, au-dessus de la liste — or la liste fait 112 lignes et le bouton est en
              bas : Marc cliquait, le bilan s'affichait ~112 lignes au-dessus de son écran, et de
              là où il était « il ne se passait rien ». C'est ce qui a fait croire pendant des
              semaines que « tout corbeiller » ne marchait pas, alors que le code, lui, faisait son
              travail. Collant : le retour reste visible où qu'on soit dans la liste, ce qui vaut
              aussi pour un clic 🗑 unitaire fait tout en haut. */}
          <div className="corbeille-retour">
            {erreurCorbeille && <p className="erreur">{erreurCorbeille}</p>}
            {bilanCorbeille && <p className="variante">{bilanCorbeille}</p>}
            {avancement && <p className="variante">⏳ {avancement.fait} / {avancement.total}</p>}
            {videsCandidats.length >= 2 && (
              <div className="prop-actions">
                <button className="bouton-ligne" onClick={() => toutCorbeiller(videsCandidats)} disabled={enCours} title={t('corbeilleNote', langue)}>
                  🗑 {t('toutCorbeiller', langue)} ({videsCandidats.length})
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* L'analyse de tout le Drive : une puce, comme les raccourcis du chat. En cours ⇒ le dire. */}
      <div className="puces-actions">
        {analyseEnCours
          ? <span className="puce-action attente">⏳ {t('analyseEnCours', langue)}</span>
          : (
            <button className="puce-action" onClick={() => demanderAnalyse('tout')} disabled={enCours}>
              <Icone nom="etincelle" /> {t(demande ? 'reAnalyser' : 'analyserToutDrive', langue)}
            </button>
          )}
      </div>
    </div>
  );
}

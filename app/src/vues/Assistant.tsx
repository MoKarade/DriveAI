/**
 * Assistant.tsx — onglet ASSISTANT (C28-30 PR3, ADR-0026 ; v7 C28-82 PR4). REMPLACE la page réorg.
 *
 * Un seul fil, plein écran : le CHAT. Marc pose des questions sur ses fichiers (« donne mon NAS »)
 * OU demande de ranger (« crée un dossier Garage dans Véhicule », « organise mes photos »). Le
 * moteur (doPost `chat-assistant`) cherche/lit et répond ; la clé Claude et l'accès Drive vivent
 * CÔTÉ MOTEUR (ADR-0007) — l'app n'envoie que l'historique et n'affiche que la réponse + un compteur
 * de budget. L'historique persiste en sessionStorage (survit au F5, meurt à la fermeture d'onglet ;
 * jamais localStorage — esprit ADR-0007). Plafond quotidien §2.6 : au-delà, refus honnête.
 * Les opérations que l'assistant PROPOSE (et le plan « Analyser tout le Drive ») arrivent dans
 * l'onglet Réorg et s'affichent en CARTES dans le fil (`ReorgVue`), juste au-dessus de la saisie
 * collée en bas ; Marc les valide PAR ACTION. Le moteur applique ensuite (chemin GARDÉ C21-06).
 * Rien n'est jamais supprimé ni appliqué sans la validation de Marc.
 */

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { envoyerMessageChat, viderCachePlages, MessageChat } from '../google';
import { ReorgVue } from './Reorg';
import { Icone } from '../composants/Icone';
import { Langue, t } from '../i18n';

// Historique du chat en sessionStorage (survit au F5, DÉTRUIT à la fermeture de l'onglet) — jamais
// localStorage : l'historique peut CITER du contenu de doc lu par Claude, on ne l'inscrit pas
// durablement sur le disque (esprit ADR-0007 ; même politique que le jeton OAuth, cf. google.ts).
const CLE_CHAT = 'driveai_chat';
function lireHistorique(): { messages: MessageChat[]; brouillon: string } {
  try {
    const arr = JSON.parse(sessionStorage.getItem(CLE_CHAT) || '[]');
    const propres: MessageChat[] = Array.isArray(arr)
      ? arr.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      : [];
    // Un tour `user` FINAL = réponse jamais reçue (F5 ou changement d'onglet PENDANT l'attente : la
    // persistance a écrit le tour user, la réponse a été perdue au démontage). Le garder casserait le
    // prochain envoi — deux `user` de suite → alternance rompue → chat mort jusqu'à « Effacer », sans
    // que rien ne le suggère (revue de fond 2026-07-31). On le retire et on rend son texte comme
    // BROUILLON pour que Marc puisse le renvoyer d'un clic.
    if (propres.length && propres[propres.length - 1].role === 'user') {
      const orphelin = propres.pop() as MessageChat;
      return { messages: propres, brouillon: orphelin.content };
    }
    return { messages: propres, brouillon: '' };
  } catch {
    return { messages: [], brouillon: '' };
  }
}

export function Assistant({ langue }: { langue: Langue }) {
  const [initial] = useState(lireHistorique); // lu UNE fois au montage (assainit un tour user orphelin)
  const [messages, setMessages] = useState<MessageChat[]>(initial.messages);
  const [saisie, setSaisie] = useState(initial.brouillon);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const [budget, setBudget] = useState<{ coutJour: number; plafond: number } | null>(null);
  const [cleReorg, setCleReorg] = useState(0); // change → remonte ReorgVue (relit l'onglet Réorg)
  const finRef = useRef<HTMLDivElement | null>(null);

  // Persistance éphémère : l'historique survit au refresh (sessionStorage), pas à la fermeture d'onglet.
  useEffect(() => {
    try { sessionStorage.setItem(CLE_CHAT, JSON.stringify(messages)); } catch { /* stockage indispo : le chat reste en mémoire */ }
  }, [messages]);

  // Auto-scroll vers le dernier message. `block: 'end'` (revue PR 4) : avec des cartes de propositions
  // SOUS la sentinelle, `'start'` la calait en haut de l'écran et la dernière réponse passait au-dessus
  // du pli ; `.chat-fin` porte la marge qui la sort de sous la saisie collante.
  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, enCours]);

  function effacer() {
    setMessages([]); // l'effet de persistance ci-dessus réécrit alors '[]' → historique vidé
  }

  async function envoyer(texte: string) {
    const propre = texte.trim();
    if (!propre || enCours) return;
    setErreur('');
    setSaisie('');
    const histo: MessageChat[] = [...messages, { role: 'user', content: propre }];
    setMessages(histo);
    setEnCours(true);
    try {
      const r = await envoyerMessageChat(histo);
      setMessages((xs) => [...xs, { role: 'assistant', content: r.reponse }]);
      if (r.coutJour != null && r.plafond != null) setBudget({ coutJour: r.coutJour, plafond: r.plafond });
      // SEULEMENT si le chat a appelé proposer_reorg (le moteur l'a signalé) : il a écrit des lignes
      // dans l'onglet Réorg côté serveur → on invalide le cache de l'app PUIS on remonte ReorgVue pour
      // qu'elle relise du frais. Sans ce signal, rien ne bouge (pas de faux rafraîchissement).
      if (r.actionsProposees) {
        viderCachePlages('Réorg');
        setCleReorg((k) => k + 1);
      }
    } catch (e) {
      setErreur(String(e instanceof Error ? e.message : e));
      // Le moteur exige une alternance user/assistant STRICTE : on RETIRE le tour user resté sans
      // réponse (sinon le prochain envoi ferait deux `user` de suite → chat cassé jusqu'au reload) et
      // on rend le texte pour que Marc puisse réessayer.
      setMessages((xs) => xs.slice(0, -1));
      setSaisie(propre);
      // Le refus de budget porte le compteur : l'afficher même à froid (« plafond atteint »).
      const meta = e as { coutJour?: number; plafond?: number };
      if (meta && meta.coutJour != null && meta.plafond != null) setBudget({ coutJour: meta.coutJour, plafond: meta.plafond });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="assistant">
      <h2 className="titre-liste">
        {t('assistant', langue)}
        {budget && <span className="h2-note">{budget.coutJour.toFixed(2)} $ / {budget.plafond} $</span>}
        {messages.length > 0 && (
          <button className="icone-bouton petit" onClick={effacer} disabled={enCours}
            aria-label={t('assistantEffacer', langue)} title={t('assistantEffacer', langue)}>
            <Icone nom="fermer" />
          </button>
        )}
      </h2>

      <div className="chat-fil" role="log" aria-live="polite">
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="chat-bulle chat-moi">{m.content}</div>
          ) : (
            // Réponse de l'assistant en Markdown (listes, gras, liens). react-markdown NE rend PAS
            // le HTML brut par défaut (pas de rehype-raw) → un contenu de doc cité reste inerte (XSS
            // impossible ; esprit ADR-0007). Les URLs javascript: sont neutralisées par défaut.
            <div key={i} className="chat-bulle chat-ia chat-markdown">
              <ReactMarkdown
                components={{
                  a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer" />,
                }}
              >
                {m.content}
              </ReactMarkdown>
            </div>
          ),
        )}
        {enCours && (
          // Indicateur de charge BIEN VISIBLE (retour Marc : « on voit pas qu'il charge »). Un tour
          // peut durer jusqu'à ~1 min (2 passes + Tool Use).
          <div className="chat-loader">
            <span className="chat-loader-points" aria-hidden="true"><span /><span /><span /></span>
            <span>{t('assistantAnalyse', langue)}</span>
          </div>
        )}
        <div ref={finRef} className="chat-fin" />
      </div>

      {/* Les propositions (chat + plan) et les dossiers vides, dans le fil, juste au-dessus de la saisie. */}
      <ReorgVue key={cleReorg} langue={langue} />

      {erreur && <p className="erreur">{t('erreur', langue)} : {erreur}</p>}

      {messages.length === 0 && !enCours && (
        <div className="puces-actions">
          <button className="puce-action" disabled={enCours} onClick={() => envoyer(t('assistantSuggererPrompt', langue))}>
            <Icone nom="etincelle" /> {t('assistantSuggererDossiers', langue)}
          </button>
          <button className="puce-action" disabled={enCours} onClick={() => envoyer(t('assistantOrganiserPrompt', langue))}>
            <Icone nom="dossier" /> {t('assistantOrganiser', langue)}
          </button>
        </div>
      )}

      <form className="chat-saisie" onSubmit={(e) => { e.preventDefault(); void envoyer(saisie); }}>
        <input
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder={t('assistantPlaceholder', langue)}
          aria-label={t('assistantPlaceholder', langue)}
          disabled={enCours}
        />
        <button type="submit" className="envoyer" disabled={enCours || !saisie.trim()} aria-label={t('assistantEnvoyer', langue)} title={t('assistantEnvoyer', langue)}>
          <Icone nom="envoyer" />
        </button>
      </form>
    </div>
  );
}

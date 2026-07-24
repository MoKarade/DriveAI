/**
 * Assistant.tsx — onglet ASSISTANT (C28-30 PR3, ADR-0026). REMPLACE la page réorg.
 *
 * Deux moitiés, un onglet :
 *  - GAUCHE : le CHAT. Marc pose des questions sur ses fichiers (« donne mon NAS ») OU demande de
 *    ranger (« crée un dossier Garage dans Véhicule », « organise mes photos »). Le moteur (doPost
 *    `chat-assistant`) cherche/lit et répond ; la clé Claude et l'accès Drive vivent CÔTÉ MOTEUR
 *    (ADR-0007) — l'app n'envoie que l'historique ÉPHÉMÈRE (State React, rien persisté) et n'affiche
 *    que la réponse + un compteur de budget. Plafond quotidien §2.6 : au-delà, refus honnête.
 *  - DROITE : le PLAN à valider (`ReorgVue`). Les opérations que l'assistant PROPOSE arrivent dans
 *    l'onglet Réorg ; Marc les valide PAR ACTION ici. Le moteur applique ensuite (chemin GARDÉ
 *    C21-06). Rien n'est jamais supprimé ni appliqué sans la validation de Marc.
 */

import { useEffect, useRef, useState } from 'react';
import { envoyerMessageChat, viderCachePlages, MessageChat } from '../google';
import { ReorgVue } from './Reorg';
import { Langue, t } from '../i18n';

export function Assistant({ langue }: { langue: Langue }) {
  const [messages, setMessages] = useState<MessageChat[]>([]);
  const [saisie, setSaisie] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const [budget, setBudget] = useState<{ coutJour: number; plafond: number } | null>(null);
  const [signalReorg, setSignalReorg] = useState(0); // bumpé après une proposition → ReorgVue relit
  const finRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll vers le dernier message.
  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, enCours]);

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
      // Une réponse peut avoir écrit des propositions dans l'onglet Réorg (côté moteur) : le cache de
      // l'app ne le sait pas → on l'invalide et on demande à ReorgVue de relire.
      viderCachePlages('Réorg');
      setSignalReorg((v) => v + 1);
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

  const pourcentBudget = budget && budget.plafond > 0
    ? Math.min(100, Math.round((budget.coutJour / budget.plafond) * 100))
    : 0;

  return (
    <div className="accueil">
      <section className="carte large">
        <h2>💬 {t('assistant', langue)}</h2>
        <p className="explication">{t('assistantIntro', langue)}</p>

        <div className="chat-fil" role="log" aria-live="polite">
          {messages.length === 0 && <p className="explication">{t('assistantVide', langue)}</p>}
          {messages.map((m, i) => (
            <div key={i} className={`chat-bulle ${m.role === 'user' ? 'chat-moi' : 'chat-ia'}`}>
              {m.content}
            </div>
          ))}
          {enCours && <div className="chat-bulle chat-ia chat-attente">…</div>}
          <div ref={finRef} />
        </div>

        {erreur && <p className="erreur">{t('erreur', langue)} : {erreur}</p>}

        <div className="ligne-formulaire recherche-ia">
          <input
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && envoyer(saisie)}
            placeholder={t('assistantPlaceholder', langue)}
            disabled={enCours}
          />
          <button onClick={() => envoyer(saisie)} disabled={enCours || !saisie.trim()}>
            {enCours ? t('chargement', langue) : `➤ ${t('assistantEnvoyer', langue)}`}
          </button>
        </div>

        <div className="actions" style={{ margin: '0.4rem 0' }}>
          <button className="discret" disabled={enCours} onClick={() => envoyer(t('assistantSuggererPrompt', langue))}>
            ✨ {t('assistantSuggererDossiers', langue)}
          </button>
          <button className="discret" disabled={enCours} onClick={() => envoyer(t('assistantOrganiserPrompt', langue))}>
            🗂 {t('assistantOrganiser', langue)}
          </button>
        </div>

        {budget && (
          <div className="chat-budget">
            <span className="explication">
              {t('assistantBudget', langue)} : {budget.coutJour.toFixed(2)} / {budget.plafond.toFixed(2)} $
              {pourcentBudget >= 100 && ` — ${t('assistantBudgetEpuise', langue)}`}
            </span>
            <div className="chat-budget-piste" aria-hidden="true">
              <div className="chat-budget-jauge" style={{ width: `${pourcentBudget}%` }} />
            </div>
          </div>
        )}
      </section>

      <ReorgVue langue={langue} signalRafraichir={signalReorg} />
    </div>
  );
}

/**
 * api/mcp/index.ts — POST /api/mcp : le endpoint MCP (JSON-RPC 2.0, « streamable HTTP » en mode
 * SANS SESSION) du connecteur DriveAI (ADR-0042).
 *
 * Sous-ensemble MCP écrit À LA MAIN (api/ zéro dépendance, §6 bis) : `initialize`,
 * `notifications/*` (202), `ping`, `tools/list`, `tools/call` — chaque requête est indépendante
 * (pas d'ID de session, pas de flux SSE : GET/DELETE → 405). C'est exactement ce que le client
 * MCP de claude.ai requiert pour des outils requête→réponse ; le sous-ensemble est VERROUILLÉ par
 * app/test/mcp-endpoint.test.ts.
 *
 * Auth : Bearer OAuth 2.1 (api/_mcpOauth.ts) — 401 AVEC `WWW-Authenticate` portant l'URL de
 * découverte RFC 9728 (c'est ce header qui déclenche le flux d'autorisation côté claude.ai).
 *
 * Outils → moteur Apps Script (/exec) :
 *  - question_documents  → action `chat-assistant` (secret webapp, budget $/jour existant)
 *  - rechercher_documents / lire_document / etat_moteur / proposer_reorg / creer_intention
 *    → actions `mcp-*` (secret DÉDIÉ `MCP_ENGINE_SECRET` ↔ Script Property `DriveAI_MCP_SECRET`)
 * AUCUN contenu n'est persisté ni loggé ici (ADR-0042 §3) : le texte TRANSITE, c'est tout.
 */

import { Requete, Reponse, repondreJson } from '../_lib';
import { OAuthError } from '../_mcpOauth';
import { contexteMcp, repondre503Ferme, lireCorps, appelerMoteur, ContexteMcp } from './_commun';

const VERSION_PROTOCOLE = '2025-03-26';
const VERSIONS_CONNUES = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

/* ---------- Définition des outils (schémas JSON) ---------- */

const OUTILS = [
  {
    name: 'etat_moteur',
    description: 'État complet du moteur DriveAI : santé (dernier passage, coût LLM, API Tasks/Calendar), ' +
      'avancement de CHAQUE mission de rangement (traités/base, statut, dernière passe, fin estimée), ' +
      'dernières erreurs du Journal, et checkup de la boîte mail (fils triés aujourd\'hui, quotas Gmail, ' +
      'intentions suspendues ou non). Lecture seule, métadonnées seulement.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rechercher_documents',
    description: 'Cherche des documents dans le Drive de Marc par NOM (défaut, rapide) ou par CONTENU ' +
      '(mode "contenu", plein texte). Renvoie nom, id et dossier de chaque résultat — utiliser l\'id ' +
      'avec lire_document.',
    inputSchema: {
      type: 'object',
      properties: {
        requete: { type: 'string', description: 'terme à chercher (1 à 200 caractères)' },
        mode: { type: 'string', enum: ['nom', 'contenu'], description: 'défaut : nom' },
      },
      required: ['requete'], additionalProperties: false,
    },
  },
  {
    name: 'lire_document',
    description: 'Lit le TEXTE d\'un document du Drive de Marc (par son id, obtenu via rechercher_documents). ' +
      'Borné en taille ; les images sans OCR ne rendent pas de texte.',
    inputSchema: {
      type: 'object',
      properties: { fileId: { type: 'string', description: 'id Drive du fichier' } },
      required: ['fileId'], additionalProperties: false,
    },
  },
  {
    name: 'question_documents',
    description: 'Pose une question LIBRE sur les documents de Marc à l\'assistant du moteur (il cherche, ' +
      'lit et répond lui-même — utile quand on ne sait pas quel document contient la réponse). Consomme ' +
      'le budget IA quotidien du moteur.',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'la question (3 à 2000 caractères)' } },
      required: ['question'], additionalProperties: false,
    },
  },
  {
    name: 'proposer_reorg',
    description: 'PROPOSE des opérations de rangement (déplacer un fichier/dossier, créer, fusionner, ' +
      'renommer) dans la file de validation de l\'app DriveAI — Marc VALIDE dans l\'app, rien n\'est ' +
      'appliqué directement. Utiliser les id EXACTS obtenus via rechercher_documents.',
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array', minItems: 1,
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['deplacer-fichier', 'creer', 'deplacer', 'fusionner', 'renommer'] },
              source: { type: 'string' }, cible: { type: 'string' }, nom: { type: 'string' },
              source_nom: { type: 'string' }, cible_nom: { type: 'string' }, raison: { type: 'string' },
            },
            required: ['type'],
          },
        },
      },
      required: ['actions'], additionalProperties: false,
    },
  },
  {
    name: 'creer_intention',
    description: 'Crée UNE tâche Google Tasks (type "tache", échéance AAAA-MM-JJ optionnelle) ou UN ' +
      'événement Google Calendar (type "evenement", dateHeure "AAAA-MM-JJTHH:MM:SS" locale requise, ' +
      'dureeMinutes défaut 60) dans le compte de Marc. Création seule — jamais de modification ni de ' +
      'suppression. Requiert la liaison hubperso (docs/HUBPERSO.md).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['tache', 'evenement'] },
        titre: { type: 'string' },
        echeance: { type: 'string', description: 'tâche : AAAA-MM-JJ' },
        dateHeure: { type: 'string', description: 'événement : AAAA-MM-JJTHH:MM:SS (heure locale Québec)' },
        dureeMinutes: { type: 'number' },
        notes: { type: 'string' },
      },
      required: ['type', 'titre'], additionalProperties: false,
    },
  },
];

/* ---------- Exécution des outils ---------- */

/** Rend le résultat MCP (content[]) d'un outil. Toute erreur remonte en texte `isError`. */
async function executerOutil(ctx: ContexteMcp, nom: string, args: Record<string, unknown>): Promise<{ texte: string; erreur: boolean }> {
  if (nom === 'question_documents') {
    const question = typeof args.question === 'string' ? args.question.trim() : '';
    if (question.length < 3 || question.length > 2000) return { texte: 'question invalide (3 à 2000 caractères)', erreur: true };
    const r = await appelerMoteur(ctx.env, 'chat-assistant', ctx.env.webappSecret,
      { historique: [{ role: 'user', content: question }] }, false);
    if (!r.ok) return { texte: String(r.erreur ?? 'assistant indisponible'), erreur: true };
    const cout = r.coutJour !== undefined ? `\n\n(budget IA du jour : ${Number(r.coutJour).toFixed(2)} $ / ${r.plafond} $)` : '';
    return { texte: String(r.reponse ?? '') + cout, erreur: false };
  }

  const parAction: Record<string, string> = {
    etat_moteur: 'mcp-etat', rechercher_documents: 'mcp-recherche', lire_document: 'mcp-lire',
    proposer_reorg: 'mcp-reorg', creer_intention: 'mcp-intention',
  };
  const action = parAction[nom];
  if (!action) return { texte: `outil inconnu : ${nom}`, erreur: true };

  // Adaptation des arguments outil → corps d'action moteur (validation FERMÉE côté moteur).
  let corps: unknown = args;
  if (nom === 'rechercher_documents') corps = { requete: args.requete, mode: args.mode === 'contenu' ? 'contenu' : 'nom' };
  const r = await appelerMoteur(ctx.env, action, ctx.env.engineSecret, corps, true);
  if (!r.ok) return { texte: String(r.erreur ?? 'action refusée par le moteur'), erreur: true };

  if (nom === 'rechercher_documents') return { texte: String(r.resultat ?? ''), erreur: false };
  if (nom === 'lire_document') return { texte: String(r.contenu ?? ''), erreur: false };
  if (nom === 'proposer_reorg') return { texte: String(r.resultat ?? ''), erreur: false };
  if (nom === 'creer_intention') return { texte: `✅ ${r.cree} créé(e) (id : ${r.id})`, erreur: false };
  // etat_moteur : le JSON structuré est le bon format pour Claude (il le lit mieux qu'une prose).
  const { ok: _ok, versionMcp: _v, ...etat } = r;
  return { texte: JSON.stringify(etat, null, 1), erreur: false };
}

/* ---------- JSON-RPC ---------- */

interface RequeteRpc { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }

function erreurRpc(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export default async function handler(req: Requete, res: Reponse): Promise<void> {
  const ctx = contexteMcp(req);
  if (!ctx) { repondre503Ferme(res); return; }

  if (req.method !== 'POST') {
    // Mode sans session : pas de flux SSE (GET) ni de fin de session (DELETE) — 405 explicite,
    // le client MCP retombe sur le POST simple (comportement spécifié du streamable HTTP).
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end();
    return;
  }

  // Bearer OBLIGATOIRE — le 401 porte l'URL de découverte : c'est LUI qui déclenche le flux
  // d'autorisation côté claude.ai (RFC 9728), pas une configuration manuelle.
  try {
    ctx.auth.verifyAccessToken(Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization);
  } catch (err) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${ctx.auth.resourceMetadataUrl()}"`);
    repondreJson(res, err instanceof OAuthError ? err.status : 401,
      { error: err instanceof OAuthError ? err.code : 'invalid_token' });
    return;
  }

  let rpc: RequeteRpc;
  try {
    rpc = JSON.parse(await lireCorps(req)) as RequeteRpc;
  } catch {
    repondreJson(res, 400, erreurRpc(null, -32700, 'JSON illisible'));
    return;
  }
  if (Array.isArray(rpc)) { repondreJson(res, 400, erreurRpc(null, -32600, 'lots (batch) non supportés')); return; }
  // `JSON.parse('null')` réussit → rpc === null ; `rpc.method` lèverait un TypeError HORS try
  // (500 brut, revue #3). Toute charge non-objet est une requête JSON-RPC invalide.
  if (!rpc || typeof rpc !== 'object') { repondreJson(res, 400, erreurRpc(null, -32600, 'requête JSON-RPC invalide')); return; }

  const methode = String(rpc.method ?? '');
  // Notification (pas d'id) : accusé sans corps — `notifications/initialized` notamment.
  if (rpc.id === undefined) { res.statusCode = 202; res.end(); return; }

  if (methode === 'initialize') {
    const demandee = String(rpc.params?.protocolVersion ?? '');
    repondreJson(res, 200, {
      jsonrpc: '2.0', id: rpc.id,
      result: {
        protocolVersion: VERSIONS_CONNUES.has(demandee) ? demandee : VERSION_PROTOCOLE,
        capabilities: { tools: {} },
        serverInfo: { name: 'driveai-mcp', version: '1.0.0' },
      },
    });
    return;
  }
  if (methode === 'ping') { repondreJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: {} }); return; }
  if (methode === 'tools/list') {
    repondreJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { tools: OUTILS } });
    return;
  }
  if (methode === 'tools/call') {
    const nom = String(rpc.params?.name ?? '');
    const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
    try {
      const sortie = await executerOutil(ctx, nom, args);
      repondreJson(res, 200, {
        jsonrpc: '2.0', id: rpc.id,
        result: { content: [{ type: 'text', text: sortie.texte }], isError: sortie.erreur },
      });
    } catch (err) {
      // Erreur d'OUTIL (moteur injoignable, piège 4…) : résultat isError LISIBLE — jamais une
      // erreur de protocole, le modèle doit pouvoir la lire et l'expliquer à Marc.
      repondreJson(res, 200, {
        jsonrpc: '2.0', id: rpc.id,
        result: { content: [{ type: 'text', text: String(err instanceof Error ? err.message : err) }], isError: true },
      });
    }
    return;
  }
  repondreJson(res, 200, erreurRpc(rpc.id, -32601, `méthode inconnue : ${methode}`));
}

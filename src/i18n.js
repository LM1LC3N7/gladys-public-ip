// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, button and action
// results, widget). Every text is a { en, fr } object: Gladys picks the
// user's language.
// -----------------------------------------------------------------------------

/** A duration in words: "45 s", "12 min", "3 h 05", "2 d 4 h" ("j" in French). */
export function duration(ms, language = 'en') {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return `${s} s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m} min`;
  }
  const h = Math.floor(m / 60);
  if (h < 48) {
    return `${h} h ${String(m % 60).padStart(2, '0')}`;
  }
  return `${Math.floor(h / 24)} ${language === 'fr' ? 'j' : 'd'} ${h % 24} h`;
}

/** The reasons a source gave no address (see askSource). */
const ERRORS = {
  network: { en: 'unreachable', fr: 'injoignable' },
  timeout: { en: 'timeout', fr: 'délai dépassé' },
  'not an address': { en: 'not an address', fr: 'pas une adresse' },
};

export const PROVIDER_NAMES = { duckdns: 'Duck DNS', cloudflare: 'Cloudflare' };

export const T = {
  checking: {
    en: 'Checking the public IP address…',
    fr: 'Vérification de l’adresse IP publique…',
  },
  ok: (ipv4, ipv6) => ({
    en: `Public IPv4 ${ipv4 ?? 'unknown'}${ipv6 ? `, IPv6 ${ipv6}` : ''}.`,
    fr: `IPv4 publique ${ipv4 ?? 'inconnue'}${ipv6 ? `, IPv6 ${ipv6}` : ''}.`,
  }),
  ipv6Unavailable: {
    en: ' IPv6 is not available from the container (usual on a Docker bridge): IPv4 only.',
    fr: ' IPv6 n’est pas disponible depuis le conteneur (habituel sur un pont Docker) : IPv4 seulement.',
  },
  cgnat: {
    en: ' Behind a carrier-grade NAT (100.64.0.0/10): the address is shared, a DNS name pointing to it will not reach your home.',
    fr: ' Derrière un NAT d’opérateur (100.64.0.0/10) : l’adresse est partagée, un nom DNS qui pointe dessus n’atteindra pas votre maison.',
  },
  unconfirmed: {
    en: ' The IP services disagree: waiting until two of them give the same address.',
    fr: ' Les services d’IP ne sont pas d’accord : en attente de deux réponses identiques.',
  },
  lost: (since) => ({
    en: `No IP service has answered for ${since}: the Internet looks down. Retrying every minute.`,
    fr: `Aucun service d’IP ne répond depuis ${since} : Internet semble coupé. Nouvel essai chaque minute.`,
  }),
  noAnswerYet: {
    en: 'No IP service answers yet: retrying every minute.',
    fr: 'Aucun service d’IP ne répond pour l’instant : nouvel essai chaque minute.',
  },
  dnsOk: (name) => ({ en: ` ${name} up to date.`, fr: ` ${name} à jour.` }),
  dnsRetry: (name, message, inTime) => ({
    en: ` ${name}: ${message}. Next try in ${inTime}.`,
    fr: ` ${name} : ${message}. Prochain essai dans ${inTime}.`,
  }),
  dnsFinal: (name, message) => ({
    en: ` ${name}: ${message}. Updates stopped until the configuration is saved again.`,
    fr: ` ${name} : ${message}. Mises à jour arrêtées jusqu’au prochain enregistrement de la configuration.`,
  }),
  dnsWaiting: (name) => ({
    en: ` ${name}: waiting for the first address.`,
    fr: ` ${name} : en attente de la première adresse.`,
  }),
  update: {
    none: {
      en: 'No dynamic DNS provider is configured.',
      fr: 'Aucun fournisseur de DNS dynamique n’est configuré.',
    },
    noAddress: {
      en: 'The public address is not known yet: nothing to send.',
      fr: 'L’adresse publique n’est pas encore connue : rien à envoyer.',
    },
    updated: (name) => ({ en: `${name}: updated`, fr: `${name} : mis à jour` }),
    unchanged: (name) => ({ en: `${name}: already up to date`, fr: `${name} : déjà à jour` }),
    failed: (name, message) => ({ en: `${name}: ${message}`, fr: `${name} : ${message}` }),
  },
  test: {
    title: { en: 'Public IP detection', fr: 'Détection de l’IP publique' },
    answer: (family, source, address, kind) => ({
      en: `${family} · ${source}: ${address}${kind === 'public' ? '' : ` (not public: ${kind})`}`,
      fr: `${family} · ${source} : ${address}${kind === 'public' ? '' : ` (non publique : ${kind})`}`,
    }),
    failed: (family, source, error) => {
      const reason = ERRORS[error] ?? { en: error, fr: error };
      return {
        en: `${family} · ${source}: no answer (${reason.en})`,
        fr: `${family} · ${source} : pas de réponse (${reason.fr})`,
      };
    },
    ipv6None: {
      en: 'IPv6 · no source reachable over IPv6: the container has no IPv6 (usual on a Docker bridge)',
      fr: 'IPv6 · aucune source joignable en IPv6 : le conteneur n’a pas d’IPv6 (habituel sur un pont Docker)',
    },
    ipv6Off: {
      en: 'IPv6 · detection turned off in the configuration',
      fr: 'IPv6 · détection désactivée dans la configuration',
    },
    duckdnsReady: (domains) => ({
      en: `Duck DNS: ready for ${domains} (Duck DNS has no dry run: the record is written at the next change or with "Update DNS now").`,
      fr: `Duck DNS : prêt pour ${domains} (Duck DNS n’a pas de mode test : l’enregistrement est écrit au prochain changement ou avec « Mettre à jour le DNS »).`,
    }),
    problem: (name, message) => ({ en: `${name}: ${message}`, fr: `${name} : ${message}` }),
    tokenStatus: (status) => ({
      en: `Cloudflare: API token ${status}`,
      fr: `Cloudflare : jeton d’API ${status === 'active' ? 'actif' : status}`,
    }),
    tokenUnverified: (message) => ({
      en: `${message} (on /user/tokens/verify: an account-owned token?); trying the zone anyway`,
      fr: `${message} (sur /user/tokens/verify : un jeton de compte ?) ; essai de la zone quand même`,
    }),
    record: (name, type, content, target) => {
      const verdict = !target
        ? { en: 'left as is (address unknown)', fr: 'laissé tel quel (adresse inconnue)' }
        : content === target
          ? { en: 'up to date', fr: 'à jour' }
          : { en: `would be updated to ${target}`, fr: `serait mis à jour vers ${target}` };
      return {
        en: `Cloudflare: ${name} ${type} ${content} → ${verdict.en}`,
        fr: `Cloudflare : ${name} ${type} ${content} → ${verdict.fr}`,
      };
    },
    missing: (name) => ({
      en: `Cloudflare: no A or AAAA record named ${name} (create it first; it is never created)`,
      fr: `Cloudflare : aucun enregistrement A ou AAAA nommé ${name} (créez-le d’abord ; il n’est jamais créé)`,
    }),
    noDns: {
      en: 'No dynamic DNS provider configured (optional).',
      fr: 'Aucun fournisseur de DNS dynamique configuré (facultatif).',
    },
  },
  widget: {
    title: { en: 'Public IP', fr: 'IP publique' },
    internet: { en: 'Internet', fr: 'Internet' },
    online: { en: 'Connected', fr: 'Connecté' },
    offlineFor: (d) => ({ en: `Down for ${d}`, fr: `Coupé depuis ${d}` }),
    unknown: { en: 'Checking…', fr: 'Vérification…' },
    unavailable: { en: 'Unavailable', fr: 'Indisponible' },
    off: { en: 'Not detected', fr: 'Non détectée' },
    cgnat: { en: 'Shared (CGNAT)', fr: 'Partagée (CGNAT)' },
    unchangedFor: { en: 'Unchanged for', fr: 'Inchangée depuis' },
    updatedAgo: (d) => ({ en: `Updated ${d} ago`, fr: `Mis à jour il y a ${d}` }),
    checkedAgo: (d) => ({ en: `Checked ${d} ago`, fr: `Vérifié il y a ${d}` }),
    waiting: { en: 'Waiting', fr: 'En attente' },
    error: { en: 'Error', fr: 'Erreur' },
    stopped: { en: 'Stopped: see the status', fr: 'Arrêté : voir le statut' },
    updateDns: { en: 'Update DNS now', fr: 'Mettre à jour le DNS' },
    unofficial: { en: 'unofficial connector', fr: 'connecteur non officiel' },
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
   Service worker — page de vente EKAYE

   Raison d'être : la file d'attente hors-ligne de la page ne servait à rien tant
   que la page elle-même ne s'ouvrait pas sans réseau. Elle ne protégeait que les
   coupures survenues onglet déjà chargé — jamais le cas qui compte : arriver sur
   un salon sans réseau et vouloir encaisser.

   ⚠ VERSION — À INCRÉMENTER À CHAQUE PUBLICATION.
   Sans incrément, le nom du cache ne change pas, les anciens fichiers ne sont pas
   remplacés, et les téléphones qui ont déjà installé la page gardent l'ancienne
   version indéfiniment. C'est la seule ligne à ne jamais oublier de toucher.
   ───────────────────────────────────────────────────────────────────────────── */
const VERSION = 'v1';
const CACHE = 'ekaye-vente-' + VERSION;

/* Tout ce qu'il faut pour qu'un démarrage à froid sans réseau donne une page
   complète et un scan caméra qui marche. html5-qrcode est servi depuis le dépôt
   et non depuis unpkg : une ressource d'un autre domaine ne se met en cache
   qu'en réponse « opaque », impossible à contrôler (on ne sait ni si elle a
   réussi, ni ce qu'elle contient). Une copie locale est vérifiable. */
const RESSOURCES = [
  './',
  './index.html',
  './html5-qrcode.min.js',
  './banniere.jpg',
  './manifest.webmanifest',
  './icone-192.png',
  './icone-512.png',
  './icone-512-maskable.png'
];

/* Au-delà de ce délai, si une copie en cache existe, on la sert sans attendre la
   fin de la requête réseau — qui continue en arrière-plan pour rafraîchir le
   cache. En salon, le réseau à une barre ne tombe pas en erreur : il pend. Sans
   ce garde-temps, « réseau d'abord » veut dire trente secondes d'écran blanc. */
const DELAI_RESEAU_MS = 4000;

self.addEventListener('install', function (evenement) {
  evenement.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(RESSOURCES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (evenement) {
  evenement.waitUntil(
    caches.keys()
      .then(function (noms) {
        return Promise.all(noms.map(function (nom) {
          // Ne supprime que les caches de cette page : un autre projet servi sur
          // le même domaine github.io a ses propres caches, qui ne nous regardent pas.
          if (nom !== CACHE && nom.indexOf('ekaye-vente-') === 0) return caches.delete(nom);
          return null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (evenement) {
  const requete = evenement.request;

  // ⚠ NE JAMAIS INTERCEPTER AUTRE CHOSE QU'UN GET DE CE DOMAINE.
  // Les ventes partent en POST vers script.google.com. Les toucher, c'est risquer
  // de rejouer ou d'avaler un encaissement ; et c'est inutile, la page a déjà sa
  // propre file d'attente pour ça. Même chose pour les GET d'un autre domaine
  // (geo.api.gouv.fr pour les communes) : on les laisse passer intacts.
  if (requete.method !== 'GET') return;

  let url;
  try { url = new URL(requete.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  evenement.respondWith(reseauPuisCache(requete));
});

/* Réseau d'abord, repli sur le cache. Dans ce sens et pas l'inverse : une page de
   vente doit refléter le code publié, pas une copie figée. Le cache n'est qu'un
   filet — il ne sert que quand le réseau ne répond pas, ou pas à temps. */
function reseauPuisCache(requete) {
  return caches.open(CACHE).then(function (cache) {
    const surLeReseau = fetch(requete).then(function (reponse) {
      // Seules les réponses complètes et abouties méritent d'être gardées : un 404
      // ou un 206 (contenu partiel) mis en cache serait resservi tel quel hors-ligne.
      if (reponse && reponse.status === 200 && reponse.type === 'basic') {
        cache.put(requete, reponse.clone());
      }
      return reponse;
    });

    return cache.match(requete).then(function (enCache) {
      if (!enCache) {
        // Rien en réserve : on attend le réseau, et en dernier recours on sert la
        // page d'accueil pour toute navigation (URL avec paramètres, par exemple).
        return surLeReseau.catch(function (erreur) {
          if (requete.mode === 'navigate') {
            return cache.match('./index.html').then(function (accueil) {
              if (accueil) return accueil;
              throw erreur;
            });
          }
          throw erreur;
        });
      }

      // Une copie existe : le réseau a jusqu'à DELAI_RESEAU_MS pour faire mieux.
      // En cas d'échec comme de retard, on sert la copie ; la requête réseau, elle,
      // poursuit sa course et rafraîchit le cache pour la prochaine ouverture.
      return new Promise(function (resoudre) {
        const minuteur = setTimeout(function () { resoudre(enCache); }, DELAI_RESEAU_MS);
        surLeReseau.then(
          function (reponse) { clearTimeout(minuteur); resoudre(reponse); },
          function ()        { clearTimeout(minuteur); resoudre(enCache); }
        );
      });
    });
  });
}

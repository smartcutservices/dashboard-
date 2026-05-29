# Journal de bord Dashboard

## 2026-05-23 - Edition admin des candidatures vendeur

Contexte:
- Un vendeur qui a deja envoye sa candidature ne doit pas pouvoir modifier lui-meme le formulaire soumis.
- L'admin doit pouvoir corriger ou completer les informations manquantes depuis le dashboard.

Changements effectues:
- Ajout d'un bouton `Modifier candidature` sur chaque fiche dans le module `Candidatures`.
- Ajout d'un formulaire d'edition visible uniquement dans le dashboard admin.
- Les champs du formulaire vendeur, les parametres du plan, les zones de livraison, le statut KYC et la note admin peuvent etre modifies.

## 2026-05-25 - Commandes admin: visibilite stores et suivi vendeur

Contexte:

- Les admins Smart Cut doivent continuer a voir toutes les commandes.
- Mais le suivi livraison des produits vendeur ne doit pas etre modifie depuis le dashboard admin.
- Chaque vendeur doit confirmer ses propres etapes depuis son dashboard vendeur.
- L'admin doit savoir clairement dans quel store le client a achete chaque produit.

Correction appliquee:

- Ajout d'une colonne `Store(s)` dans `dashboard-orders.html`.
- Dans `dashboard-orders.js`, chaque commande affiche les stores concernes:
  - `Smart Cut Services` pour les produits Smart Cut,
  - le nom du vendeur pour les produits vendeur.
- Dans le detail commande, une section `Store(s) concernes` resume les stores de la commande.
- Chaque produit affiche aussi son store.
- Si une commande contient au moins un produit vendeur:
  - les boutons rapides `Expedie`, `En cours de livraison`, `Livre` sont remplaces par `Suivi vendeur`,
  - le bloc `Mettre a jour le suivi client` est remplace par une note indiquant que le vendeur gere le suivi,
  - `updateFulfillmentStatus()` refuse aussi la mise a jour par securite.
- Les commandes Smart Cut uniquement gardent les boutons de suivi admin.
- Les textes visibles ajoutes restent en ASCII pour eviter les problemes d'encodage deja vus dans les interfaces.

Verification:

- `node --check dashboard-orders.js`: OK.
- Le tableau `Commandes` garde la visibilite admin globale.
- Les commandes contenant des produits vendeur ne peuvent plus etre marquees `Livre` par l'admin.
- Les commandes uniquement Smart Cut peuvent encore etre pilotees par Smart Cut.

Precautions:
- Ne pas remettre de bouton admin global pour livrer une commande vendeur, sinon Smart Cut pourrait marquer comme livre un produit que le vendeur n'a pas encore livre.
- Si on ajoute plus tard un suivi par store dans le dashboard admin, il doit rester en lecture seule pour les vendeurs et editable seulement dans le dashboard vendeur.

## 2026-05-26 - Candidatures vendeur: formulaire admin simplifie

Contexte:

- Le module vendeur du dashboard affichait encore des champs retires du formulaire public: zones livraison, KYC, infos entreprise, reseau social, plan vendeur dans l edition candidature.
- La candidature vendeur doit rester courte et limiter les corrections admin aux informations de base demandees par Smart Cut.
- Les plans Basic/Pro et les frais mensuels restent geres par leurs modules dedies, pas dans l edition de candidature.

Changements effectues:

- `DEFAULT_FORM_SETTINGS.fields` de `vendors-dashboard.js` a ete aligne sur la liste officielle:
  `Nom complet`, `Email`, `Telephone`, `Adresse`, `Ville`, `Identification`, `Numero`, `Nom de la boutique`, `Banque`, `Devise`, `Nom du compte`, `Numero du compte`, `Presentation de votre activite`.
- `mergeRequiredVendorFields()` ignore les anciennes configurations Firestore et force cette liste propre.
- Le bloc admin `Plan vendeur` a ete retire de l edition candidature.
- Le bloc admin `Zones livraison vendeur` a ete retire de l edition candidature.
- Le bloc admin `Documents KYC` a ete retire de l edition candidature.
- La sauvegarde admin ne modifie plus `planId`, `planPrice`, `deliveryCoverage`, `deliveryZones` ni `kycStatus` depuis l edition de candidature.
- `dashboard-vendors.html` charge maintenant `vendors-dashboard.js?v=20260526-1`.

Verification:

- `node --check vendors-dashboard.js`: OK.

Precautions:

- Ne pas remettre zones/KYC/plan dans `renderApplicationEditor()`.
- Les zones de livraison doivent rester dans les fiches produits.
- Les plans vendeurs doivent rester dans les modules Basic/Pro et frais mensuels, pas dans le formulaire candidature.

## 2026-05-28 - Dashboard Impression: points de retrait et zones livraison

Contexte:

- Le module Impression avait besoin de sa propre logique de reception, separee de la livraison marketplace.
- Un client peut vouloir recuperer gratuitement une impression dans un point de retrait.
- Un client peut aussi demander une livraison a domicile, mais uniquement dans les zones configurees par admin.

Changements effectues:

- Ajout d'un bloc `Livraison & points de retrait` dans `dashboard-printing.js`.
- Les admins peuvent gerer:
  - Points de retrait gratuits: nom, adresse, telephone, actif/inactif.
  - Zones de livraison domicile: pays, departement, commune, prix, delai, actif/inactif.
- Les donnees sont sauvegardees dans:

```text
printingDeliverySettings/main
```

Impact cote site:

- Les pages impression documents/photo/CAD lisent ces reglages.
- Le client choisit point de retrait gratuit ou livraison domicile avant ajout au panier.
- Les frais domicile sont ajoutes au total impression.

Fichiers modifies:

- `dashboard-printing.js`
- `dashboard-printing.html`
- `JOURNAL_DE_BORD_DASHBOARD.md`

Verification:

- `node --check dashboard-printing.js`: OK.

Precautions:

- Ne pas supprimer le point de retrait par defaut sans ajouter au moins un autre point actif.
- Les zones de livraison impression ne sont pas les memes que les zones produits marketplace.

## 2026-05-28 - Dashboard Impression: suppression des fichiers clients

Contexte:

- Les clients qui commandent une impression envoient des fichiers stockes dans Firebase Storage.
- Apres telechargement par Smart Cut, ces fichiers ne doivent pas rester stockes inutilement.
- Chaque fichier doit pouvoir etre supprime individuellement depuis le module Impression du dashboard admin.

Changements effectues:

- Ajout d'un panneau `Fichiers envoyes pour impression` dans `dashboard-printing.js`.
- Le panneau lit les commandes racine `orders` et les sous-collections `clients/{clientId}/orders`.
- Les fichiers sont detectes depuis les options de commande:
  - `URL fichier`
  - `Chemin storage`
  - `Fichier`
- Chaque fichier affiche:
  - Nom du fichier.
  - Type detecte: PDF, Image ou Fichier.
  - Produit/mission impression associe.
  - Code commande, client et date commande.
  - Chemin Firebase Storage quand il est disponible.
- Chaque fichier possede ses propres actions:
  - `Telecharger`
  - `Ouvrir`
  - `Supprimer`
- Le bouton `Supprimer` appelle `deleteStorageFile(storagePath)` pour effacer le fichier dans Firebase Storage.
- Apres suppression, une trace est enregistree dans:

```text
printingDeletedFiles/{fileId}
```

- Cette trace evite de remontrer un fichier deja supprime si l'ancienne commande contient encore son URL.
- Ajout d'un bouton `Actualiser les fichiers` pour recharger la liste sans quitter la page.
- `dashboard-printing.html` charge maintenant `dashboard-printing.js?v=20260528-2`.

Verification:

- `node --check dashboard-printing.js`: OK.

Precautions:

- Ne pas supprimer la valeur `Chemin storage` dans les commandes impression: c'est elle qui permet la suppression precise dans Firebase Storage.
- Si Firebase Storage refuse la suppression, verifier les rules Storage pour autoriser les admins a supprimer les fichiers impression.
- La suppression du fichier ne supprime pas la commande; elle nettoie uniquement le fichier stocke.

## 2026-05-28 - Dashboard Impression: support des commandes photo multi-fichiers

Contexte:

- Le module Impression Photo peut maintenant envoyer plusieurs photos dans une seule commande.
- Chaque photo possede son propre fichier Firebase Storage.
- Le panneau de nettoyage admin doit donc afficher chaque photo separement.

Changements effectues:

- `dashboard-printing.js` lit maintenant `item.printingFiles[]` quand cette liste existe.
- Chaque entree de `printingFiles[]` devient une ligne independante dans `Fichiers envoyes pour impression`.
- Le fallback historique reste actif:
  - `URL fichier`
  - `Chemin storage`
  - `Fichier`
- Les anciennes commandes impression restent donc compatibles.
- `dashboard-printing.html` charge maintenant `dashboard-printing.js?v=20260528-3`.

Verification:

- `node --check dashboard-printing.js`: OK.

Precautions:

- Pour les futures commandes photo multi-images, ne pas retirer `printingFiles[]` du panier/order.
- Sans `printingFiles[]`, le dashboard ne verra que le premier fichier via l'ancien fallback.

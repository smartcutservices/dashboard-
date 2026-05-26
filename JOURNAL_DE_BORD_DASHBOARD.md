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

# Journal de bord Dashboard

## 2026-05-23 - Edition admin des candidatures vendeur

Contexte:
- Un vendeur qui a deja envoye sa candidature ne doit pas pouvoir modifier lui-meme le formulaire soumis.
- L'admin doit pouvoir corriger ou completer les informations manquantes depuis le dashboard.

Changements effectues:
- Ajout d'un bouton `Modifier candidature` sur chaque fiche dans le module `Candidatures`.
- Ajout d'un formulaire d'edition visible uniquement dans le dashboard admin.
- Les champs du formulaire vendeur, les parametres du plan, les zones de livraison, le statut KYC et la note admin peuvent etre modifies.
- La sauvegarde met a jour `vendorApplications` avec `setDoc(..., { merge: true })`.
- Si la candidature est deja approuvee ou si le store existe deja dans `vendors`, les modifications sont aussi synchronisees vers `vendors` et `clients`.

Precautions:
- Ne pas donner l'edition au vendeur apres soumission tant que ce choix produit reste valide.
- Si une candidature approuvee est modifiee, toujours synchroniser le profil vendeur actif pour eviter que dashboard, store et commandes utilisent des informations differentes.
- Les nouveaux textes ajoutes dans le code restent sans accents pour eviter les anciens problemes d'encodage.

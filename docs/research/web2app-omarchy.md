# Web2app et Omarchy

Vérifié le 11 novembre 2026, par lecture des fichiers locaux et des sources publiques, sans exécuter les installateurs. `web` ayant échoué, récupération avec `curl`. Aucun script modifié, aucun secret téléchargé.

## Référence officielle

Le dépôt demandé, `basecamp/omarchy`, redirige vers `omacom/omarchy`. Sa branche par défaut est désormais **`quattro`**, pas `master`. Comparaison figée au commit [`e6554e02d5257518609343f6d2ef64524edd0da1`](https://github.com/omacom/omarchy/commit/e6554e02d5257518609343f6d2ef64524edd0da1), daté du **11 novembre 2026 à 22:59:24 UTC**. Métadonnées vérifiées via l'[API du dépôt](https://api.github.com/repos/basecamp/omarchy) et l'[API du commit](https://api.github.com/repos/omacom/omarchy/commits/e6554e02d5257518609343f6d2ef64524edd0da1).

Le [manuel demandé](https://learn.omacom.io/2/the-omarchy-manual/63/web-apps) porte le titre « The Omarchy 3 Manual ». Il décrit les menus Install/Remove > Web App, la récupération automatique d'icône puis la saisie d'une URL PNG, le lanceur Super + Space et les raccourcis Hyprland. Ce n'est pas une procédure d'intégration KDE ni une documentation versionnée au commit ci-dessus.

Sources de code, toutes figées à ce SHA :

- [Installateur][install], [lanceur][launch], [suppression][remove].
- [Résolution du navigateur][browser], [transmission au navigateur ouvert][handoff], [classe de fenêtre][class].
- [Menu][menu], [traductions][i18n], [notifications][notify].

## Différences vérifiées

Fichiers locaux examinés :

- [`home/dot_config/fish/functions/web2app.fish.tmpl`](../../home/dot_config/fish/functions/web2app.fish.tmpl).
- [`home/dot_config/fish/functions/web2app-remove.fish.tmpl`](../../home/dot_config/fish/functions/web2app-remove.fish.tmpl).
- [`home/dot_local/bin/executable_omarchy-webapp-install`](../../home/dot_local/bin/executable_omarchy-webapp-install).

| Point | Dotfiles | Upstream actuel |
| --- | --- | --- |
| Interface | Fish exige exactement trois arguments. Le Bash local propose `gum` avec moins de trois arguments et accepte `custom-exec` et MIME en positions 4 et 5. Fish ne délègue pas au Bash. | L'[installateur][install] conserve ces arguments optionnels. Une troisième chaîne vide déclenche aussi la recherche automatique d'icône. |
| Dossiers et icônes | Les deux installateurs utilisent `~/.local/share/applications/icons/<nom>.png`. Fish crée le dossier, le Bash local ne crée ni celui-ci ni `applications`. Son icône locale est une référence relative à ce dossier, sans copie ni vérification. | L'[installateur][install] crée les dossiers, installe sous `~/.local/share/icons/hicolor/256x256/apps`, normalise le nom d'icône et écrit `Icon=<nom>` sans chemin. Il accepte URL, fichier local copié ou nom d'icône de thème. |
| Téléchargement | `curl -sL` dans les deux versions locales, sans échec sur HTTP 404, limite de durée ni contrôle du contenu. PNG seulement annoncé, pas vérifié. | L'[installateur][install] utilise `curl -fsSL --max-time 10`, exige un fichier non vide reconnu comme image par `file`. Recherche automatique via le site puis Google Favicons, pas une garantie de format PNG. |
| Validation et sérialisation | Nom et URL interpolés sans protection contre `/` dans le nom, retours à la ligne ou codes `%` de `Exec`. Fish entoure l'URL de guillemets, le Bash local ne le fait pas. | L'[installateur][install] refuse `/` dans le nom, ajoute `https://` si le schéma manque, exige HTTP/S sans espaces et échappe les valeurs Desktop Entry ainsi que l'argument URL de `Exec`. `CUSTOM_EXEC` reste une commande complète de confiance. |
| Lancement et fenêtre | Fish impose `chromium --new-window --ozone-platform=wayland --app=… --name=… --class=…`. Le Bash local écrit par défaut `omarchy-launch-webapp <URL>`, mais ce lanceur n'est pas fourni dans le dépôt. Aucun des deux n'écrit `StartupWMClass`. | Le [lanceur][launch] résout un navigateur Chromium compatible, sinon tente Chrome puis Chromium. Il essaie le [handoff][handoff], puis `setsid uwsm-app`. L'[installateur][install] ajoute `StartupWMClass` calculé depuis l'URL par un [autre script][class], pas depuis le nom choisi. |
| Suppression | Fish efface uniquement `<nom>.desktop` et l'ancien `<nom>.png` avec `rm`, sans sélection ni actualisation de base. | La [suppression][remove] indexe les entrées dont `Exec` contient `omarchy-launch-webapp` ou `omarchy-webapp-handler`, propose un menu, nettoie les chemins PNG anciens et nouveaux, notifie et lance `update-desktop-database`. Les entrées Fish à `Exec=chromium` ne figurent donc pas dans ce menu. |

## Adaptations nécessaires hors Omarchy

- **Pas de remplacement en bloc.** Le dépôt ne fournit pas le lanceur. Dans le PATH de cette session, ni celui-ci, ni `gum`, `uwsm-app` ou les autres helpers Omarchy consultés ne sont résolus. Chromium et Fish le sont. Préférer un lancement direct adapté au navigateur installé et à la session KDE, sans imposer Wayland ou UWSM.
- Remplacer ou éviter les intégrations Omarchy : [i18n][i18n] exige `OMARCHY_PATH`, catalogues et `jq`, le [menu][menu] appelle `omarchy-shell` via Perl, les [notifications][notify] utilisent `busctl`. Le [handoff][handoff] nécessite `socat` et des profils précis, mais reste facultatif pour un lancement direct.
- Reporter les protections de nom, URL, téléchargement et échappement, en préservant Fish et la condition chezmoi `.isDesktop`. `Exec` suit la grammaire Desktop Entry, pas Fish. Adapter les chemins si `XDG_DATA_HOME` diffère de `$HOME/.local/share`.
- Migrer installation et suppression ensemble pour hicolor et conserver la découverte des anciennes entrées Fish. Attention, la suppression upstream ne nettoie que les PNG malgré l'acceptation d'autres extensions locales. Valider les noms également à la suppression.
- Tester le regroupement Plasma avant d'adopter `StartupWMClass`. Les raccourcis Hyprland du manuel ne sont pas portables tels quels. La recherche d'icône peut transmettre l'URL à Google, donc prévoir de l'éviter pour les URL sensibles.

Contrôles effectués : `bash -n` sur le Bash local et analyse `fish --no-config --no-execute` des deux corps Fish après retrait des directives chezmoi, tous réussis. Aucun test de lancement sous Plasma ni installation/suppression réelle. Aucun commit.

[install]: https://github.com/omacom/omarchy/blob/e6554e02d5257518609343f6d2ef64524edd0da1/bin/omarchy-webapp-install
[launch]: https://github.com/omacom/omarchy/blob/e6554e02d5257518609343f6d2ef64524edd0da1/bin/omarchy-launch-webapp
[remove]: https://github.com/omacom/omarchy/blob/e6554e02d5257518609343f6d2ef64524edd0da1/bin/omarchy-webapp-remove
[browser]: https://github.com/omacom/omarchy/blob/e6554e02d5257518609343f6d2ef64524edd0da1/bin/omarchy-cmd-default-browser
[handoff]: https://github.com/omacom/omarchy/blob/e6554e02d5257518609343f6d2ef64524edd0da1/bin/omarchy-cmd-browser-handoff
[class]: https://github.com/omacom/omarchy/blob/e6554e02d5257518609343f6d2ef64524edd0da1/bin/omarchy-webapp-window-class
[menu]: https://github.com/omacom/omarchy/blob/e6554e02d5257518609343f6d2ef64524edd0da1/bin/omarchy-menu-select
[i18n]: https://github.com/omacom/omarchy/blob/e6554e02d5257518609343f6d2ef64524edd0da1/bin/omarchy-i18n
[notify]: https://github.com/omacom/omarchy/blob/e6554e02d5257518609343f6d2ef64524edd0da1/bin/omarchy-notification-send

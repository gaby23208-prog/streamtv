# StreamTV — IPTV PWA

Application IPTV Progressive Web App (PWA) compatible iPhone Safari / Android Chrome.

## Fichiers

```
index.html    → Structure HTML
style.css     → UI type Apple TV (dark, glassmorphism)
app.js        → Logique IPTV : parser M3U, EPG, player HLS, favoris
manifest.json → PWA manifest
```

## Fonctionnalités

- **M3U** : URL distante (avec proxy CORS automatique) ou fichier local
- **EPG XMLTV** : parsing, affichage programme en cours / suivant, liste
- **Player HLS** : HLS.js pour Chrome/Android + HLS natif pour Safari/iOS
- **Catégorisation** : heuristique automatique (SPORT, NEWS, MOVIES, KIDS, MUSIC, OTHER)
- **Favoris** : localStorage, toggle, filtre dédié
- **Recherche** : filtre temps réel
- **Navigation clavier** : ↑↓ + Enter + F (favori)
- **Swipe iPhone** : haut/bas sur le player pour zapper, gauche/droite pour la sidebar
- **Reprise** : dernière chaîne mémorisée
- **Toast** : feedback actions
- **Layout adaptatif** : sidebar desktop / bottom nav iPhone

## Déploiement GitHub Pages

```bash
git init
git add .
git commit -m "StreamTV IPTV PWA"
gh repo create streamtv --public
git push -u origin main
# Activer GitHub Pages sur /root dans les Settings
```

URL : `https://<username>.github.io/streamtv/`

## Ajouter à l'écran d'accueil (iPhone)

1. Ouvrir l'URL dans Safari
2. Partager → "Sur l'écran d'accueil"
3. Confirmer → l'app s'ouvre en plein écran sans barre Safari

## Prochaines features

- [ ] Service Worker (cache offline)
- [ ] Proxy backend (éviter CORS sur les flux cassés)
- [ ] Timeline EPG complète (style Tivimate)
- [ ] Picture-in-Picture (iOS 16+)
- [ ] Multi-audio / sous-titres

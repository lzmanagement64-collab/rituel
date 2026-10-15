export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Page momentanément indisponible — Rituel</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <style>
      body { font: 15px/1.6 system-ui, -apple-system, sans-serif; background: #fbfaf5; color: #13342a; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.4rem; margin: 0 0 0.5rem; font-weight: 600; }
      p { color: #5b6b62; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.7rem 1.2rem; border-radius: 999px; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #1e6a4c; color: #fff; }
      .secondary { background: #fff; color: #13342a; border-color: rgba(19,52,42,0.15); }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Cette page n'a pas pu s'afficher</h1>
      <p>Un problème momentané est survenu. Merci de réessayer dans un instant.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Réessayer</button>
        <a class="secondary" href="/">Retour à l'accueil</a>
      </div>
    </div>
  </body>
</html>`;
}

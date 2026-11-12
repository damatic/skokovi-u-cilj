# Testovi — Alkarski Padobranski Kup

Automatski testovi za `index.html`. Ne mijenjaju aplikaciju i ne koriste pravu bazu:
Firebase je zamijenjen mockom u memoriji (`mock.js`).

| Datoteka | Što radi |
|---|---|
| `unit.test.js` | Unit testovi čistih funkcija (bodovi, poredak, serije, normalizacija podataka). |
| `e2e.test.js` | Moduli i cijeli tokovi u pravom pregledniku (Playwright): prijava i zaključavanje, javni prikaz, ekipe, unos rezultata, rang, ispis, arhiva, responzivnost, pristupačnost. |
| `extract.js` | Učitava funkcije iz `index.html` za unit testove (ništa se ne kopira). |
| `mock.js` | Lažni Firebase (auth + Firestore) s `window.__store` i `window.__PARAMS`. |

## Pokretanje

Potrebni su Node 20+ i Playwright s Chromiumom (`npm i -D playwright && npx playwright install chromium`).

```
cd tests
node --test unit.test.js
node --test e2e.test.js        # ~3–5 min
```

Zadano se testira `../index.html`; druga datoteka: `APP_FILE=/put/do/index.html node --test ...`

## Napomene
- Nakon izmjene aplikacije pokreni oba skupa. Ako test pada zbog namjerne promjene ponašanja, ažuriraj test.
- `extract.js` traži funkcije po uvlaci (`  function ime(` do `  }`); zadrži taj stil u `index.html`.
- Testovi ne pokrivaju stvarne Firestore sigurnosna pravila ni prijavu Googleom; to treba provjeriti ručno.

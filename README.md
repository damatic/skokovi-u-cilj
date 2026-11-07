# Alkarski padobranski kup — aplikacija za rezultate

Jedna HTML datoteka (`index.html`) za vođenje padobranskog natjecanja u preciznom slijetanju (Aerodrom Sinj, Aeroklub Sinj). Podaci se spremaju u Firebase Firestore, a stranica je objavljena na GitHub Pages.

- Aplikacija: https://damatic.github.io/skokovi-u-cilj/
- Javni prikaz (samo čitanje): https://damatic.github.io/skokovi-u-cilj/?rezultati
- GitHub repozitorij: `damatic/skokovi-u-cilj`
- Firebase projekt: `skydiveapp-97a86`

## Što aplikacija radi

- Ekipe (5 natjecatelja A–E), država uz natjecatelja, spol (M/Ž).
- Unos rezultata: bodovi 0–3 i cm 0–16. Za 0, 1 i 2 boda cm se automatski postavlja na 16.
- Poredak: bodovi (padajuće) → cm (rastuće) → countback.
- Popisi: ekipe, pojedinačno, muškarci, žene, Bara, Čoja, Alka (po oznaci natjecatelja), ukupno.
- Ispis, pravila natjecanja, informacije o događaju, arhiva izdanja.
- Javni prikaz s karticama Rezultati / Pravila / Informacije.
- Sinkronizacija između uređaja, rad bez veze, sigurnosna kopija i povijest.

## Kako se objavljuje promjena

U mapi projekta u Git Bashu:

```
git add index.html
git commit -m "Kratak opis promjene na engleskom"
git push
```

Poruke commitova uvijek pišemo na engleskom. GitHub Pages se osvježi nakon pusha (do minutu-dvije). U pregledniku koristi Ctrl+F5 da zaobiđeš cache.

## Prijava i administratori

Uređivati može samo prijavljeni administrator (Google prijava). Javni prikaz (`?rezultati`) ne traži prijavu.

Popis administratora **nije u kodu stranice**, nego samo u Firestore pravilima. Nakon prijave aplikacija pokuša pročitati dokument `admin/provjera`. To pravila dopuštaju samo administratorima: ako uspije, sučelje se otključa, a ako ne, ostaje zaključano. Pisanje u bazu svejedno provjeravaju pravila na Googleovim serverima.

Firestore pravila (Firebase konzola → Firestore → Rules):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /natjecanja/{doc} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.auth.token.email in [
                        'd.matic91@gmail.com'
                      ];
    }
    match /admin/{doc} {
      allow read: if request.auth != null
                  && request.auth.token.email in [
                        'd.matic91@gmail.com'
                      ];
      allow write: if false;
    }
  }
}
```

Novi administrator = dodati njegovu Gmail adresu na **oba** popisa u pravilima (`natjecanja` i `admin`) i kliknuti Publish. `index.html` se ne mijenja. Adresa mora biti napisana identično, malim slovima.

## Jednokratne Firebase postavke

Napravljeno jednom, ovdje zapisano za slučaj novog projekta:

1. **Authentication → Get started.** Bez ovoga prijava javlja `auth/configuration-not-found`.
2. **Authentication → Sign-in method → Google → Enable** (support email, Save).
3. **Authentication → Settings → Authorized domains:** `damatic.github.io` (i `localhost` za lokalni test).
4. **Firestore → Rules:** pravila gore, pa Publish.

## Lokalno testiranje

Prijava ne radi preko `file:///...` (greška `auth/operation-not-supported-in-this-environment`). Pokreni lokalni server u mapi projekta:

```
python -m http.server 8000
```

pa otvori http://localhost:8000. Javni prikaz (`?rezultati`) radi i preko `file://`.

## Struktura podataka (Firestore)

Kolekcija `natjecanja`, jedan dokument po izdanju (ključ izdanja), plus dokument `_meta` s `{currentEdition}`.

```
{
  config:  { numJumps, eventName, eventEdition, eventLocation,
             eventDate, eventContact, eventWeb },
  teams:   [ { number, name, country,
               competitors: [ { letter, ime, alkarski, spol } ] } ],
  results: { "<ekipa>-<slovo>": [ { points, cm, cmAuto } ] },
  rules:   "tekst pravila"
}
```

Spremanje je po poljima (ne piše se cijeli dokument), pa dva uređaja mogu istovremeno unositi različite rezultate.

## Sigurnosna kopija i povijest

- Arhiva (admin kartica) sadrži izvoz/uvoz sigurnosne kopije (JSON) i lokalnu povijest zadnjih spremanja (do 15, spremljeno u `localStorage` preglednika).
- Prije većih promjena preuzmi sigurnosnu kopiju.

## Rješavanje problema

| Simptom | Uzrok / rješenje |
|---|---|
| Javna stranica prazna, ništa se ne sprema (403) | Firestore pravila su istekla ili nisu objavljena. Objavi pravila. |
| `auth/configuration-not-found` | Authentication nije pokrenut (Get started). |
| `auth/unauthorized-domain` | Dodaj domenu u Authorized domains. |
| `auth/operation-not-supported-in-this-environment` | Otvoreno preko `file://`. Koristi GitHub Pages ili `localhost`. |
| Nakon pusha nema promjene | Cache: Ctrl+F5 ili `?v=2` na kraj adrese. |
| Prijavljen, a sučelje zaključano | Mail nije na popisu u Firestore pravilima (oba bloka: `natjecanja` i `admin`). |

## Ideje za kasnije

- Veliki gumbi za unos na tabletu.
- Redoslijed skakanja, ime glavnog suca i potpis na ispisu poretka.
- Logo Kupa kad se nađe dobra slika.
- Arhiva izdanja u javnom prikazu.

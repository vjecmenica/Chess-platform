# Chess platform

Jednostavna i pregledna kompetitivna šahovska platforma u kojoj je tabla najvažniji element.

## Trenutno stanje

Repozitorijum je 28. septembra 2026. započet iz praznog stanja. Ova faza donosi samo dokumentaciju, početne direktorijume i Git podešavanja za ignorisanje lokalnih fajlova. Nema aplikacije, instaliranih zavisnosti, izvršnih komandi za razvoj niti implementiranih online partija, matchmaking-a, turnira ili AI-ja.

**Tehnologije su predlog za zajednički pregled, ne konačna odluka.** Prazni direktorijumi označavaju predložene granice odgovornosti; ne obavezuju na framework ili jezik.

## Dokumentacija

| Dokument | Svrha |
| --- | --- |
| [Specifikacija proizvoda](docs/product-spec.md) | Dogovoreni zahtevi, kriterijumi prvog cilja i otvorene odluke O-01–O-12. |
| [Roadmap](docs/roadmap.md) | Mali koraci sa proverljivim izlaznim kriterijumima i zavisnostima. |
| [Predlog arhitekture](docs/architecture.md) | Tehnologije, autoritet servera, satovi, trajnost i buduće proširenje. |

Specifikacija je izvor dogovorenih zahteva. Roadmap određuje predloženi redosled, a arhitektura predlaže način realizacije. Ako se odluka promeni, uskladiti sva tri dokumenta u istoj izmeni. Predlog se smatra usvojenim tek kada ishod pregleda bude izričito zabeležen u dokumentaciji.

## Početna struktura

```text
.
├── README.md
├── .gitignore
├── docs/
│   ├── product-spec.md
│   ├── roadmap.md
│   └── architecture.md
├── apps/
│   ├── web/.gitkeep          # budući prikaz table i korisnički interfejs
│   └── server/.gitkeep       # budući API i autoritativni server partije
└── packages/
    ├── domain/.gitkeep       # buduća pravila i poslovna logika
    └── contracts/.gitkeep    # budući ugovori poruka i validacija
```

`.gitkeep` fajlovi samo čuvaju prazne direktorijume u Git-u. Ukloniti ih kada direktorijumi dobiju stvaran sadržaj. Radne procese za analizu, migracije baze i infrastrukturu dodavati tek u odgovarajućoj fazi.

## Prvi funkcionalni cilj

Dva igrača otvore link, odigraju legalnu partiju sa satom koji kontroliše server i po završetku pregledaju sačuvanu partiju potez po potez. Predlog za prvi obim je nerejtingovana partija 5+3; identitet igrača i pravila prekida veze treba prethodno dogovoriti. Matchmaking, rejtinzi, engine, AI i turniri nisu uslov za ovaj cilj.

## Dalji rad

Prvo pregledati otvorene odluke iz specifikacije i korak M0 iz roadmap-a. Tek u narednom, zasebno dogovorenom zadatku postaviti razvojno okruženje. Tada dokumentovati tačne verzije, instalaciju, konfiguraciju, migracije, pokretanje i testove; trenutno takve komande ne postoje.

Za ovu dokumentacionu fazu proveravaju se relativni linkovi, potpunost tempa, usklađenost statusa odluka i `git diff --check`. Funkcionalni testovi postaće obavezni uz implementaciju pravila, sata, mrežnog protokola i trajnog čuvanja.

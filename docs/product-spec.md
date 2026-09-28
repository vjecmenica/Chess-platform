# Specifikacija proizvoda

Status: početna specifikacija, 28. septembar 2026. **Dogovoreni zahtevi** potiču iz zahteva vlasnika projekta. **Predlozi** i **otvorene odluke** nisu odobreni samim unošenjem u ovaj dokument. Nijedna funkcija još nije implementirana.

## 1. Dogovoreni zahtevi

### P-01 — Partije i tempo

Platforma podržava online partije dva igrača, rejtingovane i nerejtingovane, kroz direktan izazov prijatelju i automatsko uparivanje. Zapis `m+s` znači početno vreme od `m` minuta po igraču i dodatak od `s` sekundi po odigranom potezu.

| Kategorija rejtinga | Dogovoreni tempoi |
| --- | --- |
| bullet | 1+0 |
| blitz | 3+0, 3+2, 5+3 |
| rapid | 10+0, 10+2, 10+5, 15+0, 15+2, 15+5 |
| classical | 20+0, 20+10, 25+0, 25+10, 30+0, 30+10 |

Ovo je eksplicitna podela proizvoda za svih 16 tempa. Ne preračunavati kategoriju po tuđoj formuli koja bi promenila ovu tabelu. Custom tempo dolazi kasnije samo za direktan izazov; njegovo razvrstavanje i rejtingovani status su otvoreni (O-08).

Server potvrđuje legalnost i redosled poteza i meri vreme. Klijent prikazuje autoritativno stanje; njegov sat ili predlog poteza nisu izvor istine.

### P-02 — Rejting i matchmaking

Postoje četiri odvojena Glicko-2 rejtinga: bullet, blitz, rapid i classical. Rejtingovana završena partija menja samo odgovarajuću kategoriju; nerejtingovana ne menja rejting.

Matchmaking spaja samo isti konkretan tempo i isti tip partije (rejtingovana/nerejtingovana), traži sličan rejting odgovarajuće kategorije i postepeno širi opseg. Na primer, 3+0 i 3+2 nisu isti red za uparivanje iako oba pripadaju blitz kategoriji. Čekanje ne sme automatski promeniti tempo ili tip partije. Parametri Glicko-2 i proširenja pretrage ostaju O-04 i O-05.

### P-03 — Arhiva, pregled i analiza

Završene partije se čuvaju i mogu pregledati potez po potez. Pregled bez engine-a pripada prvom funkcionalnom cilju.

Kasnija tabla za analizu omogućava igraču da uključi engine, evaluaciju i više linija. To je zasebna funkcija od naknadne analize cele partije, koja računa accuracy i označava kvalitet pojedinačnih poteza.

Pre uvođenja accuracy i oznaka mora se dokumentovati sopstvena, verzionisana metodologija: korišćen engine i njegova verzija, budžet analize, perspektiva evaluacije, tretman matnih ocena, formula accuracy, agregiranje i granice oznaka kvaliteta, kao i proverljivi primeri. Ne preuzimati proizvoljne pragove ili nazive kao navodno univerzalni standard. Tačna formula i oznake još nisu odabrane (O-09).

### P-04 — Zadaci i AI

Planirani su šahovski zadaci, a kasnije vežbanje pozicija iz sopstvenih partija. AI kasnije objašnjava pozicije, ali šahovske varijante proverava engine. Neproverena AI varijanta se ne predstavlja kao ispravan šahovski savet.

Engine i AI saveti nisu dostupni igračima tokom aktivne partije. Zaštita mora važiti i na serverskim ulazima, ne samo skrivanjem dugmeta. Granice zaštite od spoljnih alata i šira fair-play politika su O-10.

### P-05 — Swiss turniri

Registrovan korisnik može kreirati Swiss turnir sa nazivom, maksimalnim brojem igrača, tempom, brojem rundi i vremenom početka. Potrebni su prijave, parovi, rezultati i tabela. Organizator bira da li turnirske partije utiču na običan rejting odgovarajuće kategorije; zaseban turnirski rejting nije zahtevan.

Sledeća runda počinje tek kada se završi prethodna, uz kratku pauzu. Trajanje turnira prikazuje se kao procena, ne kao garantovano vreme završetka. Swiss algoritam, bodovanje, razrešenje jednakog broja bodova, bye, kasni dolazak i pauza su otvorene odluke (O-07).

### P-06 — Korisnički interfejs

UI je jednostavan i pregledan, sa tablom kao najvažnijim elementom i bez suvišnih animacija. Sat, igrač na potezu, rezultat i stanje veze treba jasno prikazati. Precizan vizuelni dizajn, jezik interfejsa i izbor komponente table ostaju O-11.

## 2. Prvi funkcionalni cilj i granica obima

Dogovoreni prvi cilj: **dva igrača odigraju legalnu partiju sa satom preko linka i zatim je pregledaju potez po potez**. Ne čekati izradu matchmaking-a, rejtinga, turnira ili analize da bi ovaj tok radio.

Predlog minimalnog obima, za pregled u M0: jedna nerejtingovana partija 5+3, dva vezana identiteta/sesije, standardna početna pozicija, link za prihvatanje izazova i pregled završene partije bez engine-a. Način identifikacije i pristupa arhivi nije time odlučen (O-02).

Kriterijumi prihvatanja prvog cilja:

1. U dva odvojena pregledača/sesije prvi igrač pravi izazov, a drugi prihvata link; treća sesija ne može preuzeti zauzeto mesto niti igrati poteze.
2. Oba igrača vide isti položaj i igrača na potezu. Server odbija nelegalne poteze i poteze pogrešnog igrača; pokriveni su rokada, en passant i promocija.
3. Server vodi sat, dodaje inkrement tačno jednom po prihvaćenom potezu i odbija potez posle isteka vremena. Nelegalan zahtev ne zaustavlja niti resetuje sat.
4. Završetak partije ima trajan rezultat i razlog: mat, predaja, remi ili istek vremena prema prethodno dogovorenim pravilima O-03. Posle završetka nema novih poteza.
5. Ponovno slanje istog zahteva ne pravi dupli potez. Posle prekida veze klijent dobija usklađeno stanje i sat; prekid veze sam po sebi ne zaustavlja vreme prema predlogu O-03.
6. Po završetku, i posle osvežavanja stranice, moguće je otvoriti partiju, ići na početak/kraj i prethodni/sledeći polupotez. Položaji, redosled i rezultat odgovaraju sačuvanoj partiji.
7. Potvrđeni potezi i završena partija ostaju sačuvani posle restarta servera. Postupanje sa aktivnom partijom tokom serverskog prekida mora biti dogovoreno i provereno u O-03/M4.

U ovom dokumentacionom zadatku ne implementira se ni prvi funkcionalni cilj. Roadmap opisuje samo budući rad.

## 3. Otvorene odluke

Sve stavke su **otvorene**. „Predlog“ predstavlja početak diskusije, ne odobren zahtev. M-koraci su definisani u [roadmap-u](roadmap.md).

| ID | Odluka i predlog za razmatranje | Razrešiti pre |
| --- | --- | --- |
| O-01 | Tehnologije, verzije, organizacija paketa, način pristupa bazi i hosting. Predlog: TypeScript, React/Vite, Node.js/Fastify, Socket.IO, PostgreSQL; detalji u arhitekturi. | M1 |
| O-02 | Gost ili nalog za prvi izazov; autentikacija, oporavak sesije, pravo pristupa arhivi i privatnost linkova. Predlog: bezbedna gostujuća sesija za prvi nerejtingovani tok; nalozi za rejting. | M1; proširenje pre M6 |
| O-03 | Kada počinje sat; remi na zahtev naspram automatskog; istek vremena kada mat nije moguć; odsustvo prvog poteza; prekid veze; pad servera; latencija. Predlog: sat počinje kada oba igrača potvrde spremnost, veza ne pauzira vreme, bez kompenzacije latencije u prvom cilju. Politiku serverskog prekida posebno dogovoriti. | M2–M4, pre završetka M5 |
| O-04 | Početni rating/RD/volatility, tau, period obračuna Glicko-2, neaktivnost, provisional status, napuštene i poništene partije. Ne pretpostaviti da obračun posle svakog meča automatski odgovara izabranoj metodologiji. | M6 |
| O-05 | Početni opseg rejtinga, interval i korak širenja, maksimum čekanja, otkazivanje i kriterijum kod novih igrača. Predlog: FIFO među međusobno kompatibilnim kandidatima. | M7 |
| O-06 | Engine u browseru ili izdvojeni radni procesi, budžet CPU/memorije, MultiPV limit, keširanje i licencni uslovi izabranog paketa. | M8 |
| O-07 | Swiss pravila i biblioteka: bodovi, tie-break, bye, ponovljeni protivnici, boje, odustajanje, no-show, zakasneli ulazak, minimum igrača, trajanje pauze, otkazivanje i formula procene trajanja. Predlog: zamrznuti tempo, runde i rejtingovani status pri startu. | M10 |
| O-08 | Dozvoljeni custom tempoi, kategorija rejtinga i da li su rejtingovani. Ostaju samo direktni izazovi dok se drugačije ne dogovori. | M13 |
| O-09 | Formula accuracy i oznake kvaliteta, pragovi i verzionisanje; ne uvoditi brojke pre dokumentovane metodologije i validacije. | M9 |
| O-10 | Fair-play politika, obim zabrane saveta dok korisnik ima aktivnu partiju, prijave i moderacija; izvor/licenca zadataka; privatnost sopstvenih partija pri slanju AI servisu. | M6 za javnu igru; M8/M11/M12 za pomoć i zadatke |
| O-11 | Jezik UI-ja, mobilni prikaz, tastatura/pristupačnost, boje i licenca komponente table/figura. Predlog: responzivna tabla, vidljiv fokus, bez dekorativnih animacija. | M1 |
| O-12 | Ciljno opterećenje, region servera, prihvatljiva latencija, monitoring, čuvanje podataka, backup/restore ciljevi i operativni troškovi. | M1 za početni budžet; M5 pre javnog puštanja |

## 4. Praćenje odluka

Pri usvajanju dopisati datum, donosioca odluke, izbor, razlog i posledice; zatim promeniti status odgovarajućeg O-ID-ja i uskladiti [arhitekturu](architecture.md) i [roadmap](roadmap.md). Za sada nema usvojenih tehnoloških odluka.

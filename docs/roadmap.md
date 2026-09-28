# Roadmap

Status: predlog redosleda razvoja, 28. septembar 2026. Ovo nisu obećani rokovi. Svaki korak završava se malom demonstracijom ili ponovljivom proverom. Zahtevi i otvorene odluke nalaze se u [specifikaciji](product-spec.md); tehnički pristup je [predlog arhitekture](architecture.md).

## Granica ovog zadatka

Sada se isporučuju samo četiri Markdown dokumenta, `.gitignore` i prazni direktorijumi. Koraci M0–M13 ispod nisu započeti. Pisanje ovog predloga ne predstavlja odobrenje tehnologija niti početak naredne razvojne faze.

## Prvi funkcionalni cilj: izazov preko linka, sat, sačuvan pregled

M1–M4 su tehnički koraci ka istom cilju. **Prva celovita funkcionalna isporuka je M5:** dva igrača odigraju legalnu partiju sa satom preko linka i zatim je pregledaju potez po potez. Matchmaking, rejtinzi, engine, AI i turniri nisu zavisnosti M5.

| Korak | Mala isporuka | Provera završetka | Zavisnosti |
| --- | --- | --- | --- |
| M0 — Pregled odluka | Zabeležiti izbor tehnologija i početni obim; predlog je nerejtingovana 5+3. Razjasniti identitet, pravila kraja partije i politiku sata/prekida. | O-01, početni deo O-02/O-03/O-11/O-12 imaju eksplicitne odluke; preostale stavke imaju korak u kojem se rešavaju. | Pregled dokumentacije sa vlasnikom projekta. |
| M1 — Razvojna osnova | Tek po pregledu dodati manifest, zaključane zavisnosti, minimalni web/server, bazu i prvu migraciju. Dokumentovati lokalno pokretanje i konfiguraciju. | Čist checkout se instalira i pokreće po README-u; provera zdravlja servera i konekcije sa bazom prolazi; nema tajni u Git-u. | M0. |
| M2a — Pravila poteza | Izdvojeni domen partije: početna pozicija, potez, redosled, rokada, en passant, promocija i evidencija istorije. | Deterministički testovi prihvataju legalne i odbijaju nelegalne poteze, uključujući izlazak iz šaha i zabranjenu rokadu kroz šah. | M1, O-03. |
| M2b — Završetak i sat | Mat, pat, dogovorena pravila remija i predaje; serverski sat sa inkrementom i istekom. | Kontrolisani sat u testu pokriva potez pre/na/posle roka, pogrešan potez, dodavanje inkrementa samo jednom i istek bez dolaska novog zahteva. | M2a, završena odluka O-03 za pravila. |
| M3a — Izazov i mesta | Kreiranje i prihvatanje jednokratnog linka; dve autorizovane sesije i jednostavna tabla. | Dve sesije zauzimaju različita mesta; dva istovremena prihvatanja ne stvaraju tri igrača; treći korisnik ne može igrati u njihovo ime. | M2b, O-02/O-11. |
| M3b — Potvrda poteza uživo | Razmena zahteva i autoritativnih potvrda; oba klijenta prikazuju poziciju, sat i status veze. | Dva pregledača vide istu verziju partije; pogrešan igrač i zastarela verzija bivaju odbijeni; UI ne tretira nepotvrđen potez kao konačan. | M3a. |
| M4a — Trajno čuvanje | Atomsko čuvanje poteza, verzije stanja, satova, rezultata i identifikatora zahteva pre potvrde. | Restart posle potvrde ne gubi potez; ponovljen zahtev ne pravi duplikat; greška upisa ne proizvodi uspešnu potvrdu; dva zahteva ne mogu završiti partiju dvaput. | M3b. |
| M4b — Oporavak veze | Reconnect sa snapshot-om i redosledom događaja; postupak za restart/pad servera. | Prekid pre/posle potvrde, refresh i restart vode do istog stanja; izgubljeno emitovanje nadoknađuje se čitanjem baze; sat prati dogovorenu politiku prekida. | M4a, potpuna odluka O-03 o prekidima. |
| M5 — Sačuvan pregled i celovit tok | Stranica završene partije, rezultat, lista poteza i navigacija početak/prethodni/sledeći/kraj. | Dve sesije završe partiju i ponovo je otvore posle restarta; svaki polupotez rekonstruiše očekivanu poziciju; svi kriterijumi iz odeljka 2 specifikacije prolaze. | M4b, pristup arhivi iz O-02; O-12 pre javne dostupnosti. |

Pre zatvaranja M5 napraviti jednu celovitu proveru u dva browser konteksta i ciljane integracione testove za konkurentne poteze, duplikate, istek sata i oporavak. Testovi koriste kontrolisano vreme umesto čekanja stvarnih minuta. Operativni pregled obuhvata vraćanje sačuvane partije iz backup-a i dogovorene kriterijume latencije; ne tvrditi da je platforma spremna za veliko opterećenje bez merenja.

## Proširenja tek posle M5

Ovi koraci predstavljaju predloženi redosled; njihove zavisnosti dopuštaju kasniju promenu prioriteta. Svaki red sa više isporuka razdvojiti u navedene male izmene.

| Korak | Redosled malih isporuka | Provera završetka | Zavisnosti/odluke |
| --- | --- | --- | --- |
| M6 — Nalozi, tempoi i rejtinzi | (1) Nalozi i povezivanje arhive; (2) svih 16 tempa i izbor rejtingovano/nerejtingovano; (3) dokumentovana Glicko-2 konfiguracija i obračun. | Sve kategorije odgovaraju tabeli P-01; poznat referentni Glicko-2 primer prolazi; jedna partija utiče samo jednom na odgovarajući rejting, nerejtingovana ni na jedan. | M5; O-02/O-04/O-10. |
| M7 — Matchmaking | (1) Red po tempu i tipu; (2) sličan rejting i širenje opsega; (3) otkazivanje i konkurentno uparivanje. | Kontrolisano vreme dokazuje širenje; nema mešanja tempa/tipa, samouparivanja ni dvostrukog rezervisanja igrača; otkazani zahtev se ne uparuje. | M6; O-05. |
| M8 — Interaktivna analiza | (1) Politika pristupa završenim partijama; (2) uključivanje engine-a i evaluacije; (3) više linija i ograničenja resursa. | Aktivni igrač ne može dobiti savet kroz UI ni direktan API; završena partija daje legalne linije i jasno označenu perspektivu evaluacije; rad ne usporava satove partija. | M5; O-06/O-10; M6 ako politika zahteva naloge. |
| M9 — Analiza cele partije | (1) Dokumentovati metodologiju; (2) pozadinski posao; (3) accuracy i oznake sa verzijom metodologije. | Fiksni skup partija daje proverljive rezultate u dogovorenoj toleranciji; pragovi imaju primere i granične slučajeve, uključujući matne ocene; ponovljen posao ne duplira rezultat. | M8; O-09. |
| M10 — Swiss turniri | (1) Kreiranje/prijave; (2) testiran modul parovanja; (3) jedna runda kroz postojeću partiju; (4) više rundi, pauza, tabela i procena trajanja. | Mali simulirani turnir pokriva neparan broj igrača, bye, odustajanje i jednak broj bodova; poslednji rezultat pokreće tačno jednu narednu rundu posle pauze; rated izbor radi, restart ne pravi duple parove. | M6 i pouzdan M4; O-07. Ne zavisi od M7–M9. |
| M11 — Zadaci | (1) Licenciran izvor i rešavanje; (2) provera poteza i napretka; (3) kasnije izdvajanje pozicija iz sopstvenih partija. | Rešenje je provereno; pogrešan potez se dosledno ocenjuje; pristup privatnim pozicijama prati prava nad izvornom partijom. | M5/M8; O-10; izdvajanje sopstvenih pozicija posle M9. |
| M12 — AI objašnjenja | (1) Ugovor engine rezultata i tekstualnog objašnjenja; (2) provera svake predložene varijante; (3) UI objašnjenja. | Nelegalna ili engine-om nepotvrđena tvrdnja ne prolazi kao potvrđen savet; neuspeh AI-ja ne blokira pregled; zabrana saveta tokom aktivne partije ostaje na serveru. | M8; O-10 i izbor AI servisa/privatnosti. |
| M13 — Custom izazovi | (1) Validacija tempa; (2) dokumentovana kategorija i rated politika; (3) izbor u direktnom izazovu. | Granične vrednosti su proverene; kategorija je vidljiva pre prihvatanja; custom izazov ne ulazi u standardne matchmaking redove. | M6; O-08. |

## Pravilo završetka svakog koraka

Zabeležiti rezultat demonstracije/testova, ažurirati dokumentaciju i zatvoriti relevantne O-ID-je. Izmene koje utiču na vreme, autoritet servera, trajno čuvanje ili rejting zahtevaju test neuspeha i ponavljanja, ne samo uspešnog toka. Ne dodavati sledeću veliku funkciju dok prethodni kriterijumi nisu ispunjeni.

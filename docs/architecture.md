# Predlog arhitekture

Status: **predlog za pregled, nije konačna tehnološka odluka**, 28. septembar 2026. Nema implementacije niti instaliranih zavisnosti. [Specifikacija](product-spec.md) definiše zahteve P-01–P-06 i otvorene odluke O-01–O-12; [roadmap](roadmap.md) određuje kada se predlog proverava.

## 1. Početni pristup i tehnologije — O-01

Predlog je modularni monolit: jedan dugotrajan serverski proces za API i aktivne partije, jedan web klijent i PostgreSQL. To smanjuje broj mesta na kojima može nastati neslaganje o potezu ili satu, a ostavlja jasne granice za kasnije izdvajanje skupih analiza. Ne počinjati mikroservisima, distribuiranim vlasništvom nad partijama ili Redis-om bez izmerene potrebe.

| Oblast | Predlog | Razlog i ograničenje |
| --- | --- | --- |
| Jezik | TypeScript u web-u, serveru i paketima | Zajednički tipovi smanjuju neslaganje poruka. Tipovi ne validiraju mrežne podatke: obavezna je i validacija u izvršavanju. |
| Klijent | React + Vite, običan CSS | Razdvajanje table, sata i pregleda uz jednostavan build. Server-rendering nije preduslov za prvi cilj. Komponentu table izabrati po pristupačnosti, promociji i licenci (O-11). |
| Server | Podržano Node.js LTS izdanje + Fastify | Jedan jezik i eksplicitne API šeme/moduli. Dug CPU posao može blokirati event loop i satove, zato engine/AI ne pripadaju ovom procesu. |
| Realno vreme | Socket.IO uz HTTP za kreiranje izazova i čitanje arhive | Veze, rooms i potvrde olakšavaju implementaciju. Uređen redosled poruka ne znači garantovanu isporuku: trajnost i oporavak rešava aplikacija. |
| Šahovska pravila | chess.js iza sopstvenog domenskog adaptera | Legalnost, notacija i istorija bez pisanja generatora poteza od nule. Biblioteka nije AI niti kompletna politika takmičenja; proveriti remi, timeout i sva odstupanja u O-03. |
| Trajno čuvanje | PostgreSQL, verzionisane SQL migracije; u početku direktan SQL preko `pg` | Transakcije, ograničenja jedinstvenosti i zaključavanje redova čuvaju poteze, rezultate i kasnije parove/rejtinge. ORM ostaje alternativa za pregled; ne sme sakriti kritične transakcije. |
| Paketi i provere | npm workspaces, zaključan lockfile, Vitest i Playwright | Jedan repozitorijum; domen sa kontrolisanim vremenom, integracije sa stvarnom test bazom i celovit tok u dva browser konteksta. Izbor alata potvrditi u M0. |
| Kasniji engine | Stockfish, izdvojen worker ili browser Web Worker | Resursno odvojena analiza završenih partija. Distribucija, licenca i mesto izvršavanja zahtevaju odluku O-06 pre izbora konkretnog paketa. |

React/Vite je predložen jer je prvi proizvod interaktivna tabla; Next.js razmotriti ako SSR ili sadržajne stranice postanu stvarna potreba. Sirovi WebSocket smanjio bi zavisnosti, ali zahteva više sopstvene logike veze; ni sa jednim transportom ne nestaje potreba za idempotentnošću. SQLite može poslužiti lokalnom prototipu, ali PostgreSQL od početka izbegava kasnije menjanje modela konkurentnih upisa. Go je razumna serverska alternativa ako tim preferira taj jezik, uz odvojene ugovore i alatke. Nijedan od ovih izbora nije usvojen.

Tačne verzije i kompatibilnost utvrditi pri M1, pinovati i zabeležiti u README-u. Izabrati podržani LTS, ne slepo najnovije izdanje. Predlog nije tvrdnja o kapacitetu: broj aktivnih partija i latenciju izmeriti prema O-12.

## 2. Granice odgovornosti

```text
Web klijent ── HTTP + Socket.IO ── Server (jedan proces u prvom cilju)
                                      ├── identitet i izazovi
                                      ├── aktivne partije i satovi
                                      ├── arhiva / pregled
                                      └── PostgreSQL

Kasnije u istom serveru: rejtinzi, matchmaking i Swiss koordinacija
Kasnije van procesa partije: poslovi analize → engine → proverena AI objašnjenja
```

- `apps/web`: tabla, unos poteza, prikaz serverom potvrđenog stanja, lokalna interpolacija sata i pregled istorije. Ne odlučuje o legalnosti, rezultatu ili preostalom vremenu.
- `apps/server`: autentikacija/autorizacija, mrežni ulazi, serijalizacija komandi po partiji, transakcije i emitovanje potvrđenih događaja.
- `packages/domain`: adapter šahovskih pravila, prelazi stanja, obračun sata; kasnije rejting i turnirska pravila. Bez browser-a, mreže ili direktne zavisnosti od baze; vreme se prosleđuje kao ulaz za testiranje.
- `packages/contracts`: šeme komandi/događaja i njihove verzije. Nema tajni ni podrazumevanog poverenja u klijenta; serverski ulaz uvek validira payload.

Zavisnosti: web i server koriste contracts; server koristi domain. Ako klijent kasnije koristi domen za prikaz mogućih poteza, server svejedno samostalno proverava svaki zahtev. U ovom zadatku kreirani su samo prazni direktorijumi.

## 3. Autoritativna obrada poteza

Predloženo stanje partije: `waiting → active → finished`, uz `aborted` za odustajanje pre igre ili posebno dogovoreni oporavak. Uslovi za `aborted` i uticaj na arhivu/rejting su O-03/O-04. Sačuvati verziju pravila uz partiju da buduće izmene ne promene tumačenje stare partije.

Predlog komande: `gameId`, `requestId`, `expectedVersion`, `from`, `to`, opciono `promotion`. Identitet se izvodi iz proverene sesije, nikada iz polja `playerId` kojem se veruje. Klijent ne šalje autoritativni FEN, rezultat ili stanje sata.

1. Autorizovati sesiju, validirati poruku i zabeležiti serversko vreme ulaska u serijalizovani red partije. I potezi i istek sata moraju proći kroz isti red; duplikati ostaju vezani za izvorni zahtev.
2. Zaključati red partije u kratkoj transakciji. Proveriti prethodno obrađen `requestId`; za ponovljen isti zahtev vratiti prethodni ishod, a isti ID sa drugačijim payload-om odbiti. Jedinstveni ključ uključuje partiju, aktera i ID.
3. Proveriti status, verziju i igrača na potezu. Za novu komandu proveriti rok prema dogovorenom vremenskom pravilu, zatim legalnost. Ako je rok istekao, završetak ima prednost. Nelegalan potez ne resetuje početak razmišljanja.
4. Za prihvaćen potez ažurirati istoriju, poziciju, oba sata, stranu na potezu i verziju; ako postoji završetak, upisati rezultat i razlog u istoj transakciji. Izvedene konačne rezultate nikada ne primati od klijenta.
5. Commitovati pre uspešne potvrde. Tek tada poslati potvrdu i događaj obema sesijama, sa verzijom, potezom, satovima i statusom. Greška baze znači neuspeh potvrde i oporavak iz trajnog stanja, ne nastavak iz spekulativnog stanja u memoriji.

Ovo daje efekat jednog izvršavanja u bazi čak i kada transport šalje više puta; nije obećanje „exactly once“ mrežne isporuke. Klijent označava potez kao na čekanju do potvrde. Kod zastarele verzije dobija snapshot ili eksplicitan zahtev za sinhronizaciju; ne pokušava da nasilno primeni potez na novoj poziciji.

Vreme evidentiranja narednog poteza mora biti ograničeno početkom njegovog poteza, čak i ako je zahtev stigao prerano. Dok se zapis commit-uje, autoritativni red i dalje čuva redosled. Precizno pravilo računanja serverske obrade i prihvatljiva latencija su O-03/O-12, uz test poteza na samoj granici isteka.

## 4. Sat, prekid veze i restart — O-03

Predlog: početno vreme i inkrement su celi brojevi milisekundi. Sat počinje kada su oba igrača spremna; od tog trenutka teče samo sat igrača na potezu. Za aktivni potez server pamti preostalo vreme na početku poteza i monotono vreme početka. Pri obradi legalnog poteza oduzima proteklo vreme, pa dodaje inkrement jednom. Na granici `preostalo <= 0` predlog je istek pre prihvatanja poteza. Ako mat nije moguć, ishod isteka zavisi od izabranih pravila, ne od prostog „uvek pobeda protivnika“.

Serverski timer budi proveru isteka čak i bez mrežnog saobraćaja; nije sam po sebi presuda. Ponovo pročitati/zaključati stanje i proveriti rok, jer je u međuvremenu mogao stići potez. Ne upisivati sat u bazu svake sekunde. Čuvati satove i vremensko sidro pri svakom prihvaćenom prelazu, a istekom upravljati po roku.

U živom procesu meriti trajanje monotonim satom, da korekcija sistemskog vremena ne pomeri ishod. Za trajni zapis čuvati i UTC sidro/rok: monotono vreme nema smisla posle restarta niti na drugom hostu. Politiku oporavka eksplicitno odabrati pre M4b: nastavak uz potrošeno vreme tokom prekida, pauza kroz prekid ili prekid/poništenje partije. Ne može se obećati pošten nastavak samo čitanjem starog monotoničkog broja. Testirati izabranu politiku, promenu sistemskog vremena i pad pre/posle commit-a.

Predlog prvog cilja je bez kompenzacije mrežne latencije. Klijentsko vreme ne može produžiti rok. Event-loop kašnjenje i vreme upisa u bazu treba meriti; CPU analize su izdvojene. UI dobija preostala vremena i serversko vremensko sidro, pa samo interpolira prikaz i povremeno ga usklađuje. Lokalna nula nije ovlašćenje za proglašenje pobednika.

Prekid klijentske veze po predlogu ne pauzira sat. Po reconnect-u server proverava isti identitet i šalje trenutno stanje sa verzijom i istorijom koja nedostaje. Klijent odbacuje duple/stare događaje, a pri praznini u verzijama traži novo stanje. Izgubljena potvrda posle commit-a rešava se ponavljanjem istog `requestId`, ne novim potezom. Izgubljeno emitovanje rešava se resync-om iz baze i periodičnim poređenjem verzije čak i ako veza deluje živa. Socket.IO recovery može pomoći, ali nije jedini mehanizam oporavka.

## 5. Čuvanje i pregled partija

Predloženi model, ne konačna šema:

| Entitet | Podaci i bitne invarijante |
| --- | --- |
| Identity / Session | Gostujući ili registrovani identitet po O-02; rok sesije i prava. Javni ID partije nije token za pravo igranja. |
| Challenge | Kreator, tempo, rated status, stanje, rok i token poziva; prihvatanje atomarno i jednokratno. |
| Game | Dva identiteta/boje, status, početni FEN, tempo i eksplicitna kategorija, rated, verzija pravila/stanja, satovi/sidro, rezultat i razlog, početak/kraj; kasnije opciona veza sa turnirom. |
| Move | `gameId`, broj polupoteza, UCI potez uključujući promociju, SAN, serversko vreme, satovi posle poteza i opciono FEN. Jedinstveno `(gameId, ply)`. |
| CommandReceipt | Akter, `requestId`, otisak payload-a, ishod i rezultujuća verzija; trajna deduplikacija i oporavak potvrde. |
| Rating / RatingEvent — kasnije | Korisnik i kategorija, rating/RD/volatility, period/verzija; evidencija učinka partije ili perioda koja sprečava dupli obračun. |
| Tournament / Entry / Round / Pairing — kasnije | Organizator, konfiguracija i verzija pravila, učesnici, runde, parovi/bye i reference na Game; jedinstveno mesto igrača u rundi. |

Istorija poteza sa početnim FEN-om je osnova rekonstrukcije; trenutni FEN je pomoćni snapshot i ne zamenjuje istoriju za ponavljanje pozicije. PGN je format za prikaz/izvoz, ne jedini trajni zapis koji mora nositi satove, autorizaciju i deduplikaciju. Pregled gradi pozicije do odabranog polupoteza i ne menja završenu partiju. Pravo čitanja arhive proverava server po O-02.

Transakcija završetka zaključava partiju i dozvoljava jedan konačan prelaz. Kasniji rejting i turnirski napredak mogu se pokretati iz trajnog outbox zapisa upisanog u istoj transakciji sa rezultatom. Potrošači su idempotentni: ponavljanje ne menja rejting dvaput i ne otvara dve runde. Samo pub/sub događaj bez trajnog zapisa nije dovoljan. Za prvi cilj dovoljni su trajno stanje, receipt i resync; outbox dodati pri prvoj pouzdanoj pozadinskoj obradi.

## 6. Proširenja bez promene autoriteta partije

**Rejtinzi i matchmaking:** Glicko-2 metodologija određuje period obračuna i parametre (O-04); rating događaj se vezuje za trajni završetak, sa jedinstvenim identifikatorom. Matchmaking koristi ključ `(baseSeconds, incrementSeconds, rated)` i rejting kategorije iz P-01. Predloženo proširenje zavisi od vremena čekanja svakog kandidata; par mora zadovoljiti obostranu politiku opsega. Rezervisati oba igrača atomarno i sprečiti istovremenu aktivnu rezervaciju iz više tabova. Red u memoriji je mogući početak uz eksplicitno ponovno prijavljivanje posle restarta; trajniji red i više servera zahtevaju poseban dizajn.

**Swiss:** turnir orkestrira postojeće Game instance. Pri početku predlog je zamrznuti pravila i rated zastavicu; svaka kreirana partija dobija iste vrednosti. Poslednji konačan rezultat runde pokreće proveru da su rešene sve partije i bye/službeni ishodi, pa trajno zakazuje `nextRoundAt` nakon dogovorene pauze. Scheduler posle restarta čita rok iz baze. Transakcija/ograničenje jedinstvenosti sprečava duplo parovanje. Swiss implementaciju izabrati i proveriti prema O-07; ne tvrditi usklađenost sa određenim pravilnikom unapred. Procena trajanja mora objasniti pretpostavljen broj poteza i pauze, naročito uz inkrement, bez obećanog kraja.

**Engine, analiza i AI:** analiza ne radi u procesu koji vodi sat. Za početak razmotriti browser worker za interaktivnu analizu ili izdvojeni serverski worker radi centralne kontrole; odluka O-06 zavisi i od O-10. Pozadinska analiza cele partije ima ograničenja resursa, retry, verziju engine-a i metodologije, keš i status posla. AI dobija proverenu poziciju i engine nalaz; njegove nove linije ponovo prolaze legalnost i engine proveru. Numerički accuracy ne izvodi se iz AI teksta. Metodologija O-09 prethodi prikazu oznaka.

Predlog strože početne zaštite: dok identitet učestvuje u aktivnoj partiji, blokirati platformine engine/AI ulaze i zadatke sa savetima; ponovo proveriti pravo pri vraćanju rezultata pozadinskog posla. Tačan obim za analizu drugih završenih partija ostaje O-10. Isključen UI nije dovoljna kontrola. Browser engine koji je već isporučen korisniku i spoljni alati ne mogu se pouzdano opozvati ili zabraniti serverskim API-jem; taj kompromis rešiti pre izbora browser engine-a, uz dokumentovanu fair-play politiku.

## 7. Bezbednost, rad i rast — O-02/O-10/O-12

Sesije vezuju pravo na jednu boju; koristiti bezbedne, nepredvidive tokene poziva, ograničen rok i atomarno prihvatanje. Predlog su HttpOnly/Secure/SameSite sesijski kolačići preko HTTPS/WSS; proveravati origin WebSocket handshake-a i CSRF zaštitu HTTP komandi. Autorizacija se proverava za svaku komandu, ne samo pri uspostavljanju veze. Ograničiti veličinu/frekvenciju poruka i broj otvorenih izazova. Tokene i tajne ne beležiti u logove; `.env` ostaje lokalni fajl.

Početni deployment: statički web, jedan dugotrajan serverski proces iza proxy-ja sa podrškom za WebSocket, i PostgreSQL sa backup-om. Izbegavati okruženje koje uspavljuje proces aktivne partije ili prekida dugotrajne veze. Operativno planirati drain pre deployment-a: zaustaviti nove izazove i završiti aktivne partije ili primeniti unapred odabranu politiku prekida. Više replika ne uključivati samo promenom broja instanci.

Pratiti latenciju potvrde poteza, event-loop lag, trajanje transakcija, odbačene/duple komande, reconnect, razliku sata pri usklađivanju i neuspehe pozadinskih poslova. Logovi nose game/request ID, bez tajni. Dogovoriti pragove, broj konkurentnih partija, retention i ciljeve backup/restore-a pre javnog puštanja; provera vraćanja podataka je deo M5.

Pri stvarnoj potrebi za rastom: dodeliti jednog vlasnika svakoj aktivnoj partiji, uvesti routing, lease i fencing zaštitu od dva vlasnika, pa tek onda više servera. Redis adapter može razmenjivati obaveštenja, ali nije sam po sebi vlasništvo nad partijom, distribuirani sat ili trajna istorija. Baza ostaje zaštita od konkurentnih potvrda. Izdvajanje turnira i analiza dolazi tek kada postoji izmerena potreba.

## 8. Provera predloga

Najvažniji dokazi su testovi domenskih pravila sa kontrolisanim satom, integracioni testovi sa pravom bazom i dva browser konteksta kroz ceo M5 tok. Posebno pokriti konkurentne poteze, potez naspram isteka, ponovljen request, commit bez emitovanja, prekid veze, restart i oporavak arhive. Izmeriti opterećenje pre obećanja o bullet pouzdanosti; brz tempo najviše otkriva kašnjenje servera.

U M0 proveriti O-01/O-02/O-03/O-11/O-12, zapisati odluke i tek onda dodavati runtime i zavisnosti. Ostale odluke rešavaju se pre njihovih koraka u roadmap-u. Ovaj dokument nije dozvola da se automatski započne implementacija.

## 9. Primarni izvori za pregled tehnologija

Izvori provereni 28. septembra 2026; objašnjavaju mogućnosti alata, ne predstavljaju usvajanje našeg dizajna.

- [Node.js release politika](https://nodejs.org/en/about/previous-releases) — izbor podržanog LTS izdanja.
- [Vite vodič](https://vite.dev/guide/) i [Fastify dokumentacija](https://fastify.dev/docs/latest/) — početna alatka klijenta i serverski framework.
- [Socket.IO garancije isporuke](https://socket.io/docs/v4/delivery-guarantees/) — podrazumevana isporuka ne garantuje prijem, aplikacija dodaje trajnost i oporavak.
- [chess.js dokumentacija](https://jhlywa.github.io/chess.js/) — validacija poteza i šahovska reprezentacija, uz proveru domenskih pravila projekta.
- [PostgreSQL zaključavanje](https://www.postgresql.org/docs/current/explicit-locking.html) — transakciona zaštita konkurentnih promena.
- [Glicko autorova dokumentacija](https://www.glicko.net/glicko.html) — izvor za metodologiju i referentne proračune pre M6.
- [Zvanična Stockfish distribucija](https://stockfishchess.org/download/) — kandidat za kasniji engine i polazna tačka za izbor konkretnog paketa.

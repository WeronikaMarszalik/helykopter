# Sterowanie S107 z klawiatury

Stan: 2026-11-03. Firmware `parakopter-tx-2`, USB-UART v1.
Panel, serwer i ESP32 obsługują gaz **0–127**. Usunięto dawny limit 40/127
i limit jednej sesji 10 s.
Sterownik w jądrze Linuksa pozostaje osobnym etapem.

## Uruchomienie

1. Podłącz ESP32 przez USB. Zamknij Monitor portu szeregowego Arduino.
2. Uruchom `Uruchom-panel.cmd` w repozytorium i otwórz **http://127.0.0.1:8765/**.
3. Wybierz port i kliknij **Połącz**. Na tym komputerze jest to **COM4**,
   ESP32-D0WD-V3 przez CP2102. Status „Gotowy · gaz 0” pochodzi z ESP32.
4. Wyłącz fabryczny pilot, skieruj diody na helikopter. Zaznacz
   **Włącz sterowanie** i przytrzymaj **Spację**.
5. Trzymając Spację, zwiększaj gaz klawiszem **W** i steruj strzałkami.

| Klawisz | Działanie |
|---|---|
| Spacja, trzymana | Rozpoczyna i utrzymuje nadawanie |
| W / S | Zwiększa / zmniejsza gaz o 2 co 100 ms, zakres 0–127 |
| ← / → | Skręt w lewo / prawo |
| ↑ / ↓ | Przód / tył |
| Esc lub puszczenie Spacji | STOP, gaz 0, wycentrowanie kierunków |

Puszczenie W/S zachowuje ustawiony gaz podczas trzymania Spacji.
Puszczenie strzałki centruje odpowiednią oś (63). Przeciwne klawisze się
znoszą. Każda nowa sesja rozpoczyna się od gazu 0 i osi 63, także jeśli
wcześniej ustawiono suwaki inaczej. Przytrzymanie W od zera do maksimum
trwa około 6,4 s. Procent przy suwaku opisuje polecenie gazu, nie pomiar obrotów.

Można również przytrzymać przycisk myszą; W/S i strzałki działają wtedy tak
samo. Suwaki pozwalają ustawić wartości bezpośrednio podczas nadawania,
np. trzymając Spację. Samo przesunięcie suwaka w stanie bezczynności niczego
nie nadaje. Zaznaczenie pola „Włącz sterowanie” ustawia fokus na przycisku,
więc od razu można użyć Spacji. W polach wyboru i edycji zwykłe klawisze
nie rozpoczynają sterowania; Esc zawsze uruchamia STOP.

## Kierunki, kanał i trymer

- Domyślne wychylenie strzałek: 32, czyli około połowy zakresu. Suwak
  **Wychylenie strzałek** pozwala wybrać 1–64, do pełnego zakresu 0–127.
- Z logów przyjęto lewo = większy bajt A, prawo = mniejszy A,
  przód = mniejszy B, tył = większy B. Reakcja fizyczna wymaga potwierdzenia.
  W ustawieniach można osobno odwrócić lewo/prawo i przód/tył.
- Kanał i odwrócenie osi zmienia się po STOP. Domyślnie bit 1, zgodny
  z ramką wzorcową. Fizyczne przypisanie bitów do A/B nie jest potwierdzone.
- Trymer początkowo 81 pochodzi z ramki wzorcowej. Nie dodano zgadywanego
  wzoru mieszania trymera ani kompensacji skrętu zależnej od gazu.

## STOP i utrata połączenia

- Samo USB, reset lub otwarcie panelu nie powoduje emisji. GPIO4 startuje LOW.
- Nadawanie wymaga aktywnego przytrzymania Spacji albo przycisku. Puszczenie,
  Esc, STOP, wyłączenie sterowania, utrata fokusu okna lub ukrycie karty
  zeruje gaz i kończy sesję. Powrót do okna nie wznawia nadawania.
- SET jest wysyłany co około 120 ms. Serwer nie odtwarza starych poleceń.
  Timeout serwera to około 400 ms, niezależny timeout ESP32 to 500 ms.
  ARM bez SET niczego nie nadaje i wygasa po 1 s.
- STOP unieważnia sesję; spóźniony lub powtórzony SET nie przywraca jej.
  Po aktywnym sterowaniu ESP32 wysyła 3 ramki z gazem 0 na ostatnim kanale,
  następnie wyłącza nadajnik.
- Przełączenie kanału w trakcie sesji jest odrzucane także przez firmware.
- STOP jest poleceniem IR: helikopter musi odbierać nadajnik. Odłączenie
  zasilania USB uniemożliwia wysłanie STOP. Przed lotem trzeba sprawdzić
  kierunki i reakcję modelu na STOP oraz zanik IR bez łopat. Testy programu
  nie potwierdzają zachowania fizycznego helikoptera.
- Puszczenie Spacji nie oznacza łagodnego lądowania. Do zmniejszania gazu
  służy S; puszczenie Spacji uruchamia gaz 0.

## Diagnostyka IR

Odbiornik VS1838B jest opcjonalny. Przy jego braku pole odbiornika pozostaje
niezaznaczone, RX nie jest kryterium blokującym sterowanie.

**Uruchom test IR · 2 s** odtwarza 11 ramek z gazem 0 przy wyłączonym
helikopterze i fabrycznym pilocie. Wzorzec `3F 3F 80 51` pochodzi z
kompletnej ramki #263, linia 46 w `logs/device-monitor-261029-114318.log`.
TX potwierdza wykonanie przebiegu przez ESP32, a nie odbiór przez helikopter.
Z podłączonym odbiornikiem celem jest 10 kolejnych kompletnych ramek wzorcowych;
odczyty z błędem lub przepełnieniem nie są „naprawiane”.

Aktualny nadajnik: GPIO4 → 1 kΩ → baza BC547B; emiter → GND;
47 kΩ baza–GND; osobny rezystor każdej diody z 3V3, katody do kolektora.
Ostatnio przyjęto 180 Ω dla IR1 i IR2 ze starego pilota oraz 220 Ω dla IR3.
Pomiar około 2,2 V na rezystorach 220 Ω wykonano wcześniej ze zwartym
kolektorem do GND: około 10 mA na gałąź. To nie pomiar prądu przy nadawaniu.
Mostek diagnostyczny c20–c22 musi być usunięty przed sterowaniem.

## Architektura i protokół

`ui/ → HTTP 127.0.0.1 → tools/control_panel.py → USB-UART 115200 → ESP32 → GPIO4 → IR`.
Opcjonalny odbiornik: VS1838B → GPIO14. LED na płytce: GPIO2.

Nośna sprzętowa LEDC: 38 kHz, około 33% wypełnienia.
Okres ramki: 183 ms start–start. Parametry pochodzą z założeń i logów
zdemodulowanych; dokładna nośna pilota nie została zmierzona.
Nowe ramki: nagłówek 2096/1968 µs, mark 354 µs, space 248/662 µs,
32 bity MSB first, stop mark 354 µs. TEST używa oryginalnych czasów wzorca.

Komendy ASCII zakończone LF; odpowiedzi JSON Lines:

```text
STATUS
TEST
ARM <sesja:1..2147483647>
SET <sesja> <numer_rosnący> <gaz:0..127> <skręt:0..127> <pochylenie:0..127> <trymer:0..127> <kanał:0..1>
STOP
```

Backend wymaga firmware `parakopter-tx-2`, protokołu 1, gotowego PWM
i świeżej telemetrii. Dla ARM wymaga `controls_enabled: true` i identyfikatora
właściciela sesji. Host/Origin ograniczono do 127.0.0.1; żądania POST wymagają
losowego tokenu. Nie publikować serwera w sieci.

## Weryfikacja wersji 2

- C++: pełny gaz 127 na polu siedmiobitowym, odrzucenie 128, sterowanie przez
  60 s bez dawnego limitu, watchdog, STOP, kanał, duplikaty i przepełnienie zegara.
- Python: 9 testów serwera, w tym 127, błędny zakres, właściciel sesji,
  timeout i odrzucenie obcego Origin. Używają atrapy portu szeregowego.
- Node: logika klawiatury i app.js z atrapą DOM/HTTP. Sprawdzono dojście do
  127, powrót do 0, utrzymanie gazu, centrowanie osi, odwrócenie kierunku,
  sterowanie dłuższe niż 10 s, STOP po Spacji/Esc/blur/ukryciu/rozłączeniu
  i puszczenie Spacji przed zakończeniem ARM. Test nie łączy się z urządzeniem.
- Kompilacja Arduino ESP32 3.3.11: 286487 B programu, 23272 B RAM.
  Wgranie na COM4 zakończone weryfikacją sumy kontrolnej.
- Kontrola w przeglądarce: suwak 127/127, powrót do 0, COM4 połączone,
  firmware bezczynne, TX=0. Nie wykonano próby z włączonymi silnikami.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s test -p test_control_panel.py -v
node test/keyboard.cjs
g++ -std=c++17 -Wall -Wextra -Werror test/controller_native.cpp -o .local/controller_native.exe
.\.local\controller_native.exe
.\tools\build-firmware.ps1
```

Do wgrania zamknij port używany przez panel i uruchom
`.\tools\build-firmware.ps1 -Upload -Port COM4`.
Wdrażanie na Windows korzysta z Arduino CLI dołączonego do Arduino IDE.

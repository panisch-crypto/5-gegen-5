export const DEFAULT_GAME_SETS = [
  {
    id: "set_001",
    title: "Klassisches Familienduell Set 1",
    language: "de",
    rounds: [
      {
        roundNumber: 1,
        multiplier: 1,
        question: "Nennen Sie etwas, das man im Kino kauft.",
        answers: [
          { id: 1, text: "Popcorn", points: 45 },
          { id: 2, text: "Cola / Getränk", points: 28 },
          { id: 3, text: "Nachos", points: 14 },
          { id: 4, text: "Eis / Konfekt", points: 8 },
          { id: 5, text: "Kinokarte", points: 5 }
        ]
      },
      {
        roundNumber: 2,
        multiplier: 1,
        question: "Nennen Sie einen Grund, warum man morgens zu spät zur Arbeit kommt.",
        answers: [
          { id: 1, text: "Verschlafen / Wecker überhört", points: 38 },
          { id: 2, text: "Stau / dichter Verkehr", points: 26 },
          { id: 3, text: "Bahn oder Bus hat Verspätung", points: 16 },
          { id: 4, text: "Auto springt nicht an / Panne", points: 9 },
          { id: 5, text: "Schlechtes Wetter / Glatteis", points: 7 },
          { id: 6, text: "Schlüssel oder Handy gesucht", points: 4 }
        ]
      },
      {
        roundNumber: 3,
        multiplier: 2,
        question: "Nennen Sie einen Ort, an dem man absolut leise sein muss.",
        answers: [
          { id: 1, text: "Bibliothek / Bücherei", points: 34 },
          { id: 2, text: "Kirche / Gottesdienst", points: 24 },
          { id: 3, text: "Kino / Theater / Oper", points: 15 },
          { id: 4, text: "Krankenhaus", points: 10 },
          { id: 5, text: "Prüfung / Schule", points: 8 },
          { id: 6, text: "Friedhof / Beerdigung", points: 6 },
          { id: 7, text: "Kinderzimmer (wenn Baby schläft)", points: 3 }
        ]
      },
      {
        roundNumber: 4,
        multiplier: 3,
        question: "Nennen Sie etwas, das man vor einer langen Urlaubsreise zu Hause kontrolliert.",
        answers: [
          { id: 1, text: "Herd / Backofen ausgeschaltet", points: 30 },
          { id: 2, text: "Fenster geschlossen", points: 24 },
          { id: 3, text: "Haustür abgeschlossen", points: 16 },
          { id: 4, text: "Wasserhähne zugedreht", points: 10 },
          { id: 5, text: "Licht ausgeschaltet", points: 7 },
          { id: 6, text: "Bügeleisen / Kaffeemaschine aus", points: 6 },
          { id: 7, text: "Müll heruntergebracht", points: 4 },
          { id: 8, text: "Heizung heruntergedreht", points: 3 }
        ]
      }
    ],
    finalQuestions: [
      {
        id: "f1",
        question: "Nennen Sie einen typischen Feiertag.",
        suggestions: [
          { text: "Weihnachten", points: 46 },
          { text: "Ostern", points: 24 },
          { text: "Silvester / Neujahr", points: 14 },
          { text: "Tag der Deutschen Einheit", points: 9 },
          { text: "Pfingsten", points: 7 }
        ]
      },
      {
        id: "f2",
        question: "Nennen Sie ein Tier, das Winterschlaf hält.",
        suggestions: [
          { text: "Bär / Braunbär", points: 42 },
          { text: "Igel", points: 31 },
          { text: "Murmeltier", points: 14 },
          { text: "Fledermaus", points: 8 },
          { text: "Siebenschläfer", points: 5 }
        ]
      },
      {
        id: "f3",
        question: "Nennen Sie etwas, das man am Strand vergisst.",
        suggestions: [
          { text: "Sonnenbrille", points: 35 },
          { text: "Handtuch / Badetuch", points: 27 },
          { text: "Sonnencreme", points: 20 },
          { text: "Flip-Flops / Badeschuhe", points: 11 },
          { text: "Buch / Zeitschrift", points: 7 }
        ]
      },
      {
        id: "f4",
        question: "Nennen Sie ein Schulfach.",
        suggestions: [
          { text: "Mathematik", points: 41 },
          { text: "Deutsch", points: 26 },
          { text: "Englisch", points: 15 },
          { text: "Sport", points: 11 },
          { text: "Biologie / Geschichte", points: 7 }
        ]
      },
      {
        id: "f5",
        question: "Nennen Sie ein Fortbewegungsmittel mit zwei Rädern.",
        suggestions: [
          { text: "Fahrrad", points: 52 },
          { text: "Motorrad", points: 26 },
          { text: "Roller / E-Scooter", points: 13 },
          { text: "Mofa / Moped", points: 6 },
          { text: "Segway", points: 3 }
        ]
      }
    ]
  },
  {
    id: "set_002",
    title: "Büro, Technik & Alltag Set 2",
    language: "de",
    rounds: [
      {
        roundNumber: 1,
        multiplier: 1,
        question: "Nennen Sie etwas, das auf fast jedem Büroschreibtisch steht.",
        answers: [
          { id: 1, text: "Computer / Monitor / Laptop", points: 42 },
          { id: 2, text: "Kaffeetasse", points: 28 },
          { id: 3, text: "Stifte / Kugelschreiber", points: 18 },
          { id: 4, text: "Telefon / Headset", points: 12 }
        ]
      },
      {
        roundNumber: 2,
        multiplier: 1,
        question: "Nennen Sie etwas, das man tut, wenn das WLAN plötzlich ausfällt.",
        answers: [
          { id: 1, text: "Router neu starten / Stecker ziehen", points: 44 },
          { id: 2, text: "Auf mobile Daten umschalten", points: 24 },
          { id: 3, text: "Fluchen / sich ärgern", points: 14 },
          { id: 4, text: "Flugmodus an- und ausschalten", points: 11 },
          { id: 5, text: "Beim Anbieter / Nachbarn nachfragen", points: 7 }
        ]
      },
      {
        roundNumber: 3,
        multiplier: 2,
        question: "Nennen Sie ein typisches Gericht in einer deutschen Kantine.",
        answers: [
          { id: 1, text: "Schnitzel mit Pommes", points: 35 },
          { id: 2, text: "Currywurst", points: 27 },
          { id: 3, text: "Spaghetti Bolognese", points: 16 },
          { id: 4, text: "Salatbuffet / Großer Salat", points: 10 },
          { id: 5, text: "Fischfilet (Freitags)", points: 7 },
          { id: 6, text: "Eintopf / Tagessuppe", points: 5 }
        ]
      },
      {
        roundNumber: 4,
        multiplier: 3,
        question: "Nennen Sie eine Ausrede, warum man eine E-Mail noch nicht beantwortet hat.",
        answers: [
          { id: 1, text: "Im Spam-Ordner gelandet", points: 32 },
          { id: 2, text: "Zu viele Meetings / keine Zeit", points: 25 },
          { id: 3, text: "War im Urlaub / krank", points: 17 },
          { id: 4, text: "Gar nicht erhalten / Serverproblem", points: 12 },
          { id: 5, text: "Wollte gerade eben antworten", points: 8 },
          { id: 6, text: "Musste noch Rücksprache halten", points: 6 }
        ]
      }
    ],
    finalQuestions: [
      {
        id: "f1",
        question: "Nennen Sie ein Getränk, das man morgens zum Frühstück trinkt.",
        suggestions: [
          { text: "Kaffee", points: 58 },
          { text: "Orangensaft", points: 21 },
          { text: "Tee", points: 14 },
          { text: "Milch / Kakao", points: 7 }
        ]
      },
      {
        id: "f2",
        question: "Nennen Sie einen Wochentag, auf den sich alle freuen.",
        suggestions: [
          { text: "Freitag", points: 54 },
          { text: "Samstag", points: 33 },
          { text: "Sonntag", points: 10 },
          { text: "Donnerstag", points: 3 }
        ]
      },
      {
        id: "f3",
        question: "Nennen Sie etwas, das ein Handwerker immer im Werkzeugkasten hat.",
        suggestions: [
          { text: "Hammer", points: 43 },
          { text: "Schraubenzieher", points: 30 },
          { text: "Zollstock / Maßband", points: 16 },
          { text: "Zange", points: 11 }
        ]
      },
      {
        id: "f4",
        question: "Nennen Sie eine beliebte Pizzabelag-Zutat.",
        suggestions: [
          { text: "Salami", points: 40 },
          { text: "Käse / Mozzarella", points: 27 },
          { text: "Schinken", points: 16 },
          { text: "Champignons / Pilze", points: 11 },
          { text: "Thunfisch", points: 6 }
        ]
      },
      {
        id: "f5",
        question: "Nennen Sie eine deutsche Großstadt mit über 500.000 Einwohnern.",
        suggestions: [
          { text: "Berlin", points: 45 },
          { text: "München", points: 24 },
          { text: "Hamburg", points: 18 },
          { text: "Köln", points: 8 },
          { text: "Frankfurt am Main", points: 5 }
        ]
      }
    ]
  }
];

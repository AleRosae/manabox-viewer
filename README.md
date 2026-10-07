# ManaBox Cuber

Web app locale per consultare l'export CSV di [ManaBox](https://manabox.app): ricerca con sintassi Scryfall, filtri, immagini, statistiche e liste/cubi esportabili su CubeCobra.

## Avvio

```bash
docker compose up -d --build   # http://localhost:8080
docker compose down            # ferma
```

Porta diversa: `PORT=9000 docker compose up -d`. Dati (database SQLite e cache delle immagini) in `./data`: sopravvivono a riavvii e rebuild.

Al primo avvio carica il CSV (ManaBox → Collection → Export → CSV). L'app scarica da Scryfall i dati delle carte (≈50 richieste per ~3.500 carte, con pausa di 200 ms) e mette in cache le immagini man mano che vengono mostrate.

## Funzioni

- **Collezione**: tutte le collezioni (raggruppate per carta) o un singolo binder; griglia o tabella; anteprima grande al passaggio del mouse; carte bifronte girabili; dettaglio con stampe, binder, prezzi, legalità.
- **Ricerca**: sintassi Scryfall (`c<=ub t:instant mv<=2`, `o:"draw a card"`, `r>=rare`, `is:dfc`, `f:pauper`, `eur>=5`, `binder:"binder A"`, `OR`, `-`, parentesi…) più il pannello filtri. Il pulsante *Sintassi* mostra l'elenco completo.
- **Statistiche**: valore di mercato e d'acquisto, colori, curva di mana, rarità, tipi, espansioni, binder, carte più costose.
- **Liste e cubi**: aggiunta singola o multipla (selezione, shift+click, "seleziona tutte le filtrate") scegliendo quante copie; carte non possedute cercate su Scryfall e mostrate in grigio; avviso se una carta è usata in più liste di quante copie possiedi; export CubeCobra CSV e `.txt`.
- **Import successivi**: riepilogo delle differenze; le liste restano agganciate alle carte (per nome/oracle id).

## Sviluppo

```bash
# backend (porta 8765)
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
DATA_DIR=../data .venv/bin/uvicorn app.main:app --reload --port 8765
.venv/bin/python -m pytest

# frontend (porta 5173, proxy /api → 8765)
cd frontend && npm install && npm run dev
npx vitest run
```

Stack: FastAPI + SQLite, React + Vite + TypeScript + Tailwind.
